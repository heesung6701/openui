import type { PartKind } from "../component/schema";
import { aliasTarget } from "../tokens/values";
import { aliasesToVars, cssVar } from "./css-var";

type Ctx = { parentDirection: string | null; isRoot: boolean };

const val = (x: unknown): string => (typeof x === "number" ? String(x) : aliasesToVars(String(x)));
const half = (w: unknown): string => {
  const m = typeof w === "string" ? /^(-?[\d.]+)(px|rem)$/.exec(w) : null;
  return m ? `${parseFloat(m[1]!) / 2}${m[2]}` : `calc(${val(w)} / 2)`;
};
const pct = (o: unknown): string => {
  const a = aliasTarget(o);
  return a ? `calc(var(${cssVar(a)}) * 100%)` : `${(o as number) * 100}%`;
};
const MAIN = { start: "flex-start", center: "center", end: "flex-end", "space-between": "space-between" } as Record<string, string>;
const CROSS = { start: "flex-start", center: "center", end: "flex-end", baseline: "baseline" } as Record<string, string>;
const TYPO = ["font-family", "font-size", "font-weight", "letter-spacing", "line-height"];

/** §W part → CSS (kebab-case). `props` is one part's resolved style map. */
export function partStyle(kind: PartKind, props: Record<string, unknown>, ctx: Ctx): Record<string, string> {
  const s: Record<string, string> = { "box-sizing": "border-box" };
  const container = kind === "frame" || kind === "slot";
  const absolute = props.position === "absolute";

  if (container) {
    const dir = (props.direction as string | undefined) ?? "none";
    const gap = props.gap === undefined ? undefined : val(props.gap);
    const cross = props.crossGap === undefined ? gap : val(props.crossGap);
    if (dir === "row" || dir === "column") {
      Object.assign(s, { display: "flex", "flex-direction": dir });
      if (gap !== undefined) Object.assign(s, dir === "row" ? { "column-gap": gap, "row-gap": cross! } : { "row-gap": gap, "column-gap": cross! });
      if (props.wrap) s["flex-wrap"] = "wrap";
    } else if (dir === "grid") {
      s.display = "grid";
      const g = props.grid as { columns: number; rows: number } | undefined;
      if (g) Object.assign(s, { "grid-template-columns": `repeat(${g.columns}, max-content)`, "grid-template-rows": `repeat(${g.rows}, auto)` });
      if (gap !== undefined) Object.assign(s, { "column-gap": gap, "row-gap": cross! });
    } else s.display = "block";
    s.position = "relative";
    const align = props.align as { main?: string; cross?: string } | undefined;
    if (align?.main) s["justify-content"] = MAIN[align.main]!;
    if (align?.cross) s["align-items"] = CROSS[align.cross]!;
    if (props.padding !== undefined) s.padding = Array.isArray(props.padding) ? props.padding.map(val).join(" ") : val(props.padding);
  }

  // sizing
  for (const axis of ["width", "height"] as const) {
    const v = props[axis];
    if (v === undefined) continue;
    if (v === "fill") {
      if (absolute) Object.assign(s, axis === "width" ? { left: "0", right: "0" } : { top: "0", bottom: "0" });
      else if (ctx.isRoot || !ctx.parentDirection || ctx.parentDirection === "none" || ctx.parentDirection === "grid") s[axis] = "100%";
      else if ((ctx.parentDirection === "row") === (axis === "width")) Object.assign(s, { flex: "1 1 0", [`min-${axis}`]: "0" });
      else s["align-self"] = "stretch";
    } else {
      s[axis] = v === "hug" ? "max-content" : val(v);
      s["flex-shrink"] = "0";
    }
  }
  for (const k of ["minWidth", "maxWidth", "minHeight", "maxHeight"]) {
    if (props[k] !== undefined) s[k.replace(/[A-Z]/, (c) => `-${c.toLowerCase()}`)] = val(props[k]);
  }
  if (absolute || ((props.x !== undefined || props.y !== undefined) && ctx.parentDirection === "none")) {
    s.position = "absolute";
    s.left ??= props.x === undefined ? "0" : val(props.x);
    s.top ??= props.y === undefined ? "0" : val(props.y);
  }

  // paint
  const shadows: string[] = [];
  if (props.fill !== undefined) {
    const c = val(props.fill);
    if (kind === "vector") Object.assign(s, { fill: `var(--ou-icon-fill, ${c})`, "fill-opacity": `var(--ou-icon-fill-opacity, ${props.fillOpacity === undefined ? 1 : val(props.fillOpacity)})` });
    else if (kind === "instance") {
      s["--ou-icon-fill"] = c;
      if (props.fillOpacity !== undefined) s["--ou-icon-fill-opacity"] = val(props.fillOpacity);
    } else if (props.fillOpacity !== undefined) s["background-color"] = `color-mix(in srgb, ${c} ${pct(props.fillOpacity)}, transparent)`;
    else s.background = c;
  }
  if (props.strokeColor !== undefined) {
    const c = val(props.strokeColor);
    const w = props.strokeWidth ?? "1px";
    if (kind === "vector") Object.assign(s, { stroke: c, "stroke-width": val(w) });
    else if (props.strokeAlign === "outside") shadows.push(`0 0 0 ${val(w)} ${c}`);
    else if (props.strokeAlign === "center") shadows.push(`inset 0 0 0 ${half(w)} ${c}`, `0 0 0 ${half(w)} ${c}`);
    else shadows.push(`inset 0 0 0 ${val(w)} ${c}`);
  }
  if (props.shadow !== undefined) shadows.push(val(props.shadow));
  if (shadows.length) s["box-shadow"] = shadows.join(", ");
  if (props.cornerRadius !== undefined) s["border-radius"] = Array.isArray(props.cornerRadius) ? props.cornerRadius.map(val).join(" ") : val(props.cornerRadius);
  if (props.opacity !== undefined) s.opacity = val(props.opacity);

  // text
  if (kind === "text") {
    s["white-space"] = "nowrap";
    if (props.color !== undefined) s.color = val(props.color);
    const t = aliasTarget(props.typography);
    if (t) for (const k of TYPO) s[k] = `var(${cssVar(t)}-${k})`;
    if (props.textAlign !== undefined) s["text-align"] = props.textAlign === "justified" ? "justify" : String(props.textAlign);
  }
  if (kind === "image") s["object-fit"] = "cover";
  if (props.visible === false) s.display = "none";
  return s;
}
