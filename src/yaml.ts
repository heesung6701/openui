import { isMap, isPair, isScalar, isSeq, parseDocument, type Node } from "yaml";
import type { Diagnostic } from "./diagnostics";

/** Parse YAML 1.2 with duplicate-key errors and an unquoted-alias hint. Never throws. */
export function parseYaml(text: string, file: string): { doc: unknown; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const doc = parseDocument(text, { uniqueKeys: true, prettyErrors: true });
  for (const e of doc.errors) diagnostics.push({ file, path: [], message: `YAML: ${e.message.split("\n")[0]}` });

  // `fill: {md.sys.color.primary}` parses as a flow map {"md.sys.color.primary": null}.
  const walk = (node: unknown, path: (string | number)[]) => {
    if (isMap(node)) {
      const only = node.items.length === 1 ? node.items[0] : undefined;
      const key = only && isScalar(only.key) ? only.key.value : undefined;
      const nullValue = only && (only.value === null || (isScalar(only.value) && only.value.value === null));
      if (node.flow && typeof key === "string" && key.includes(".") && nullValue) {
        diagnostics.push({ file, path, message: `alias must be a quoted string: "{${key}}"` });
        return;
      }
      for (const pair of node.items) {
        if (!isPair(pair)) continue;
        const k = isScalar(pair.key) ? String(pair.key.value) : String(pair.key);
        walk(pair.value, [...path, k]);
      }
    } else if (isSeq(node)) node.items.forEach((item, i) => walk(item, [...path, i]));
  };
  walk(doc.contents as Node | null, []);

  let value: unknown = null;
  try {
    value = doc.toJS();
  } catch (e) {
    diagnostics.push({ file, path: [], message: `YAML: ${(e as Error).message}` });
  }
  return { doc: value, diagnostics };
}
