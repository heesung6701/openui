import type { Component } from "../component/schema";
import { statesOf, variantAxes } from "../component/validate";
import { aliasesToVars } from "../render/css-var";
import { collectionsReachedBy, resolveToken, type TokenSet } from "../tokens/resolver";
import { aliasTarget, collectAliases } from "../tokens/values";
import type { Check, Checklist } from "./schema";

export type Case = { variant: Record<string, string>; state: string; mode: Record<string, string> };
export type Measure = (c: Case & { part: string; property: string; expectCss: string }) => Promise<{ actual: string; expected: string }>;
export type CaseResult = Case & { actual: string; expected: string; pass: boolean };
export type ItemResult = { id: string; title: string; kind: "auto" | "manual"; pass: boolean | null; cases: CaseResult[] };

const list = (v: string | string[] | undefined): string[] | undefined => (v === undefined ? undefined : Array.isArray(v) ? v : [v]);

const product = (dims: [string, string[]][]): Record<string, string>[] =>
  dims.reduce<Record<string, string>[]>((acc, [k, vs]) => acc.flatMap((c) => vs.map((v) => ({ ...c, [k]: v }))), [{}]);

/** Modifiers a component's look depends on: through its token references, or chosen by its mode props. */
export function modifiersUsedBy(doc: Component, tokens: TokenSet): Set<string> {
  const used = collectionsReachedBy(tokens, collectAliases(doc.data));
  for (const p of Object.values(doc.data.props ?? {})) if (p.type === "mode") used.add(p.modifier);
  return used;
}

/** Omitted axis / state = every value; omitted modifier = every context if the component uses it, else its default. */
export function expandCheck(check: Check, doc: Component, tokens: TokenSet): Case[] {
  const variants = product(Object.entries(variantAxes(doc)).map(([axis, { values }]) => [axis, list(check.variant?.[axis]) ?? values]));
  const states = list(check.state) ?? statesOf(doc);
  const used = modifiersUsedBy(doc, tokens);
  const modes = product(tokens.collections.filter((c) => c.kind === "modifier")
    .map((c) => [c.name, list(check.mode?.[c.name]) ?? (used.has(c.name) ? c.modes : [c.defaultMode])]));
  return variants.flatMap((variant) => states.flatMap((state) => modes.map((mode) => ({ variant, state, mode }))));
}

export const expectToCss = (expect: string | number): string => (typeof expect === "number" ? String(expect) : aliasesToVars(expect));

const PX = /^-?\d+(\.\d+)?px$/;
const N = "(-?\\d*\\.?\\d+(?:e-?\\d+)?)";
const RGB = new RegExp(`^rgba?\\(${N},\\s*${N},\\s*${N}(?:,\\s*${N})?\\)$`);
const SRGB = new RegExp(`^color\\(srgb ${N} ${N} ${N}(?: / ${N})?\\)$`);
/** A single computed color as [r, g, b] in 0..255 plus alpha; null if `s` is not exactly one rgb()/color(srgb) value. */
function rgba(s: string): number[] | null {
  const m = RGB.exec(s);
  if (m) return [+m[1]!, +m[2]!, +m[3]!, m[4] === undefined ? 1 : +m[4]];
  const c = SRGB.exec(s);
  return c ? [+c[1]! * 255, +c[2]! * 255, +c[3]! * 255, c[4] === undefined ? 1 : +c[4]] : null;
}
/**
 * Equal non-empty strings; both px lengths within 0.05px (layout rounding); or both one color with the same value
 * (browsers serialize color-mix() as color(srgb …) and plain colors as rgb()). Empty = nothing was measured.
 */
export function sameCss(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  if (PX.test(a) && PX.test(b)) return Math.abs(parseFloat(a) - parseFloat(b)) < 0.05;
  const [x, y] = [rgba(a), rgba(b)];
  if (!x || !y) return false;
  if (x[3]! < 0.001 && y[3]! < 0.001) return true; // fully transparent: channels do not matter
  return x.slice(0, 3).every((v, i) => Math.abs(v - y[i]!) < 1) && Math.abs(x[3]! - y[3]!) < 0.002;
}

export async function runChecklist(cl: Checklist, doc: Component, tokens: TokenSet, measure: Measure): Promise<ItemResult[]> {
  const out: ItemResult[] = [];
  for (const item of cl.items) {
    if (!item.check) {
      out.push({ id: item.id, title: item.title, kind: "manual", pass: null, cases: [] });
      continue;
    }
    const { part, property, expect } = item.check;
    const expectCss = expectToCss(expect);
    const cases: CaseResult[] = [];
    for (const c of expandCheck(item.check, doc, tokens)) {
      // `text` = the part's rendered text vs. the text token in this case's locale
      const want = property === "text" ? String(resolveToken(tokens, aliasTarget(expect) ?? "", c.mode) ?? "") : expectCss;
      const { actual, expected } = await measure({ ...c, part, property, expectCss: want });
      cases.push({ ...c, actual, expected, pass: sameCss(actual, expected) });
    }
    out.push({ id: item.id, title: item.title, kind: "auto", pass: cases.length > 0 && cases.every((c) => c.pass), cases });
  }
  return out;
}
