import { expect, test } from "bun:test";
import { partStyle } from "../src/render/style";
import { tokenSheet, tokenValueCss } from "../src/render/tokens";
import { buildComponent, type VNode } from "../src/render/vnode";
import type { PartKind } from "../src/component/schema";
import { loadProject } from "../src/project";
import { memoryIO } from "../src/io";
import { fsIO } from "../src/fs-io";

const css = (k: PartKind, p: object, parentDirection: string | null = "row", isRoot = false) =>
  partStyle(k, p as Record<string, unknown>, { parentDirection, isRoot });

test("layout mapping", () => {
  expect(css("frame", { direction: "row", gap: "8px", align: { main: "center", cross: "end" } })).toMatchObject({
    display: "flex", "flex-direction": "row", "column-gap": "8px", "row-gap": "8px", "justify-content": "center", "align-items": "flex-end",
  });
  expect(css("frame", { direction: "column", gap: "8px", crossGap: "4px" })).toMatchObject({ "row-gap": "8px", "column-gap": "4px" });
  expect(css("frame", { direction: "grid", grid: { columns: 2, rows: 3 } })).toMatchObject({
    display: "grid", "grid-template-columns": "repeat(2, max-content)", "grid-template-rows": "repeat(3, auto)",
  });
  expect(css("frame", { width: "fill" }, "row")).toMatchObject({ flex: "1 1 0", "min-width": "0" });
  expect(css("frame", { height: "fill" }, "column")).toMatchObject({ flex: "1 1 0", "min-height": "0" });
  expect(css("frame", { width: "fill" }, "column")).toMatchObject({ "align-self": "stretch" });
  expect(css("frame", { width: "fill" }, null, true)).toMatchObject({ width: "100%" });
  expect(css("frame", { width: "hug" })).toMatchObject({ width: "max-content", "flex-shrink": "0" });
  expect(css("frame", { width: "40px", padding: [0, "24px"] })).toMatchObject({ width: "40px", "flex-shrink": "0", padding: "0 24px" });
  expect(css("frame", { position: "absolute", width: "fill", height: "fill" })).toMatchObject({ position: "absolute", left: "0", right: "0", top: "0", bottom: "0" });
  expect(css("text", { x: "4px", y: "8px" }, "none")).toMatchObject({ position: "absolute", left: "4px", top: "8px" });
  expect(css("frame", { gap: "{space.gap}" })["column-gap"]).toBeUndefined();
});
test("M4: in-flow parts are positioned so later siblings paint above an earlier absolute state layer (§4.4 order)", () => {
  for (const k of ["text", "instance", "vector", "image"] as PartKind[]) expect(css(k, {}).position).toBe("relative");
  expect(css("frame", { position: "absolute" }).position).toBe("absolute");
  expect(css("text", { x: "4px" }, "none").position).toBe("absolute");
});
test("paint mapping", () => {
  expect(css("frame", { fill: "{md.sys.color.on-surface}", fillOpacity: 0.12 })["background-color"]).toBe("color-mix(in srgb, var(--md-sys-color-on-surface) 12%, transparent)");
  expect(css("frame", { fill: "#6750A4" })).toMatchObject({ background: "#6750A4" });
  expect(css("frame", { strokeColor: "#000000", strokeWidth: "1px", shadow: "{e.1}" })["box-shadow"]).toBe("inset 0 0 0 1px #000000, var(--e-1)");
  expect(css("frame", { strokeColor: "#000000", strokeWidth: "2px", strokeAlign: "center" })["box-shadow"]).toBe("inset 0 0 0 1px #000000, 0 0 0 1px #000000");
  expect(css("frame", { strokeColor: "#000000", strokeWidth: "{w}", strokeAlign: "outside" })["box-shadow"]).toBe("0 0 0 var(--w) #000000");
  expect(css("frame", { strokeColor: "{c}", strokeWidth: "1px", strokeOpacity: 0.12 })["box-shadow"]).toBe("inset 0 0 0 1px color-mix(in srgb, var(--c) 12%, transparent)");
  expect(css("vector", { strokeColor: "{c}", strokeOpacity: 0.5 })).toMatchObject({ stroke: "var(--c)", "stroke-opacity": "0.5" });
  expect(css("instance", { fill: "{c}" })).toMatchObject({ "--ou-icon-fill": "var(--c)" });
  expect(css("vector", { fill: "{c}", fillOpacity: 0.5 })).toMatchObject({ fill: "var(--ou-icon-fill, var(--c))", "fill-opacity": "var(--ou-icon-fill-opacity, 0.5)" });
  expect(css("text", { typography: "{t.label}" })).toMatchObject({ "font-size": "var(--t-label__font-size)", "line-height": "var(--t-label__line-height)" });
  expect(css("text", { textAlign: "justified", color: "#000000" })).toMatchObject({ "text-align": "justify", color: "#000000" });
  expect(css("frame", { visible: false })).toMatchObject({ display: "none" });
  expect(css("frame", { cornerRadius: ["12px", "12px", 0, 0], opacity: 0.38 })).toMatchObject({ "border-radius": "12px 12px 0 0", opacity: "0.38" });
});
test("token values", () => {
  expect(tokenValueCss("color", { colorSpace: "srgb", components: [1, 0, 0.5], alpha: 0.5 })).toBe("rgb(255 0 128 / 0.5)");
  expect(tokenValueCss("dimension", { value: 0.875, unit: "rem" })).toBe("0.875rem");
  expect(tokenValueCss("fontWeight", "medium")).toBe("500");
  expect(tokenValueCss("fontFamily", ["Roboto", "sans-serif"])).toBe('"Roboto", "sans-serif"');
  expect(tokenValueCss("cubicBezier", [0.2, 0, 0, 1])).toBe("cubic-bezier(0.2, 0, 0, 1)");
  expect(tokenValueCss("color", "{a.b}")).toBe("var(--a-b)");
  expect(tokenValueCss("shadow", [{ color: "{k}", offsetX: { value: 0, unit: "px" }, offsetY: { value: 1, unit: "px" }, blur: { value: 2, unit: "px" }, spread: { value: 0, unit: "px" }, inset: true }]))
    .toBe("inset 0px 1px 2px 0px var(--k)");
  expect(tokenValueCss("gradient", [{ color: "{a}", position: 0 }, { color: "{b}", position: 1 }])).toBe("linear-gradient(180deg, var(--a) 0%, var(--b) 100%)");
  expect(tokenValueCss("typography", "{t.body}")).toEqual({
    "font-family": "var(--t-body__font-family)", "font-size": "var(--t-body__font-size)", "font-weight": "var(--t-body__font-weight)",
    "letter-spacing": "var(--t-body__letter-spacing)", "line-height": "var(--t-body__line-height)",
  });
});
test("token sheet: set + default context on .ou-root, one rule per modifier context", async () => {
  const { project } = await loadProject(fsIO("examples/conformance"));
  const sheet = tokenSheet(project!.tokens);
  expect(sheet).toContain(".ou-root {");
  expect(sheet).toContain('.ou-root[data-theme="dark"] {');
  expect(sheet).toContain("--color-primary: var(--palette-purple40);");
  expect(sheet).toContain("--type-label__font-size: 14px;");
});
test("I2: material3 sheet declares every CSS variable once per rule (typography sub-vars cannot collide)", async () => {
  const { project } = await loadProject(fsIO("examples/material3"));
  for (const rule of tokenSheet(project!.tokens).split("}\n")) {
    const names = [...rule.matchAll(/^\s*(--[\w-]+):/gm)].map((m) => m[1]);
    expect(names.length).toBe(new Set(names).size);
  }
});
const find = (n: VNode, part: string): VNode | undefined =>
  n.attrs["data-part"] === part ? n : n.children.map((c) => find(c, part)).find(Boolean);
