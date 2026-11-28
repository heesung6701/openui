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
  expect(project!.checklists.get("button")!.doc.items.length).toBe(6);
});
test("expandCheck: omitted axes/states = all; omitted modifiers = all contexts only if the component depends on them", async () => {
  const { project } = await loadProject(fsIO("examples/conformance"));
  const doc = project!.components.get("button")!.doc;
  const cases = expandCheck({ variant: { layout: "inline" }, part: "root", property: "height", expect: "40px" }, doc, project!.tokens);
  // badge × states × theme × locale × device × appearance (mode prop); the button's tokens use no window or orientation
  expect(cases.length).toBe(2 * 3 * 2 * 2 * 3 * 2);
  expect(cases[0]).toEqual({ variant: { layout: "inline", badge: "false" }, state: "enabled",
    mode: { theme: "light", locale: "en", window: "compact", orientation: "portrait", device: "phone", appearance: "filled" } });
  expect(cases.every((c) => c.mode.window === "compact" && c.mode.orientation === "portrait")).toBe(true);
});
test("expandCheck: explicit lists narrow (also for modifiers the component does not use)", async () => {
  const { project } = await loadProject(fsIO("examples/conformance"));
  const doc = project!.components.get("button")!.doc;
  const cases = expandCheck({ variant: { layout: ["stacked"] }, state: ["pressed", "disabled"], mode: { theme: "dark", device: ["desktop"], window: "expanded" }, part: "root", property: "height", expect: "40px" }, doc, project!.tokens);
  expect(cases.length).toBe(2 /*badge*/ * 2 /*states*/ * 2 /*locale*/ * 2 /*appearance*/);
  expect(cases.every((c) => c.variant.layout === "stacked" && c.mode.theme === "dark" && c.mode.device === "desktop" && c.mode.window === "expanded")).toBe(true);
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
  expect(r[3]).toEqual({ id: "ripple", title: "리플", kind: "manual", pass: null, cases: [] });
});
const bad: [string, string, string, string][] = [
  ["unknown part", "part: root, property: height", "part: rooot, property: height", "rooot"],
  ["shorthand property", "property: height", "property: padding", "padding"],
  ["unknown state", "state: enabled", "state: hovered", "hovered"],
  ["unknown token", "{color.primary}", "{color.nope}", "color.nope"],
  ["unknown component", "component: button", "component: buton", "buton"],
  ["unknown modifier", "mode: { device: [phone, tablet] }", "mode: { device: [phone, tablet], thme: dark }", "thme"],
];
for (const [name, from, to, needle] of bad)
  test(`checklist invalid: ${name}`, async () => {
    const files = await conformance();
    files["checklists/button.yaml"] = files["checklists/button.yaml"]!.replace(from, to);
    const m = msgs((await loadProject(memoryIO(files))).diagnostics);
    expect(m).toContain(needle);
  });
test("I6: empty measurements never pass (unknown property / invalid expect)", async () => {
  expect(sameCss("", "")).toBe(false);
  const { project } = await loadProject(fsIO("examples/conformance"));
  const cl = project!.checklists.get("button")!.doc, doc = project!.components.get("button")!.doc;
  const r = await runChecklist(cl, doc, project!.tokens, async () => ({ actual: "", expected: "" }));
  expect(r[0]!.pass).toBe(false);
});

test("text check: expected text is the token resolved in each case's locale", async () => {
  const { project, diagnostics } = await loadProject(fsIO("examples/conformance"));
  expect(diagnostics).toEqual([]);
  const doc = project!.components.get("button")!.doc;
  const cl = { kind: "Checklist" as const, metadata: { id: "t", component: "button" }, items: [
    { id: "label", title: "label", check: { variant: { layout: "inline", badge: "false" }, state: "enabled", mode: { theme: "light", device: "phone", appearance: "filled" }, part: "label", property: "text", expect: "{text.button.label}" } },
  ] };
  const seen: string[] = [];
  const r = await runChecklist(cl, doc, project!.tokens, async (c) => (seen.push(`${c.mode.locale}:${c.expectCss}`), { actual: c.expectCss, expected: c.expectCss }));
  expect(seen).toEqual(["en:Button", "ko:버튼"]);
  expect(r[0]!.pass).toBe(true);
});
const badText: [string, string, string][] = [
  ["literal expect", "Button", "text check expects one text token"],
  ["non-string token", "{color.primary}", '"{color.primary}" is color'],
];
for (const [name, expectValue, needle] of badText)
  test(`text check invalid: ${name}`, async () => {
    const files = await conformance();
    files["checklists/button.yaml"] += `  - { id: bad-text, title: label, check: { part: label, property: text, expect: "${expectValue}" } }\n`;
    expect(msgs((await loadProject(memoryIO(files))).diagnostics)).toContain(needle);
  });
test("sameCss compares single colors by value, not notation (color-mix serializes as color(srgb …))", () => {
  expect(sameCss("color(srgb 0 0 0 / 0)", "rgba(0, 0, 0, 0)")).toBe(true);
  expect(sameCss("color(srgb 1 0 0)", "rgb(255, 0, 0)")).toBe(true);
  expect(sameCss("color(srgb 0.4 0.31 0.64 / 0.12)", "rgba(102, 79, 163, 0.12)")).toBe(true);
  expect(sameCss("rgb(255, 0, 0)", "rgb(253, 0, 0)")).toBe(false);
  expect(sameCss("rgba(0, 0, 0, 0.12)", "rgba(0, 0, 0, 0.38)")).toBe(false);
});
