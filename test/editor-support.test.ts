import { expect, test } from "bun:test";
import { rangeOf, tokenCompletion } from "../editor/support";

const t = "a:\n  b: 1\n  c: [x, y]\n";
test("rangeOf exact, array index, fallback to parent, root", () => {
  expect(rangeOf(t, ["a", "b"])).toEqual({ from: t.indexOf("1"), to: t.indexOf("1") + 1 });
  expect(rangeOf(t, ["a", "c", 1])).toEqual({ from: t.indexOf("y"), to: t.indexOf("y") + 1 });
  const parent = rangeOf(t, ["a"]);
  expect(parent.to).toBeGreaterThan(parent.from);
  expect(rangeOf(t, ["a", "zz"])).toEqual(parent);
  expect(rangeOf(t, [])).toEqual({ from: 0, to: 0 });
});
test("rangeOf survives broken YAML", () => expect(rangeOf('a: "unterminated', ["a"])).toBeDefined());
test("tokenCompletion", () => {
  expect(tokenCompletion('fill: "{md.sys.co', ["md.sys.color.primary", "md.sys.shape.corner-full"]))
    .toEqual({ from: 'fill: "{'.length, options: ["md.sys.color.primary"] });
  expect(tokenCompletion('fill: "{', ["a", "b"])).toEqual({ from: 'fill: "{'.length, options: ["a", "b"] });
  expect(tokenCompletion("fill: md", ["md.sys.color.primary"])).toBeNull();
});
