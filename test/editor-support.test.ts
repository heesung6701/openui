import { expect, test } from "bun:test";
import { describeCondition, filesHtml, previewMode, problemsHtml, rangeOf, tokenCompletion } from "../editor/support";

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

test("C1: file list and problems escape HTML from file names and YAML keys", () => {
  const evil = '<img src=x onerror=alert(1)>';
  const files = filesHtml([`${evil}.yaml`], new Map([[`${evil}.yaml`, { text: "a", saved: "a" }]]), "", []);
  const problems = problemsHtml([{ file: `${evil}.yaml`, path: ["data", "styles", evil], message: evil }]);
  for (const html of [files, problems]) {
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  }
});

test("I5: preview keeps the last good render while the open file has YAML errors or its component dropped out", () => {
  const yamlErr = [{ file: "c/b.yaml", path: [], message: "YAML: Unexpected end of flow-map" }];
  const otherErr = [{ file: "c/b.yaml", path: ["data"], message: 'unknown part "x"' }];
  expect(previewMode("c/b.yaml", true, [], null)).toBe("render");
  expect(previewMode("c/b.yaml", true, otherErr, "c/b.yaml")).toBe("render"); // semantic errors still preview live
  expect(previewMode("c/b.yaml", true, yamlErr, "c/b.yaml")).toBe("keep");    // partially recovered doc
  expect(previewMode("c/b.yaml", false, otherErr, "c/b.yaml")).toBe("keep");  // component failed schema
  expect(previewMode("c/b.yaml", true, yamlErr, null)).toBe("render");        // nothing better to show
  expect(previewMode("c/b.yaml", false, [], null)).toBe("none");
  expect(previewMode("c/b.yaml", false, [], "c/a.yaml")).toBe("none");        // last good belongs to another file
});

test("describeCondition labels each condition kind", () => {
  expect(describeCondition({ width: { max: 600 } })).toBe("width < 600");
  expect(describeCondition({ width: { min: 600, max: 840 } })).toBe("600 ≤ width < 840");
  expect(describeCondition({ height: { min: 480 } })).toBe("height ≥ 480");
  expect(describeCondition({ orientation: "landscape" })).toBe("landscape");
  expect(describeCondition({ device: "tablet" })).toBe("tablet");
});
