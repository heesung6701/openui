import type { Condition, Range, TokenSet } from "../tokens/resolver";
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

const range = (feature: string, { min, max }: Range) =>
  min !== undefined && max !== undefined ? `(${min}px <= ${feature} < ${max}px)` : min !== undefined ? `(${feature} >= ${min}px)` : `(${feature} < ${max}px)`;

/** §C: a condition as CSS — a media query, or a `:lang()` selector. Device type has no CSS feature: the app sets `data-device`. */
export function conditionCss(c: Condition): { media?: string; lang?: string } | null {
  if ("width" in c) return { media: range("width", c.width) };
  if ("height" in c) return { media: range("height", c.height) };
  if ("orientation" in c) return { media: `(orientation: ${c.orientation})` };
  if ("colorScheme" in c) return { media: `(prefers-color-scheme: ${c.colorScheme})` };
  if ("language" in c) return { lang: c.language };
  return null;
}

/**
 * Global tokens: `.ou-root` carries set tokens + each modifier's default context; per modifier context a conditional
 * rule (media query / `:lang`, only while that modifier is not chosen explicitly) and an explicit `[data-<m>]` rule.
 * Component tokens (§4.7): declared on the component root, then one rule per `$when` entry in precedence order;
 * `:where()` keeps every component rule at zero specificity so source order decides. Text tokens are not CSS.
 */
export function tokenSheet(set: TokenSet): string {
  const decls = (path: string, type: TokenType, value: unknown): string[] => {
    const css = tokenValueCss(type, value);
    return typeof css === "string"
      ? [`${cssVar(path)}: ${css};`]
      : Object.entries(css).map(([k, v]) => `${cssSubVar(path, k)}: ${v};`);
  };
  const rule = (selector: string, lines: string[], pad = "") => `${pad}${selector} {\n${lines.map((l) => `${pad}  ${l}`).join("\n")}\n${pad}}\n`;
  const media = (m: string | undefined, body: string) => (m ? `@media ${m} {\n${body.replace(/^/gm, "  ")}}\n` : body);
  const kinds = new Map(set.collections.map((c) => [c.name, c]));
  const base: string[] = [];
  const contexts = new Map<string, { collection: string; mode: string; lines: string[] }>();
  for (const [path, e] of set.tokens) {
    const c = kinds.get(e.collection)!;
    if (e.type === "string" || c.kind === "component") continue; // text → text content; component tokens below
    for (const [mode, def] of Object.entries(e.byMode)) {
      const lines = decls(path, e.type, def.value);
      if (mode === c.defaultMode) base.push(...lines);
      if (c.kind === "modifier") {
        const key = `${c.name}\u0000${mode}`;
        if (!contexts.has(key)) contexts.set(key, { collection: c.name, mode, lines: [] });
        contexts.get(key)!.lines.push(...lines);
      }
    }
  }
  let conditional = "";
  let explicit = "";
  for (const { collection, mode, lines } of contexts.values()) {
    const cond = kinds.get(collection)!.when?.[mode];
    const css = cond ? conditionCss(cond) : null;
    if (css?.media) conditional += media(css.media, rule(`.ou-root:not([data-${collection}])`, lines));
    if (css?.lang) conditional += rule(`.ou-root:not([data-${collection}]):lang(${css.lang})`, lines);
    explicit += rule(`.ou-root[data-${collection}="${mode}"]`, lines);
  }

  // component tokens
  let component = "";
  for (const c of set.collections.filter((c) => c.kind === "component")) {
    const own = [...set.tokens].filter(([, e]) => e.collection === c.name && e.type !== "string");
    if (!own.length) continue;
    const root = `[data-component="${c.name}"]`;
    component += rule(`:where(${root})`, own.flatMap(([path, e]) => decls(path, e.type, e.byMode.default!.value)));
    for (const [path, e] of own)
      for (const w of e.when ?? []) {
        const modeAttrs = Object.entries(w.expr).filter(([a]) => kinds.get(a)?.kind !== "modifier").map(([a, v]) => `[data-mode-${a}="${v}"]`).join("");
        // each global modifier in the expression: chosen explicitly on .ou-root, or (when it has one) by its condition
        let alts: { compound: string; media: string[] }[] = [{ compound: "", media: [] }];
        for (const [m, v] of Object.entries(w.expr).filter(([a]) => kinds.get(a)?.kind === "modifier")) {
          const cond = kinds.get(m)!.when?.[v];
          const css = cond ? conditionCss(cond) : null;
          const options = [{ compound: `[data-${m}="${v}"]`, media: [] as string[] }];
          if (css?.media) options.push({ compound: `:not([data-${m}])`, media: [css.media] });
          if (css?.lang) options.push({ compound: `:not([data-${m}]):lang(${css.lang})`, media: [] });
          alts = alts.flatMap((a) => options.map((o) => ({ compound: a.compound + o.compound, media: [...a.media, ...o.media] })));
        }
        for (const a of alts) {
          const sel = a.compound ? `:where(.ou-root${a.compound}) :where(${root}${modeAttrs})` : `:where(${root}${modeAttrs})`;
          component += media(a.media.join(" and ") || undefined, rule(sel, decls(path, e.type, w.value)));
        }
      }
  }
  return rule(".ou-root", base) + conditional + explicit + component;
}
