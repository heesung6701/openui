import { Checklist } from "./checklist/schema";
import { validateChecklist } from "./checklist/validate";
import { Component } from "./component/schema";
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
  const matching = (patterns: string[] = []) => {
    const globs = patterns.map(globToRegExp);
    return all.filter((f) => globs.some((g) => g.test(f)));
  };
  const files = matching(manifest.data.components);
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

  // Components with semantic errors stay in the project so the editor can still preview them.
  const ctx = { tokens: t.tokens, componentIds: new Set(components.keys()) };
  for (const { file, doc } of components.values()) diagnostics.push(...validateComponent(doc, file, ctx));

  const checklists = new Map<string, { file: string; doc: Checklist }>();
  const project: Project = { manifest: manifest.data, tokens: t.tokens, components, checklists };
  for (const file of matching(manifest.data.checklists)) {
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
