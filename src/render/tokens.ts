import type { TokenSet } from "../tokens/resolver";
import { aliasTarget, FONT_WEIGHT_NAMES, type TokenType } from "../tokens/values";
import { cssSubVar, cssVar } from "./css-var";

type Obj = Record<string, unknown>;
const TYPO_KEYS = ["font-family", "font-size", "font-weight", "letter-spacing", "line-height"] as const;

const sub = (v: unknown, type: TokenType): string => {
  const a = aliasTarget(v);
  return a ? `var(${cssVar(a)})` : (tokenValueCss(type, v) as string);
};

/** §W token → CSS value. Typography expands into five sub-properties. */
export function tokenValueCss(type: TokenType, value: unknown): string | Record<string, string> {
  const alias = aliasTarget(value);
  if (alias) {
    if (type === "typography") return Object.fromEntries(TYPO_KEYS.map((k) => [k, `var(${cssSubVar(alias, k)})`]));
    return `var(${cssVar(alias)})`;
  }
  switch (type) {
    case "color": {
      const { components, alpha } = value as { components: number[]; alpha?: number };
      const [r, g, b] = components.map((c) => Math.round(c * 255));
      return `rgb(${r} ${g} ${b} / ${alpha ?? 1})`;
    }
    case "dimension":
    case "duration": {
      const { value: n, unit } = value as { value: number; unit: string };
      return `${n}${unit}`;
    }
    case "number":
      return String(value);
    case "cubicBezier":
      return `cubic-bezier(${(value as number[]).join(", ")})`;
    case "fontFamily":
      return (Array.isArray(value) ? value : [value]).map((f) => `"${f}"`).join(", ");
    case "fontWeight":
      return String(typeof value === "number" ? value : FONT_WEIGHT_NAMES[value as string]);
    case "shadow":
      return (Array.isArray(value) ? value : [value])
        .map((l) => {
          const a = aliasTarget(l);
          if (a) return `var(${cssVar(a)})`;
          const s = l as Obj;
          const dims = ["offsetX", "offsetY", "blur", "spread"].map((k) => sub(s[k], "dimension")).join(" ");
          return `${s.inset ? "inset " : ""}${dims} ${sub(s.color, "color")}`;
        })
        .join(", ");
    case "gradient":
      return `linear-gradient(180deg, ${(value as Obj[])
        .map((s) => {
          const p = aliasTarget(s.position);
          return `${sub(s.color, "color")} ${p ? `calc(var(${cssVar(p)}) * 100%)` : `${(s.position as number) * 100}%`}`;
        })
        .join(", ")})`;
    case "string":
      throw new Error("string (text) tokens have no CSS value; renderers resolve them into text content");
    case "typography": {
      const t = value as Obj;
      return {
        "font-family": sub(t.fontFamily, "fontFamily"),
        "font-size": sub(t.fontSize, "dimension"),
        "font-weight": sub(t.fontWeight, "fontWeight"),
        "letter-spacing": sub(t.letterSpacing, "dimension"),
        "line-height": sub(t.lineHeight, "number"),
      };
    }
  }
}

/** `.ou-root` carries set tokens + each modifier's default context; one rule per modifier context. Typography expands to `--x__font-size` etc. */
export function tokenSheet(set: TokenSet): string {
  const decls = (path: string, type: TokenType, value: unknown): string[] => {
    const css = tokenValueCss(type, value);
    return typeof css === "string"
      ? [`${cssVar(path)}: ${css};`]
      : Object.entries(css).map(([k, v]) => `${cssSubVar(path, k)}: ${v};`);
  };
  const rule = (selector: string, lines: string[]) => `${selector} {\n${lines.map((l) => `  ${l}`).join("\n")}\n}\n`;
  const kinds = new Map(set.collections.map((c) => [c.name, c]));
  const base: string[] = [];
  const contexts = new Map<string, string[]>();
  for (const [path, e] of set.tokens) {
    if (e.type === "string") continue; // text tokens become text content, not CSS
    const c = kinds.get(e.collection)!;
    for (const [mode, def] of Object.entries(e.byMode)) {
      const lines = decls(path, e.type, def.value);
      if (mode === c.defaultMode) base.push(...lines);
      if (c.kind === "modifier") {
        const sel = `.ou-root[data-${c.name}="${mode}"]`;
        contexts.set(sel, [...(contexts.get(sel) ?? []), ...lines]);
      }
    }
  }
  return rule(".ou-root", base) + [...contexts].map(([sel, lines]) => rule(sel, lines)).join("");
}
