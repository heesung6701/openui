import { parse } from "yaml";
import { z } from "zod";
import { fromZod, type Diagnostic } from "../diagnostics";
import { resolvePath, type ProjectIO } from "../io";
import { walkTokenTree, type TokenDef } from "./tree";
import { aliasTarget, typedAliases, type TokenType } from "./values";

export type Collection = { name: string; kind: "set" | "modifier"; modes: string[]; defaultMode: string };
export type TokenEntry = { collection: string; type: TokenType; byMode: Record<string, TokenDef> };
export type TokenSet = { collections: Collection[]; tokens: Map<string, TokenEntry> };

const Ref = z.object({ $ref: z.string() }, { error: "only {$ref: <file>} sources are supported in openui 0.1" });
const Resolver = z.looseObject({
  version: z.unknown(),
  name: z.string().optional(),
  description: z.string().optional(),
  sets: z.record(z.string(), z.looseObject({ description: z.string().optional(), sources: z.array(Ref) })).optional(),
  modifiers: z.record(z.string(), z.looseObject({
    description: z.string().optional(),
    contexts: z.record(z.string(), z.array(Ref)).refine((c) => Object.keys(c).length > 0, "contexts must not be empty"),
    default: z.string().optional(),
  })).optional(),
  resolutionOrder: z.array(z.object({ $ref: z.string() })),
});

