import { expect, test } from "bun:test";
import { walkTokenTree } from "../src/tokens/tree";
import { loadTokens, resolveToken } from "../src/tokens/resolver";
import { memoryIO, resolvePath } from "../src/io";
import { msgs } from "./helpers";

const c = (r: number, g: number, b: number) => ({ colorSpace: "srgb", components: [r, g, b] });

test("resolvePath", () => {
  expect(resolvePath("tokens/m3.resolver.yaml", "../x/a.tokens.yaml")).toBe("x/a.tokens.yaml");
  expect(resolvePath("r.yaml", "./a.yaml")).toBe("a.yaml");
});
test("group $type is inherited; token path is dot-joined", () => {
  const r = walkTokenTree({ md: { ref: { $type: "color", primary40: { $value: c(0.4, 0.31, 0.64) } } } }, "a");
  expect(r.diagnostics).toEqual([]);
  expect(r.tokens[0]).toMatchObject({ path: "md.ref.primary40", type: "color" });
});
test("$value with children is an error", () => {
  expect(msgs(walkTokenTree({ a: { $type: "number", $value: 1, b: { $value: 2 } } }, "a").diagnostics)).toContain("$value");
});
test("forbidden names and missing $type", () => {
  expect(walkTokenTree({ "a.b": { $type: "number", $value: 1 } }, "a").diagnostics.length).toBe(1);
  expect(msgs(walkTokenTree({ a: { $value: 1 } }, "a").diagnostics)).toContain("$type");
});
test("color: hex string and non-srgb rejected; srgb object accepted", () => {
  expect(walkTokenTree({ a: { $type: "color", $value: "#ff0000" } }, "a").diagnostics.length).toBe(1);
  expect(walkTokenTree({ a: { $type: "color", $value: { colorSpace: "oklch", components: [0.5, 0.1, 20] } } }, "a").diagnostics.length).toBe(1);
  expect(walkTokenTree({ a: { $type: "color", $value: { ...c(1, 0, 0), alpha: 0.5, hex: "#ff0000" } } }, "a").diagnostics).toEqual([]);
});
test("dimension needs {value, unit px|rem}", () => {
  expect(walkTokenTree({ a: { $type: "dimension", $value: 8 } }, "a").diagnostics.length).toBe(1);
  expect(walkTokenTree({ a: { $type: "dimension", $value: { value: 8, unit: "em" } } }, "a").diagnostics.length).toBe(1);
  expect(walkTokenTree({ a: { $type: "dimension", $value: { value: 8, unit: "px" } } }, "a").diagnostics).toEqual([]);
});
test("alias allowed top-level and inside composite", () => {
  const shadow = { color: "{a}", offsetX: { value: 0, unit: "px" }, offsetY: { value: 1, unit: "px" }, blur: { value: 2, unit: "px" }, spread: { value: 0, unit: "px" } };
  expect(walkTokenTree({ a: { $type: "color", $value: c(0, 0, 0) }, b: { $value: "{a}" }, s: { $type: "shadow", $value: shadow } }, "f").diagnostics).toEqual([]);
});
test("unsupported features say so", () => {
  for (const doc of [{ a: { $type: "border", $value: {} } }, { g: { $extends: "{x}" } }, { g: { $root: { $type: "number", $value: 1 } } }])
    expect(msgs(walkTokenTree(doc, "a").diagnostics)).toContain("unsupported in openui 0.1");
});

const resolver = `version: "2025.10"
sets: { base: { sources: [{ $ref: base.tokens.yaml }] } }
modifiers: { theme: { contexts: { light: [{ $ref: light.tokens.yaml }], dark: [{ $ref: dark.tokens.yaml }] } } }
resolutionOrder: [{ $ref: "#/sets/base" }, { $ref: "#/modifiers/theme" }]
`;
const base = `gray: { $type: color, w: { $value: { colorSpace: srgb, components: [1, 1, 1] } }, k: { $value: { colorSpace: srgb, components: [0, 0, 0] } } }
space: { $type: dimension, s: { $value: { value: 4, unit: px } } }
`;
const load = (files: Record<string, string>) => loadTokens(memoryIO(files), "t/r.resolver.yaml");
const tree = (light: string, dark: string, r = resolver, b = base): Record<string, string> =>
  ({ "t/r.resolver.yaml": r, "t/base.tokens.yaml": b, "t/light.tokens.yaml": light, "t/dark.tokens.yaml": dark });

