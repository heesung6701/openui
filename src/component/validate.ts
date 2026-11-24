import type { Diagnostic } from "../diagnostics";
import type { TokenSet } from "../tokens/resolver";
import { collectAliases } from "../tokens/values";
import { Ident, STYLE_PROPERTIES, type Component, type PartKind, type PartNode } from "./schema";

export type ValidateContext = { tokens: TokenSet; componentIds: Set<string> };

export function variantAxes(doc: Component): Record<string, { values: string[]; default: string }> {
  return Object.fromEntries(
    Object.entries(doc.data.variants ?? {}).map(([axis, v]) => [axis, { values: Object.keys(v.values), default: v.default }]),
  );
}

export const statesOf = (doc: Component): string[] => doc.data.states ?? ["enabled"];

export function partsOf(doc: Component): Map<string, { kind: PartKind; part: PartNode; parent: string | null }> {
  const out = new Map<string, { kind: PartKind; part: PartNode; parent: string | null }>();
  const walk = (name: string, part: PartNode, parent: string | null) => {
    if (!out.has(name)) out.set(name, { kind: part.kind, part, parent });
    for (const [child, p] of Object.entries(part.children ?? {})) walk(child, p, name);
  };
  walk("root", doc.data.anatomy.root as PartNode, null);
  return out;
}

/** Parse `base` or `axis=value(,axis=value)*`. Returns null when malformed. */
export function parseVariantExpr(expr: string): Record<string, string>[] | null {
  if (expr === "base") return [];
  const pairs = expr.split(",").map((p) => p.split("="));
  if (pairs.some((p) => p.length !== 2 || !p[0] || !p[1])) return null;
  return pairs.map(([k, v]) => ({ [k!]: v! }));
}

export function validateComponent(doc: Component, file: string, ctx: ValidateContext): Diagnostic[] {
  const out: Diagnostic[] = [];
  const err = (path: (string | number)[], message: string) => out.push({ file, path, message });
  const props = doc.data.props ?? {};
  const axes = variantAxes(doc);
  const states = statesOf(doc);
  const parts = partsOf(doc);
  const bound = new Map<string, number>();
  const bind = (prop: string) => bound.set(prop, (bound.get(prop) ?? 0) + 1);

  const checkValue = (prop: string, value: unknown, kind: PartKind, partName: string, path: (string | number)[]) => {
    const def = STYLE_PROPERTIES[prop];
    if (!def) return err(path, `unknown property "${prop}"`);
    if (def.parts !== "all" && !def.parts.includes(kind)) return err(path, `property "${prop}" is not allowed on ${kind} part "${partName}"`);
    const r = def.schema.safeParse(value);
    if (!r.success) return err(path, `invalid value for "${prop}": ${r.error.issues[0]!.message}`);
    for (const alias of collectAliases(value)) {
      const t = ctx.tokens.tokens.get(alias);
      if (!t) err(path, `unknown token "{${alias}}"`);
      else if (!def.tokenTypes.includes(t.type)) err(path, `token "{${alias}}" is ${t.type}, "${prop}" expects ${def.tokenTypes.join(" | ") || "a literal"}`);
    }
  };

  // anatomy
  const root = doc.data.anatomy.root as PartNode;
  if (root.kind !== "frame") err(["data", "anatomy", "root", "kind"], `anatomy root must be a frame, got ${root.kind}`);
  const seen = new Set<string>();
  const walk = (name: string, part: PartNode, path: (string | number)[]) => {
    if (seen.has(name)) err(path, `duplicate part name "${name}"`);
    seen.add(name);
    if (name !== "root" && !Ident.safeParse(name).success) err(path, `part name "${name}" must match ^[a-z][a-zA-Z0-9]*$`);
    const propOf = (p: string, type: string, at: string) => {
      const def = props[p];
      if (!def) err([...path, at], `unknown prop "${p}"`);
      else if (def.type !== type) err([...path, at], `prop "${p}" is ${def.type}, expected a ${type} prop`);
      else bind(p);
    };
    if (part.kind === "text" && part.text && typeof part.text === "object") propOf(part.text.prop, "text", "text");
    if (part.visible) propOf(part.visible.prop, "boolean", "visible");
    if (part.kind === "instance") {
      if (part.prop) propOf(part.prop, "instance", "prop");
      if (part.component && !ctx.componentIds.has(part.component)) err([...path, "component"], `unknown component "${part.component}"`);
    }
    if (part.kind === "slot" && part.prop) propOf(part.prop, "slot", "prop");
    for (const [k, v] of Object.entries(part.layout ?? {})) checkValue(k, v, part.kind, name, [...path, "layout", k]);
    for (const [child, p] of Object.entries(part.children ?? {})) walk(child, p, [...path, "children", child]);
  };
  walk("root", root, ["data", "anatomy", "root"]);

  // props
  for (const [name, def] of Object.entries(props)) {
    const at = ["data", "props", name];
    const n = bound.get(name) ?? 0;
    if (n === 0) err(at, `prop "${name}" is not bound to any part`);
    if (def.type === "slot" && n > 1) err(at, `slot prop "${name}" is bound by ${n} parts`);
    if (def.type === "slot" && def.min !== undefined && def.max !== undefined && def.min > def.max) err(at, "slot min must be <= max");
    if (def.type === "instance" || def.type === "slot") {
      const refs = [...(def.type === "instance" && def.default ? [def.default] : []), ...(def.preferred ?? [])];
      for (const id of refs) if (!ctx.componentIds.has(id)) err(at, `unknown component "${id}"`);
    }
  }

  // variants / states
  if ("state" in axes) err(["data", "variants", "state"], 'variant axis must not be named "state" (reserved for states)');

  // styles
  for (const [expr, byState] of Object.entries(doc.data.styles ?? {})) {
    const at = ["data", "styles", expr];
    const pairs = parseVariantExpr(expr);
    if (!pairs) err(at, `invalid variant expression "${expr}" (use base or axis=value,axis=value)`);
    else {
      const used = new Set<string>();
      for (const pair of pairs) {
        const [axis, value] = Object.entries(pair)[0]!;
        if (used.has(axis)) err(at, `axis "${axis}" appears twice in "${expr}"`);
        used.add(axis);
        if (!axes[axis]) err(at, `unknown variant axis "${axis}"`);
        else if (!axes[axis].values.includes(value)) err(at, `unknown value "${value}" for axis "${axis}"`);
      }
    }
    for (const [state, byPart] of Object.entries(byState ?? {})) {
      const sat = [...at, state];
      if (state.includes(",")) err(sat, `state combinations are not supported in openui 0.1: "${state}"`);
      else if (!states.includes(state)) err(sat, `unknown state "${state}" (declared: ${states.join(", ")})`);
      for (const [partName, cell] of Object.entries(byPart ?? {})) {
        const part = parts.get(partName);
        if (!part) {
          err([...sat, partName], `unknown part "${partName}"`);
          continue;
        }
        for (const [prop, value] of Object.entries(cell ?? {})) checkValue(prop, value, part.kind, partName, [...sat, partName, prop]);
      }
    }
  }

  // x-figma
  for (const [partName, fields] of Object.entries(doc.data["x-figma"]?.parts ?? {})) {
    const at = ["data", "x-figma", "parts", partName];
    if (!parts.has(partName)) err(at, `unknown part "${partName}"`);
    for (const k of Object.keys(fields)) if (k in STYLE_PROPERTIES) err([...at, k], `x-figma field "${k}" duplicates core property "${k}"`);
  }

  return out;
}