export async function loadTokens(io: ProjectIO, resolverPath: string): Promise<{ tokens: TokenSet; diagnostics: Diagnostic[] }> {
  const diagnostics: Diagnostic[] = [];
  const empty = (): { tokens: TokenSet; diagnostics: Diagnostic[] } => ({ tokens: { collections: [], tokens: new Map() }, diagnostics });
  const err = (file: string, path: (string | number)[], message: string) => diagnostics.push({ file, path, message });

  let doc: unknown;
  try {
    doc = parse(await io.read(resolverPath));
  } catch (e) {
    err(resolverPath, [], `cannot read resolver: ${(e as Error).message}`);
    return empty();
  }
  const parsed = Resolver.safeParse(doc);
  if (!parsed.success) {
    diagnostics.push(...fromZod(parsed.error, resolverPath));
    return empty();
  }
  const r = parsed.data;
  if (r.version !== "2025.10") err(resolverPath, ["version"], `resolver version must be "2025.10"`);
  const sets = r.sets ?? {};
  const modifiers = r.modifiers ?? {};

  // Collections follow resolutionOrder; every set and modifier must appear exactly once.
  const order: { name: string; kind: "set" | "modifier" }[] = [];
  r.resolutionOrder.forEach(({ $ref }, i) => {
    const m = /^#\/(sets|modifiers)\/(.+)$/.exec($ref);
    const kind = m?.[1] === "sets" ? "set" : "modifier";
    if (!m || !(m[2]! in (kind === "set" ? sets : modifiers))) {
      err(resolverPath, ["resolutionOrder", i, "$ref"], `unknown reference ${JSON.stringify($ref)}`);
      return;
    }
    if (order.some((o) => o.kind === kind && o.name === m[2])) err(resolverPath, ["resolutionOrder", i], `${$ref} listed twice`);
    else order.push({ name: m[2]!, kind });
  });
  for (const name of Object.keys(sets)) if (!order.some((o) => o.kind === "set" && o.name === name)) err(resolverPath, ["resolutionOrder"], `set "${name}" missing from resolutionOrder`);
  for (const name of Object.keys(modifiers)) if (!order.some((o) => o.kind === "modifier" && o.name === name)) err(resolverPath, ["resolutionOrder"], `modifier "${name}" missing from resolutionOrder`);

  const loadSources = async (refs: { $ref: string }[], at: (string | number)[]): Promise<Map<string, TokenDef>> => {
    const out = new Map<string, TokenDef>();
    for (const [i, { $ref }] of refs.entries()) {
      const file = resolvePath(resolverPath, $ref);
      let text: string;
      try {
        text = await io.read(file);
      } catch (e) {
        err(resolverPath, [...at, i, "$ref"], `cannot read "${file}": ${(e as Error).message}`);
        continue;
      }
      let tree: unknown;
      try {
        tree = parse(text);
      } catch (e) {
        err(file, [], `YAML error: ${(e as Error).message}`);
        continue;
      }
      const w = walkTokenTree(tree, file);
      diagnostics.push(...w.diagnostics);
      for (const t of w.tokens) out.set(t.path, t); // later sources win (DTCG)
    }
    return out;
  };

  const collections: Collection[] = [];
  const raw = new Map<string, { collection: string; byMode: Record<string, TokenDef> }>();
  const own = (path: string, collection: string, byMode: Record<string, TokenDef>) => {
    const prev = raw.get(path);
    if (prev) {
      const def = Object.values(byMode)[0]!;
      err(def.file, path.split("."), `token "${path}" is defined in both "${prev.collection}" and "${collection}"`);
      return;
    }
    raw.set(path, { collection, byMode });
  };

  for (const { name, kind } of order) {
    if (kind === "set") {
      collections.push({ name, kind, modes: ["default"], defaultMode: "default" });
      for (const [path, def] of await loadSources(sets[name]!.sources, ["sets", name, "sources"])) own(path, name, { default: def });
      continue;
    }
    const mod = modifiers[name]!;
    const modes = Object.keys(mod.contexts);
    const defaultMode = mod.default ?? modes[0]!;
    if (!modes.includes(defaultMode)) err(resolverPath, ["modifiers", name, "default"], `default "${defaultMode}" is not a context of modifier "${name}"`);
    collections.push({ name, kind, modes, defaultMode });
    const perCtx = new Map<string, Map<string, TokenDef>>();
    for (const ctx of modes) perCtx.set(ctx, await loadSources(mod.contexts[ctx]!, ["modifiers", name, "contexts", ctx]));
    const paths = new Set([...perCtx.values()].flatMap((m) => [...m.keys()]));
    for (const path of paths) {
      const byMode: Record<string, TokenDef> = {};
      for (const ctx of modes) {
        const def = perCtx.get(ctx)!.get(path);
        if (def) byMode[ctx] = def;
        else {
          const any = [...perCtx.values()].find((m) => m.has(path))!.get(path)!;
          err(any.file, path.split("."), `token "${path}" missing in context "${ctx}" of modifier "${name}"`);
        }
      }
      own(path, name, byMode);
    }
  }

  // Resolve types: explicit > alias target (DTCG). Group-inherited types were applied by walkTokenTree.
  const typeOf = (path: string, seen: Set<string>): TokenType | null => {
    const e = raw.get(path);
    if (!e || seen.has(path)) return null;
    const defs = Object.values(e.byMode);
    const explicit = defs.find((d) => d.type)?.type;
    if (explicit) return explicit;
    for (const d of defs) {
      const t = aliasTarget(d.value);
      const r = t ? typeOf(t, new Set([...seen, path])) : null;
      if (r) return r;
    }
    return null;
  };
  const tokens = new Map<string, TokenEntry>();
  for (const [path, e] of raw) {
    const type = typeOf(path, new Set());
    if (type) tokens.set(path, { ...e, type });
  }

  const isGroup = (p: string) => [...raw.keys()].some((k) => k.startsWith(p + "."));
  const edges = new Map<string, Set<string>>();
  for (const [path, e] of raw) {
    const entry = tokens.get(path);
    const set = new Set<string>();
    edges.set(path, set);
    for (const def of Object.values(e.byMode)) {
      const at = [...path.split("."), "$value"];
      const aliases = entry ? typedAliases(entry.type, def.value) : (aliasTarget(def.value) ? [{ alias: aliasTarget(def.value)!, expected: null }] : []);
      for (const { alias, expected } of aliases) {
        set.add(alias);
        if (!raw.has(alias)) {
          err(def.file, at, isGroup(alias) ? `alias "{${alias}}" refers to a group, not a token` : `alias "{${alias}}" not found`);
          continue;
        }
        const t = tokens.get(alias)?.type;
        if (expected && t && t !== expected) err(def.file, at, `alias "{${alias}}" type mismatch: expected ${expected}, got ${t}`);
      }
    }
  }

  // Cycle detection (DFS, three colors) — always terminates.
  const color = new Map<string, 1 | 2>();
  const reported = new Set<string>();
  const dfs = (node: string, stack: string[]) => {
    color.set(node, 1);
    for (const next of edges.get(node) ?? []) {
      if (color.get(next) === 1) {
        const cycle = [...stack.slice(stack.indexOf(next)), next];
        const key = [...new Set(cycle)].sort().join(",");
        if (!reported.has(key)) {
          reported.add(key);
          const def = Object.values(raw.get(node)!.byMode)[0]!;
          err(def.file, [...node.split("."), "$value"], `alias cycle: ${cycle.join(" -> ")}`);
        }
      } else if (!color.has(next) && edges.has(next)) dfs(next, [...stack, next]);
    }
    color.set(node, 2);
  };
  for (const node of edges.keys()) if (!color.has(node)) dfs(node, [node]);

  for (const [path, e] of raw) {
    if (tokens.has(path)) continue;
    const def = Object.values(e.byMode)[0]!;
    const targets = Object.values(e.byMode).map((d) => aliasTarget(d.value)).filter((t): t is string => !!t);
    if (targets.every((t) => raw.has(t)) && ![...reported].some((k) => k.split(",").includes(path)))
      err(def.file, path.split("."), `cannot determine $type of token "${path}"`);
  }

  return { tokens: { collections, tokens }, diagnostics };
}