test("buildComponent: conformance button", async () => {
  const { project } = await loadProject(fsIO("examples/conformance"));
  const v = buildComponent(project!, "button", { variant: { style: "outlined", size: "small" }, state: "enabled", props: { label: "Go", showIcon: true } });
  expect(v.attrs["data-component"]).toBe("button");
  expect(v.attrs["data-part"]).toBe("root");
  expect(find(v, "label")!.text).toBe("Go");
  expect(v.style.height).toBe("32px");
  expect(find(v, "icon")!.style["--ou-icon-fill"]).toBe("var(--color-primary)");
  expect(find(v, "icon")!.style.display).toBeUndefined();
  expect(find(v, "icon")!.children[0]!.attrs["data-component"]).toBe("icon");
});
test("buildComponent: defaults, hidden boolean, slot placeholder, vector", async () => {
  const { project } = await loadProject(fsIO("examples/conformance"));
  const b = buildComponent(project!, "button", { variant: {}, state: "enabled", props: {} });
  expect(find(b, "label")!.text).toBe("Button");
  expect(find(b, "icon")!.style.display).toBe("none");
  const c = buildComponent(project!, "card", { variant: {}, state: "enabled", props: {} });
  expect(find(c, "body")!.text).toBe("content");
  const i = buildComponent(project!, "icon", { variant: {}, state: "enabled", props: {} });
  const glyph = find(i, "glyph")!;
  expect(glyph.tag).toBe("svg");
  expect(glyph.attrs.viewBox).toBe("0 0 24 24");
  expect(glyph.children[0]!.tag).toBe("path");
});
test("I4: instance cycle stops at the first revisit (no exponential blow-up)", async () => {
  const comp = (id: string, other: string) => `kind: Component
metadata: { id: ${id}, name: ${id} }
data:
  anatomy: { root: { kind: frame, children: { inner: { kind: instance, component: ${other} } } } }
`;
  const files = {
    "openui.yaml": 'openui: "0.1"\ninfo: { title: t, version: "1" }\ntokens: r.yaml\ncomponents: ["c/*.yaml"]\n',
    "r.yaml": 'version: "2025.10"\nresolutionOrder: []\n',
    "c/a.yaml": comp("a", "b"),
    "c/b.yaml": comp("b", "a"),
  };
  const { project } = await loadProject(memoryIO(files));
  expect(JSON.stringify(buildComponent(project!, "a", { variant: {}, state: "enabled", props: {} }))).toContain("instance cycle: a → b → a");
  files["c/a.yaml"] = `kind: Component
metadata: { id: a, name: a }
data:
  anatomy: { root: { kind: frame, children: { i1: { kind: instance, component: a }, i2: { kind: instance, component: a }, i3: { kind: instance, component: a }, i4: { kind: instance, component: a } } } }
`;
  const self = await loadProject(memoryIO(files));
  const count = (n: VNode): number => 1 + n.children.reduce((s, c) => s + count(c), 0);
  expect(count(buildComponent(self.project!, "a", { variant: {}, state: "enabled", props: {} }))).toBeLessThan(20);
});

test("text tokens: text parts and text prop defaults render the selected locale", async () => {
  const { project } = await loadProject(fsIO("examples/conformance"));
  const at = (modes: Record<string, string>) => buildComponent(project!, "button", { variant: {}, state: "enabled", props: {}, modes });
  expect(find(at({}), "label")!.text).toBe("Button");
  expect(find(at({ locale: "ko" }), "label")!.text).toBe("버튼");
  const g = buildComponent(project!, "gallery", { variant: {}, state: "enabled", props: {}, modes: { locale: "ko" } });
  expect(find(g, "badge")!.text).toBe("신규");
  const o = buildComponent(project!, "button", { variant: {}, state: "enabled", props: { label: "{text.gallery.badge}" }, modes: { locale: "ko" } });
  expect(find(o, "label")!.text).toBe("신규");
  expect(tokenSheet(project!.tokens)).not.toContain("--text-");
});