test("set → mode default; modifier → modes = contexts, default = first; $ref relative to resolver", async () => {
  const { tokens, diagnostics } = await load(tree(`bg: { $value: "{gray.w}" }`, `bg: { $value: "{gray.k}" }`));
  expect(diagnostics).toEqual([]);
  expect(tokens.collections).toEqual([
    { name: "base", kind: "set", modes: ["default"], defaultMode: "default" },
    { name: "theme", kind: "modifier", modes: ["light", "dark"], defaultMode: "light" },
  ]);
  expect(tokens.tokens.get("bg")).toMatchObject({ collection: "theme", type: "color" });
});
test("token missing in one context", async () => {
  expect(msgs((await load(tree(`bg: { $value: "{gray.w}" }`, `fg: { $value: "{gray.k}" }`))).diagnostics))
    .toContain('"bg" missing in context "dark" of modifier "theme"');
});
test("alias: missing, group target, type mismatch, cycle (terminates)", async () => {
  const l = `bg: { $value: "{gray.nope}" }\ngrp: { $value: "{gray}" }\nbad: { $type: dimension, $value: "{gray.w}" }\nx: { $value: "{y}" }\ny: { $value: "{x}" }`;
  const m = msgs((await load(tree(l, l))).diagnostics);
  expect(m).toContain("{gray.nope}");
  expect(m).toContain("{gray}");
  expect(m).toContain("type mismatch");
  expect(m).toContain("cycle");
});
test("token in two collections and wrong resolver version are both reported", async () => {
  const m = msgs((await load(tree(`bg: { $value: "{gray.w}" }`, `bg: { $value: "{gray.k}" }`,
    resolver.replace("2025.10", "2024.01"), base + `bg: { $value: "{gray.w}" }`))).diagnostics);
  expect(m).toContain("2025.10");
  expect(m).toContain('"bg"');
});
test("missing source file is a diagnostic, not a throw", async () => {
  const files = tree(`bg: { $value: "{gray.w}" }`, `bg: { $value: "{gray.k}" }`);
  delete files["t/dark.tokens.yaml"];
  expect(msgs((await load(files)).diagnostics)).toContain("t/dark.tokens.yaml");
});
test("I3: literal $type differing between modifier contexts is an error", async () => {
  const m = msgs((await load(tree(
    `zz: { $type: color, $value: { colorSpace: srgb, components: [1, 0, 0] } }`,
    `zz: { $type: dimension, $value: { value: 8, unit: px } }`,
  ))).diagnostics);
  expect(m).toContain('"zz" is color in "light" but dimension in "dark"');
});

test("string tokens: $value must be a string", () => {
  expect(walkTokenTree({ t: { $type: "string", $value: "확인" } }, "f").diagnostics).toEqual([]);
  expect(msgs(walkTokenTree({ t: { $type: "string", $value: 3 } }, "f").diagnostics)).toContain("invalid string $value");
});
test("resolveToken follows aliases across collections and picks each collection's mode", async () => {
  const r = `version: "2025.10"
sets: { base: { sources: [{ $ref: base.tokens.yaml }] } }
modifiers: { locale: { contexts: { en: [{ $ref: en.tokens.yaml }], ko: [{ $ref: ko.tokens.yaml }] }, default: en } }
resolutionOrder: [{ $ref: "#/sets/base" }, { $ref: "#/modifiers/locale" }]
`;
  const { tokens, diagnostics } = await load({
    "t/r.resolver.yaml": r,
    "t/base.tokens.yaml": `text: { ok: { $value: "{text.common.ok}" } }\n`,
    "t/en.tokens.yaml": `text: { $type: string, common: { ok: { $value: OK } } }\n`,
    "t/ko.tokens.yaml": `text: { $type: string, common: { ok: { $value: 확인 } } }\n`,
  });
  expect(diagnostics).toEqual([]);
  expect(tokens.tokens.get("text.ok")!.type).toBe("string");
  expect(resolveToken(tokens, "text.ok", {})).toBe("OK");
  expect(resolveToken(tokens, "text.ok", { locale: "ko" })).toBe("확인");
  expect(resolveToken(tokens, "text.nope", {})).toBeUndefined();
});
