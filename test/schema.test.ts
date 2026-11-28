import { expect, test } from "bun:test";
import { parse } from "yaml";
import { Component } from "../src/component/schema";
import { genSchemas } from "../scripts/gen-schema";
import { CHIP_YAML as ok } from "./helpers";

const y = (s: string) => parse(s);
test("valid component parses", () => expect(Component.safeParse(y(ok)).success).toBe(true));
test("unknown non-x key at data and part level rejected", () => {
  expect(Component.safeParse(y(ok.replace("x-note", "note"))).success).toBe(false);
  expect(Component.safeParse(y(ok.replace("kind: text,", "kind: text, colour: red,"))).success).toBe(false);
});
test("prop rules", () => {
  expect(Component.safeParse(y(ok.replace('default: "{text.chip.label}"', "default: 3"))).success).toBe(false);
  expect(Component.safeParse(y(ok.replace("max: 1", "max: 0"))).success).toBe(false);
});
test("values are tokens: literal dimension, color and number values are rejected; keywords stay", () => {
  const bad = (from: string, to: string) => {
    const r = Component.safeParse(y(ok.replace(from, to)));
    expect(r.success).toBe(false);
    return r.error!.issues.map((i) => i.message).join("\n");
  };
  expect(bad('gap: "{chip.g}"', "gap: 8px")).toContain("token");
  expect(bad('fill: "{chip.c}"', 'fill: "#6750A4"')).toContain("token");
  expect(bad('fill: "{chip.c}"', "fill: transparent")).toContain("token");
  expect(bad('padding: ["{chip.z}", "{chip.p}"]', "padding: [0, 12px]")).toContain("token");
  expect(bad('cornerRadius: "{chip.r}"', "cornerRadius: 0")).toContain("token");
  expect(bad('root: { direction: column }', "root: { opacity: 0.5 }")).toContain("token");
  expect(Component.safeParse(y(ok.replace("width: hug", "width: fill"))).success).toBe(true);
});
test("layout block rejects non-layout keys", () => {
  expect(Component.safeParse(y(ok.replace('gap: "{chip.g}",', 'gap: "{chip.g}", fill: "{chip.c}",'))).success).toBe(false);
});
test("vector needs svg, image needs src", () => {
  const vec = ok.replace("tail: { kind: slot, prop: trailing }", "tail: { kind: slot, prop: trailing }\n        v: { kind: vector }");
  expect(Component.safeParse(y(vec)).success).toBe(false);
  expect(Component.safeParse(y(vec.replace("{ kind: vector }", '{ kind: vector, svg: { viewBox: "0 0 24 24", d: "M0 0h24v24H0z" } }'))).success).toBe(true);
  expect(Component.safeParse(y(vec.replace("{ kind: vector }", "{ kind: image }"))).success).toBe(false);
});
test("JSON Schema: x- extension rule and committed files fresh", async () => {
  const out = genSchemas();
  expect(out["component.schema.json"]).toContain('"^x-"');
  for (const [name, text] of Object.entries(out)) expect(await Bun.file(`schema/${name}`).text()).toBe(text);
});

test("text tokens: literal text in a text part or a text prop default is rejected", () => {
  const lit = ok.replace("text: { prop: label }", "text: Hello");
  const r = Component.safeParse(y(lit));
  expect(r.success).toBe(false);
  expect(r.error!.issues[0]!.message).toContain("text token");
  expect(Component.safeParse(y(ok.replace("text: { prop: label }", 'text: "{text.chip.label}"'))).success).toBe(true);
  const def = Component.safeParse(y(ok.replace('default: "{text.chip.label}"', "default: Chip")));
  expect(def.success).toBe(false);
  expect(def.error!.issues[0]!.message).toContain("text token");
});
