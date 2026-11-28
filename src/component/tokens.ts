import type { Diagnostic } from "../diagnostics";
import type { TokenEntry, TokenSet } from "../tokens/resolver";
import { walkTokenTree } from "../tokens/tree";
import { aliasTarget, typedAliases, valueSchemas, type TokenType } from "../tokens/values";
import type { Component } from "./schema";
import { parseVariantExpr } from "./validate";

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Mode props of a component: the instance picks one value; component tokens vary by it in `$when`. */
export function modePropsOf(doc: Component): Record<string, { values: string[]; default: string }> {
  return Object.fromEntries(
    Object.entries(doc.data.props ?? {}).flatMap(([name, d]) => (d.type === "mode" ? [[name, { values: d.values, default: d.default }]] : [])),
  );
}

/**
 * §4.7 `data.tokens`: the tokens this component uses, as a DTCG token tree. Paths are `<component id>.<path>`.
 * Values may alias global tokens or this component's tokens; `$when` maps `mode=value(,mode=value)*` — mode props of
 * the component or global modifiers — to the value that applies then (fewest modes first, then document order).
 */
export function loadComponentTokens(doc: Component, file: string, global: TokenSet): { entries: Map<string, TokenEntry>; diagnostics: Diagnostic[] } {
  const id = doc.metadata.id;
  const diagnostics: Diagnostic[] = [];
  const entries = new Map<string, TokenEntry>();
  if (doc.data.tokens === undefined) return { entries, diagnostics };
  const at = (p: (string | number)[]) => ["data", "tokens", ...p];
  const err = (p: (string | number)[], message: string) => diagnostics.push({ file, path: at(p), message });

  const walked = walkTokenTree(doc.data.tokens, file, { allowWhen: true });
  for (const d of walked.diagnostics) diagnostics.push({ ...d, path: at(d.path) });
  const local = new Map(walked.tokens.map((t) => [`${id}.${t.path}`, t]));
  const rel = (path: string) => path.slice(id.length + 1).split(".");

  const typeOf = (path: string, seen: Set<string>): TokenType | null => {
    const l = local.get(path);
    if (!l) return global.tokens.get(path)?.type ?? null;
    if (l.type) return l.type;
    const a = aliasTarget(l.value);
    return a && !seen.has(path) ? typeOf(a, new Set([...seen, path])) : null;
  };

  const modes = modePropsOf(doc);
  const modifiers = new Map(global.collections.filter((c) => c.kind === "modifier").map((c) => [c.name, c.modes]));
  for (const [path, def] of local) {
    const p = rel(path);
    const type = typeOf(path, new Set());
    if (!type) {
      err(p, `cannot determine $type of token "${path}"`);
      continue;
    }
    const when: { expr: Record<string, string>; value: unknown; order: number }[] = [];
    if (def.when !== undefined) {
      if (!isObj(def.when)) err([...p, "$when"], "$when must map mode expressions (mode=value) to values");
      else
        Object.entries(def.when).forEach(([expr, value], order) => {
          const wp = [...p, "$when", expr];
          const pairs = expr === "base" ? null : parseVariantExpr(expr);
          if (!pairs) return err(wp, `invalid $when key "${expr}" (use mode=value or mode=value,mode=value)`);
          const sel: Record<string, string> = {};
          for (const pair of pairs) {
            const [axis, v] = Object.entries(pair)[0]!;
            const values = modes[axis]?.values ?? modifiers.get(axis);
            if (!values) return err(wp, `unknown mode "${axis}" (mode props: ${Object.keys(modes).join(", ") || "none"}; modifiers: ${[...modifiers.keys()].join(", ") || "none"})`);
            if (!values.includes(v)) return err(wp, `unknown value "${v}" for mode "${axis}" (${values.join(", ")})`);
            if (axis in sel) return err(wp, `mode "${axis}" appears twice in "${expr}"`);
            sel[axis] = v;
          }
          const r = valueSchemas[type].safeParse(value);
          if (!r.success) return err(wp, `invalid ${type} value: ${r.error.issues[0]!.message}`);
          when.push({ expr: sel, value, order });
        });
    }
    when.sort((a, b) => Object.keys(a.expr).length - Object.keys(b.expr).length || a.order - b.order);
    entries.set(path, {
      collection: id, type, byMode: { default: def },
      ...(when.length ? { when: when.map(({ expr, value }) => ({ expr, value })) } : {}),
    });
  }

  // aliases: this component's tokens or global ones, of the type each position expects; no cycles
  const edges = new Map<string, string[]>();
  for (const [path, e] of entries) {
    const values: [string[], unknown][] = [[["$value"], e.byMode.default!.value], ...(e.when ?? []).map((w): [string[], unknown] => [["$when", Object.entries(w.expr).map(([a, v]) => `${a}=${v}`).join(",")], w.value])];
    const out: string[] = [];
    for (const [where, value] of values)
      for (const { alias, expected } of typedAliases(e.type, value)) {
        const target = alias.startsWith(`${id}.`) ? entries.get(alias) ?? (local.has(alias) ? null : undefined) : global.tokens.get(alias);
        if (target === undefined) err([...rel(path), ...where], `unknown token "{${alias}}"`);
        else if (target && target.type !== expected) err([...rel(path), ...where], `alias "{${alias}}" type mismatch: expected ${expected}, got ${target.type}`);
        if (alias.startsWith(`${id}.`)) out.push(alias);
      }
    edges.set(path, out);
  }
  const state = new Map<string, 1 | 2>();
  const visit = (node: string, stack: string[]) => {
    state.set(node, 1);
    for (const next of edges.get(node) ?? []) {
      if (state.get(next) === 1) err(rel(node), `alias cycle: ${[...stack.slice(stack.indexOf(next)), next].join(" -> ")}`);
      else if (!state.has(next)) visit(next, [...stack, next]);
    }
    state.set(node, 2);
  };
  for (const node of edges.keys()) if (!state.has(node)) visit(node, [node]);
  return { entries, diagnostics };
}
