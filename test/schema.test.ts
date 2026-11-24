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
  expect(Component.safeParse(y(ok.replace("default: Chip", "default: 3"))).success).toBe(false);
  expect(Component.safeParse(y(ok.replace("max: 1", "max: 0"))).success).toBe(false);
});
test("value shorthand", () => {
  expect(Component.safeParse(y(ok.replace("gap: 8px", "gap: 8"))).success).toBe(false);
  expect(Component.safeParse(y(ok.replace('"#6750A4"', "red"))).success).toBe(false);
  expect(Component.safeParse(y(ok.replace('"#6750A4"', '"#6750A4CC"'))).success).toBe(true);
});
test("layout block rejects non-layout keys", () => {
  expect(Component.safeParse(y(ok.replace("gap: 8px,", "gap: 8px, fill: '#000000',"))).success).toBe(false);
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
