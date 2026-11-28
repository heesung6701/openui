import { z } from "zod";
import { fromZod, type Diagnostic } from "../diagnostics";
import { resolvePath, type ProjectIO } from "../io";
import { walkTokenTree, type TokenDef } from "./tree";
import { aliasTarget, collectAliases, typedAliases, type TokenType } from "./values";
import { parseYaml } from "../yaml";

export const DEVICES = ["phone", "tablet", "desktop", "tv", "watch"] as const;
export type Range = { min?: number; max?: number };
/** When a modifier context applies (§3.6). Exactly one key. Ranges are half-open: min ≤ value < max, in px (= dp). */
export type Condition =
  | { width: Range } | { height: Range }
  | { orientation: "portrait" | "landscape" }
  | { device: (typeof DEVICES)[number] }
  | { colorScheme: "light" | "dark" }
  | { language: string };
export type Collection = {
  name: string; kind: "set" | "modifier" | "component"; modes: string[]; defaultMode: string;
  /** Present when the context is selected by the environment rather than explicitly. */
  when?: Record<string, Condition>;
};
export type TokenEntry = {
  collection: string; type: TokenType; byMode: Record<string, TokenDef>;
  /** Component tokens: values for mode expressions, in precedence order (fewest modes first, then document order). */
  when?: { expr: Record<string, string>; value: unknown }[];
};
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

const RangeSchema = z.strictObject({ min: z.number().min(0).optional(), max: z.number().positive().optional() })
  .refine((r) => r.min !== undefined || r.max !== undefined, "range needs min or max")
  .refine((r) => r.min === undefined || r.max === undefined || r.min < r.max, "range min must be < max");
const CONDITIONS: Record<string, z.ZodType> = {
  width: RangeSchema,
  height: RangeSchema,
  orientation: z.enum(["portrait", "landscape"]),
  device: z.enum(DEVICES),
  colorScheme: z.enum(["light", "dark"]),
  language: z.string().regex(/^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/, "language must be a BCP 47 tag like ko or en-US"),
};
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** `$extensions["org.openui"].when` of a modifier: every context gets one condition; one condition kind per modifier; no overlaps. */
function parseWhen(raw: unknown, contexts: string[], at: (string | number)[], err: (path: (string | number)[], message: string) => void): Record<string, Condition> | undefined {
  if (raw === undefined) return undefined;
  if (!isObj(raw)) {
    err(at, "when must map each context to a condition");
    return undefined;
  }
  const out: Record<string, Condition> = {};
  for (const [ctx, cond] of Object.entries(raw)) {
    const p = [...at, ctx];
    if (!contexts.includes(ctx)) err(p, `unknown context "${ctx}"`);
    else if (!isObj(cond) || Object.keys(cond).length !== 1) err(p, `context "${ctx}" needs exactly one condition (${Object.keys(CONDITIONS).join(", ")})`);
    else {
      const [key, value] = Object.entries(cond)[0]!;
      const schema = CONDITIONS[key];
      if (!schema) err([...p, key], `unknown condition "${key}" (use ${Object.keys(CONDITIONS).join(", ")})`);
      else {
        const r = schema.safeParse(value);
        if (r.success) out[ctx] = { [key]: r.data } as Condition;
        else err([...p, key, ...r.error.issues[0]!.path.map(String)], `invalid ${key} condition: ${r.error.issues[0]!.message}`);
      }
    }
  }
  for (const ctx of contexts) if (!(ctx in raw)) err(at, `context "${ctx}" has no condition`);
  const entries = Object.entries(out);
  const kinds = new Set(entries.map(([, c]) => Object.keys(c)[0]));
  if (kinds.size > 1) err(at, `all contexts must use the same condition kind (got ${[...kinds].join(", ")})`);
  else {
    const overlaps = (a: unknown, b: unknown) => {
      if (!isObj(a) || !isObj(b)) return a === b;
      const [a0, a1, b0, b1] = [a.min ?? 0, a.max ?? Infinity, b.min ?? 0, b.max ?? Infinity] as number[];
      return a0! < b1! && b0! < a1!;
    };
    for (let i = 0; i < entries.length; i++)
      for (let j = i + 1; j < entries.length; j++)
        if (overlaps(Object.values(entries[i]![1])[0], Object.values(entries[j]![1])[0]))
          err(at, `conditions of "${entries[i]![0]}" and "${entries[j]![0]}" overlap`);
  }
  return out;
}

