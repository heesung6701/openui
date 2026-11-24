import type { Component } from "../component/schema";
import { statesOf, variantAxes } from "../component/validate";
import { aliasesToVars } from "../render/css-var";
import type { TokenSet } from "../tokens/resolver";
import type { Check, Checklist } from "./schema";

export type Case = { variant: Record<string, string>; state: string; mode: Record<string, string> };
export type Measure = (c: Case & { part: string; property: string; expectCss: string }) => Promise<{ actual: string; expected: string }>;
export type CaseResult = Case & { actual: string; expected: string; pass: boolean };
export type ItemResult = { id: string; title: string; kind: "auto" | "manual"; pass: boolean | null; cases: CaseResult[] };

const list = (v: string | string[] | undefined): string[] | undefined => (v === undefined ? undefined : Array.isArray(v) ? v : [v]);

const product = (dims: [string, string[]][]): Record<string, string>[] =>
  dims.reduce<Record<string, string>[]>((acc, [k, vs]) => acc.flatMap((c) => vs.map((v) => ({ ...c, [k]: v }))), [{}]);

/** Omitted axis / state / modifier = every value. Order: variant axes → state → modifiers. */
export function expandCheck(check: Check, doc: Component, tokens: TokenSet): Case[] {
  const variants = product(Object.entries(variantAxes(doc)).map(([axis, { values }]) => [axis, list(check.variant?.[axis]) ?? values]));
  const states = list(check.state) ?? statesOf(doc);
  const modes = product(tokens.collections.filter((c) => c.kind === "modifier").map((c) => [c.name, list(check.mode?.[c.name]) ?? c.modes]));
  return variants.flatMap((variant) => states.flatMap((state) => modes.map((mode) => ({ variant, state, mode }))));
}

export const expectToCss = (expect: string | number): string => (typeof expect === "number" ? String(expect) : aliasesToVars(expect));

const PX = /^-?\d+(\.\d+)?px$/;
/** Equal strings, or both px lengths within 0.05px (layout rounding). */
export function sameCss(a: string, b: string): boolean {
  if (a === b) return true;
  return PX.test(a) && PX.test(b) && Math.abs(parseFloat(a) - parseFloat(b)) < 0.05;
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
      const { actual, expected } = await measure({ ...c, part, property, expectCss });
      cases.push({ ...c, actual, expected, pass: sameCss(actual, expected) });
    }
    out.push({ id: item.id, title: item.title, kind: "auto", pass: cases.length > 0 && cases.every((c) => c.pass), cases });
  }
  return out;
}
