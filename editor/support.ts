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
