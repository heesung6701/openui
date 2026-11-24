import type { Component, PartNode } from "./schema";
import { parseVariantExpr, partsOf, statesOf, variantAxes } from "./validate";

/** Cartesian product of variant values in axis declaration order. */
export function variantCombos(doc: Component): Record<string, string>[] {
  return Object.entries(variantAxes(doc)).reduce<Record<string, string>[]>(
    (acc, [axis, { values }]) => acc.flatMap((combo) => values.map((v) => ({ ...combo, [axis]: v }))),
    [{}],
  );
}

/**
 * §R: anatomy layout → default-state layers → current-state layers.
 * Within a state pass, layers apply by (axis count asc, document order).
 */
export function resolveStyles(doc: Component, variant: Record<string, string>, state: string): Record<string, Record<string, unknown>> {
  const axes = variantAxes(doc);
  const states = statesOf(doc);
  if (!states.includes(state)) throw new Error(`unknown state "${state}"`);
  const full: Record<string, string> = {};
  for (const [axis, { values, default: d }] of Object.entries(axes)) {
    const v = variant[axis] ?? d;
    if (!values.includes(v)) throw new Error(`unknown value "${v}" for axis "${axis}"`);
    full[axis] = v;
  }

  const out: Record<string, Record<string, unknown>> = {};
  for (const [name, { part }] of partsOf(doc)) out[name] = { ...((part as PartNode).layout ?? {}) };

  const layers = Object.entries(doc.data.styles ?? {})
    .map(([expr, byState], order) => ({ pairs: parseVariantExpr(expr), byState, order }))
    .filter((l) => l.pairs && l.pairs.every((p) => Object.entries(p).every(([a, v]) => full[a] === v)))
    .sort((a, b) => a.pairs!.length - b.pairs!.length || a.order - b.order);

  for (const s of state === states[0] ? [state] : [states[0]!, state]) {
    for (const { byState } of layers) {
      for (const [part, cell] of Object.entries(byState?.[s] ?? {})) Object.assign((out[part] ??= {}), cell);
    }
  }
  return out;
}
