import { Checklist } from "./checklist/schema";
import { validateChecklist } from "./checklist/validate";
import { Component, type PartNode } from "./component/schema";
import { loadComponentTokens } from "./component/tokens";
import { validateComponent } from "./component/validate";
import { fromZod, type Diagnostic } from "./diagnostics";
import { globToRegExp } from "./glob";
import type { ProjectIO } from "./io";
import { Manifest } from "./manifest";
import { loadTokens, type TokenSet } from "./tokens/resolver";
import { parseYaml } from "./yaml";

export type Project = {
  manifest: Manifest;
  tokens: TokenSet;
  components: Map<string, { file: string; doc: Component }>;
  /** Keyed by the checked component id. */
  checklists: Map<string, { file: string; doc: Checklist }>;
};

const MANIFEST = "openui.yaml";

export async function loadProject(io: ProjectIO): Promise<{ project?: Project; diagnostics: Diagnostic[] }> {
  const diagnostics: Diagnostic[] = [];
  let text: string;
  try {
    text = await io.read(MANIFEST);
  } catch (e) {
    return { diagnostics: [{ file: MANIFEST, path: [], message: `cannot read manifest: ${(e as Error).message}` }] };
  }
  const m = parseYaml(text, MANIFEST);
  diagnostics.push(...m.diagnostics);
  const manifest = Manifest.safeParse(m.doc);
  if (!manifest.success) return { diagnostics: [...diagnostics, ...fromZod(manifest.error, MANIFEST)] };

  const t = await loadTokens(io, manifest.data.tokens);
  diagnostics.push(...t.diagnostics);

  const all = await io.list();
  const matching = (key: "components" | "checklists") => {
    const patterns = manifest.data[key] ?? [];
    patterns.forEach((pattern, i) => {
      if (!all.some((f) => globToRegExp(pattern).test(f))) diagnostics.push({ file: MANIFEST, path: [key, i], message: `"${pattern}" matches no files` });
    });
    const globs = patterns.map(globToRegExp);
    return all.filter((f) => globs.some((g) => g.test(f)));
  };
  const files = matching("components");
  const components = new Map<string, { file: string; doc: Component }>();
  for (const file of files) {
    const y = parseYaml(await io.read(file), file);
    diagnostics.push(...y.diagnostics);
    const c = Component.safeParse(y.doc);
    if (!c.success) {
      diagnostics.push(...fromZod(c.error, file));
      continue;
    }
    const prev = components.get(c.data.metadata.id);
    if (prev) {
      diagnostics.push({ file, path: ["metadata", "id"], message: `duplicate metadata.id "${c.data.metadata.id}" (also in ${prev.file})` });
      continue;
    }
    components.set(c.data.metadata.id, { file, doc: c.data });
  }

  // Instance graph (fixed `component:` refs + instance-prop defaults) must be acyclic: every instance is rendered.
  const edges = (doc: Component): string[] => {
    const out = Object.values(doc.data.props ?? {}).flatMap((p) => (p.type === "instance" && p.default ? [p.default] : []));
    const walk = (part: PartNode) => {
      if (part.kind === "instance" && part.component) out.push(part.component);
      Object.values(part.children ?? {}).forEach(walk);
    };
    walk(doc.data.anatomy.root as PartNode);
    return out;
  };
  const seen = new Set<string>();
  const reported = new Set<string>();
  const visit = (id: string, stack: string[]) => {
    if (stack.includes(id)) {
      const cycle = [...stack.slice(stack.indexOf(id)), id];
      const key = [...new Set(cycle)].sort().join(",");
      if (!reported.has(key)) {
        reported.add(key);
        diagnostics.push({ file: components.get(id)!.file, path: ["data", "anatomy"], message: `instance cycle: ${cycle.join(" → ")}` });
      }
      return;
    }
    if (seen.has(id) || !components.has(id)) return;
    seen.add(id);
    for (const next of edges(components.get(id)!.doc)) visit(next, [...stack, id]);
  };
  for (const id of [...components.keys()].sort()) visit(id, []);

  // Component tokens (§4.7) join the token set under their component's namespace.
  const tokens: TokenSet = { collections: [...t.tokens.collections], tokens: new Map(t.tokens.tokens) };
  for (const [path, e] of t.tokens.tokens) {
    const owner = [...components.keys()].find((id) => path.startsWith(`${id}.`));
    if (owner) diagnostics.push({ file: Object.values(e.byMode)[0]!.file, path: path.split("."), message: `token "${path}" is in the namespace of component "${owner}": component tokens live in its data.tokens` });
  }
  for (const [id, { file, doc }] of components) {
    const c = loadComponentTokens(doc, file, t.tokens);
    diagnostics.push(...c.diagnostics);
    tokens.collections.push({ name: id, kind: "component", modes: ["default"], defaultMode: "default" });
    for (const [path, e] of c.entries) tokens.tokens.set(path, e);
  }

  // Components with semantic errors stay in the project so the editor can still preview them.
  const ctx = { tokens, componentIds: new Set(components.keys()) };
  for (const { file, doc } of components.values()) diagnostics.push(...validateComponent(doc, file, ctx));

  const checklists = new Map<string, { file: string; doc: Checklist }>();
  const project: Project = { manifest: manifest.data, tokens, components, checklists };
  for (const file of matching("checklists")) {
    const y = parseYaml(await io.read(file), file);
    diagnostics.push(...y.diagnostics);
    const c = Checklist.safeParse(y.doc);
    if (!c.success) {
      diagnostics.push(...fromZod(c.error, file));
      continue;
    }
    const prev = checklists.get(c.data.metadata.component);
    if (prev) {
      diagnostics.push({ file, path: ["metadata", "component"], message: `component "${c.data.metadata.component}" already has a checklist (${prev.file})` });
      continue;
    }
    diagnostics.push(...validateChecklist(c.data, file, project));
    checklists.set(c.data.metadata.component, { file, doc: c.data });
  }

  return { project, diagnostics };
}
