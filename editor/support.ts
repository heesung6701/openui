import { isNode, parseDocument } from "yaml";

/** Source range of the node at `path`; walks up to the nearest existing ancestor. Never throws. */
export function rangeOf(text: string, path: (string | number)[]): { from: number; to: number } {
  try {
    const doc = parseDocument(text);
    for (let n = path.length; n > 0; n--) {
      const node = doc.getIn(path.slice(0, n), true);
      if (isNode(node) && node.range) return { from: node.range[0], to: node.range[1] };
    }
  } catch {
    // broken YAML: fall through to the document start
  }
  return { from: 0, to: 0 };
}

/** Token-path completions while typing inside `"{…`. */
export function tokenCompletion(textBefore: string, tokenPaths: string[]): { from: number; options: string[] } | null {
  const m = /"\{([\w.-]*)$/.exec(textBefore);
  if (!m) return null;
  const prefix = m[1]!;
  return { from: textBefore.length - prefix.length, options: tokenPaths.filter((p) => p.startsWith(prefix)) };
}

export const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

type Buf = { text: string; saved: string };
type Diag = { file: string; path: (string | number)[]; message: string };

/** File list HTML. File names and YAML keys are untrusted (cloned repos, PRs): always escaped. */
export function filesHtml(files: string[], buffers: Map<string, Buf>, current: string, diagnostics: Diag[]): string {
  return files
    .map((f) => {
      const b = buffers.get(f);
      const errors = diagnostics.filter((d) => d.file === f).length;
      const dirty = b && b.text !== b.saved ? "● " : "";
      return `<div class="file${f === current ? " active" : ""}" data-file="${escapeHtml(f)}">${dirty}${escapeHtml(f)}${errors ? ` <span class="err">${errors}</span>` : ""}</div>`;
    })
    .join("");
}

export function problemsHtml(diagnostics: Diag[]): string {
  return `<div class="title">Problems (${diagnostics.length})</div>` +
    diagnostics.map((x, i) => `<div class="problem" data-i="${i}"><b>${escapeHtml(x.file)}</b> ${escapeHtml(x.path.join("."))}: ${escapeHtml(x.message)}</div>`).join("");
}

/**
 * What the preview should show for the open file: a live render, the last good render (while the file has YAML
 * syntax errors or its component fails the schema), or nothing.
 */
export function previewMode(file: string, componentFound: boolean, diagnostics: Diag[], lastGoodFile: string | null): "render" | "keep" | "none" {
  const yamlBroken = diagnostics.some((d) => d.file === file && d.message.startsWith("YAML:"));
  if (componentFound && !yamlBroken) return "render";
  if (lastGoodFile === file) return "keep";
  return componentFound ? "render" : "none";
}

type Cond = { width?: { min?: number; max?: number }; height?: { min?: number; max?: number }; orientation?: string; device?: string; colorScheme?: string; language?: string };
/** Short label of a mode condition for the mode picker, e.g. `600 ≤ width < 840`. */
export function describeCondition(c: Cond): string {
  const range = (f: string, r: { min?: number; max?: number }) =>
    r.min !== undefined && r.max !== undefined ? `${r.min} ≤ ${f} < ${r.max}` : r.min !== undefined ? `${f} ≥ ${r.min}` : `${f} < ${r.max}`;
  if (c.width) return range("width", c.width);
  if (c.height) return range("height", c.height);
  return String(c.orientation ?? c.device ?? c.colorScheme ?? c.language ?? "");
}
