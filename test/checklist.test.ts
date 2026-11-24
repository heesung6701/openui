import { expect, test } from "bun:test";
import { loadProject } from "../src/project";
import { memoryIO } from "../src/io";
import { fsIO } from "../src/fs-io";
import { expandCheck, expectToCss, runChecklist, sameCss } from "../src/checklist/run";
import { msgs } from "./helpers";

const conformance = async () => {
  const io = fsIO("examples/conformance");
  const files: Record<string, string> = {};
  for (const p of await io.list()) files[p] = await io.read(p);
  return files;
};

test("conformance checklist loads clean", async () => {
  const { project, diagnostics } = await loadProject(fsIO("examples/conformance"));
  expect(diagnostics).toEqual([]);
  expect(project!.checklists.get("button")!.doc.items.length).toBe(3);
});
test("expandCheck: omitted axis/state/mode = all", async () => {
  const { project } = await loadProject(fsIO("examples/conformance"));
  const doc = project!.components.get("button")!.doc;
  const cases = expandCheck({ variant: { size: "medium" }, part: "root", property: "height", expect: "40px" }, doc, project!.tokens);
  expect(cases.length).toBe(2 /*style*/ * 3 /*states*/ * 2 /*theme*/);
  expect(cases[0]).toEqual({ variant: { style: "filled", size: "medium" }, state: "enabled", mode: { theme: "light" } });
});
test("expandCheck: explicit lists narrow", async () => {
  const { project } = await loadProject(fsIO("examples/conformance"));
  const doc = project!.components.get("button")!.doc;
  const cases = expandCheck({ variant: { style: ["outlined"] }, state: ["pressed", "disabled"], mode: { theme: "dark" }, part: "root", property: "height", expect: "40px" }, doc, project!.tokens);
  expect(cases.length).toBe(2 /*size*/ * 2 /*states*/ * 1);
  expect(cases.every((c) => c.variant.style === "outlined" && c.mode.theme === "dark")).toBe(true);
});
test("expectToCss + sameCss", () => {
  expect(expectToCss("color-mix(in srgb, {md.sys.color.on-surface} 12%, transparent)"))
    .toBe("color-mix(in srgb, var(--md-sys-color-on-surface) 12%, transparent)");
  expect(expectToCss(0.38)).toBe("0.38");
  expect(sameCss("19.9999px", "20px")).toBe(true);
  expect(sameCss("19.9px", "20px")).toBe(false);
  expect(sameCss("rgb(1, 2, 3)", "rgb(1, 2, 3)")).toBe(true);
  expect(sameCss("rgb(1, 2, 3)", "rgb(1, 2, 4)")).toBe(false);
});
test("runChecklist with fake measure", async () => {
  const { project } = await loadProject(fsIO("examples/conformance"));
  const cl = project!.checklists.get("button")!.doc, doc = project!.components.get("button")!.doc;
  const r = await runChecklist(cl, doc, project!.tokens, async (c) => ({ actual: c.state === "pressed" ? "41px" : "40px", expected: "40px" }));
  expect(r[0]).toMatchObject({ id: "height", kind: "auto", pass: false });
  expect(r[0]!.cases.filter((x) => !x.pass).every((x) => x.state === "pressed")).toBe(true);
  expect(r[1]).toMatchObject({ id: "filled-bg", kind: "auto", pass: true });
  expect(r[2]).toEqual({ id: "ripple", title: "리플", kind: "manual", pass: null, cases: [] });
});
const bad: [string, string, string, string][] = [
  ["unknown part", "part: root, property: height", "part: rooot, property: height", "rooot"],
  ["shorthand property", "property: height", "property: padding", "padding"],
  ["unknown state", "state: enabled", "state: hovered", "hovered"],
  ["unknown token", "{color.primary}", "{color.nope}", "color.nope"],
  ["unknown component", "component: button", "component: buton", "buton"],
  ["unknown modifier", "variant: { size: medium }", "variant: { size: medium }, mode: { thme: dark }", "thme"],
];
for (const [name, from, to, needle] of bad)
  test(`checklist invalid: ${name}`, async () => {
    const files = await conformance();
    files["checklists/button.yaml"] = files["checklists/button.yaml"]!.replace(from, to);
    const m = msgs((await loadProject(memoryIO(files))).diagnostics);
    expect(m).toContain(needle);
  });