export async function loadTokens(io: ProjectIO, resolverPath: string): Promise<{ tokens: TokenSet; diagnostics: Diagnostic[] }> {
  const diagnostics: Diagnostic[] = [];
  const empty = (): { tokens: TokenSet; diagnostics: Diagnostic[] } => ({ tokens: { collections: [], tokens: new Map() }, diagnostics });
  const err = (file: string, path: (string | number)[], message: string) => diagnostics.push({ file, path, message });

  let doc: unknown;
  try {
    const y = parseYaml(await io.read(resolverPath), resolverPath);
    diagnostics.push(...y.diagnostics);
    doc = y.doc;
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
      const y = parseYaml(text, file);
      diagnostics.push(...y.diagnostics);
      const w = walkTokenTree(y.doc, file);
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
    const ext = (mod as { $extensions?: Record<string, { when?: unknown } | undefined> }).$extensions?.["org.openui"];
    const when = parseWhen(ext?.when, modes, ["modifiers", name, "$extensions", "org.openui", "when"], (p, m) => err(resolverPath, p, m));
    collections.push({ name, kind, modes, defaultMode, ...(when ? { when } : {}) });
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
    if (!type) continue;
    // every mode must agree on the type (renderers and Figma variables hold one type per token)
    const [firstMode] = Object.keys(e.byMode);
    const clash = Object.entries(e.byMode).find(([, d]) => d.type && d.type !== type);
    if (clash) {
      const ownMode = Object.entries(e.byMode).find(([, d]) => d.type === type)?.[0] ?? firstMode;
      err(clash[1].file, path.split("."), `token "${path}" is ${type} in "${ownMode}" but ${clash[1].type} in "${clash[0]}"`);
      continue;
    }
    tokens.set(path, { ...e, type });
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

/** Final (non-alias) value of `path`: each collection uses `modes[collection]`, else its default mode. */
export function resolveToken(set: TokenSet, path: string, modes: Record<string, string>): unknown {
  const byName = new Map(set.collections.map((c) => [c.name, c]));
  const modeOf = (axis: string) => modes[axis] ?? byName.get(axis)?.defaultMode;
  for (let hop = 0; hop < 32; hop++) { // ponytail: hop cap; loaders already report alias cycles
    const e = set.tokens.get(path);
    if (!e) return undefined;
    let value: unknown;
    if (byName.get(e.collection)?.kind === "component") {
      value = e.byMode.default?.value; // last matching $when entry wins (they are in precedence order)
      for (const w of e.when ?? []) if (Object.entries(w.expr).every(([axis, v]) => modeOf(axis) === v)) value = w.value;
    } else {
      const def = e.byMode[modeOf(e.collection)!];
      if (!def) return undefined;
      value = def.value;
    }
    const next = aliasTarget(value);
    if (!next) return value;
    path = next;
  }
  return undefined;
}

/** Collections whose tokens `aliases` depend on, directly or through alias chains in any mode. */
export function collectionsReachedBy(set: TokenSet, aliases: Iterable<string>): Set<string> {
  const out = new Set<string>();
  const seen = new Set<string>();
  const stack = [...aliases];
  while (stack.length) {
    const path = stack.pop()!;
    if (seen.has(path)) continue;
    seen.add(path);
    const e = set.tokens.get(path);
    if (!e) continue;
    out.add(e.collection);
    for (const d of Object.values(e.byMode)) stack.push(...collectAliases(d.value));
    for (const w of e.when ?? []) {
      stack.push(...collectAliases(w.value));
      for (const axis of Object.keys(w.expr)) if (set.collections.some((c) => c.kind === "modifier" && c.name === axis)) out.add(axis);
    }
  }
  return out;
}
