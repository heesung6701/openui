import { expect, test } from "bun:test";
import { expandCheck } from "../src/checklist/run";
import { memoryIO } from "../src/io";
import { loadProject } from "../src/project";
import { tokenSheet } from "../src/render/tokens";
import { buildComponent } from "../src/render/vnode";
import { resolveToken } from "../src/tokens/resolver";
import { msgs } from "./helpers";

const px = (n: number) => `{ value: ${n}, unit: px }`;
const project = (box: string, base = "") => ({
  "openui.yaml": `openui: "0.1"\ninfo: { title: t, version: "1" }\ntokens: tokens/r.resolver.yaml\ncomponents: ["c/*.yaml"]\n`,
  "tokens/r.resolver.yaml": `version: "2025.10"
sets: { base: { sources: [{ $ref: base.tokens.yaml }] } }
modifiers:
  window:
    contexts: { compact: [], expanded: [] }
    default: compact
    $extensions: { org.openui: { when: { compact: { width: { max: 600 } }, expanded: { width: { min: 600 } } } } }
resolutionOrder: [{ $ref: "#/sets/base" }, { $ref: "#/modifiers/window" }]
`,
  "tokens/base.tokens.yaml": `color:
  $type: color
  ink: { $value: { colorSpace: srgb, components: [0, 0, 0] } }
  paper: { $value: { colorSpace: srgb, components: [1, 1, 1] } }
space: { $type: dimension, s: { $value: ${px(8)} }, m: { $value: ${px(16)} } }
${base}`,
  "c/box.yaml": box,
});
const BOX = `kind: Component
metadata: { id: box, name: Box }
data:
  props:
    tone: { type: mode, values: [plain, strong], default: plain }
  tokens:
    fill: { $type: color, $value: "{color.paper}", $when: { tone=strong: "{color.ink}" } }
    padding:
      $type: dimension
      $value: "{space.s}"
      $when:
        window=expanded: "{space.m}"
        tone=strong,window=expanded: ${px(24)}
  anatomy:
    root: { kind: frame, layout: { direction: row, padding: "{box.padding}" } }
  styles:
    base: { enabled: { root: { fill: "{box.fill}" } } }
`;

test("component tokens live in the component: path = <id>.<name>, values per mode in $when", async () => {
  const { project: p, diagnostics } = await loadProject(memoryIO(project(BOX)));
  expect(diagnostics).toEqual([]);
  const set = p!.tokens;
  expect(set.tokens.get("box.fill")).toMatchObject({ collection: "box", type: "color" });
  expect(resolveToken(set, "box.padding", {})).toEqual({ value: 8, unit: "px" });
  expect(resolveToken(set, "box.padding", { window: "expanded" })).toEqual({ value: 16, unit: "px" });
  expect(resolveToken(set, "box.padding", { window: "expanded", tone: "strong" })).toEqual({ value: 24, unit: "px" });
  expect(resolveToken(set, "box.padding", { tone: "strong" })).toEqual({ value: 8, unit: "px" });
  expect(resolveToken(set, "box.fill", { tone: "strong" })).toEqual({ colorSpace: "srgb", components: [0, 0, 0] });
});

const bad: [string, (s: string) => string, string][] = [
  ["style references a global token directly", (s) => s.replace('fill: "{box.fill}"', 'fill: "{color.ink}"'), `token "{color.ink}" is not one of this component's tokens`],
  ["unknown mode in $when", (s) => s.replace("tone=strong: ", "size=big: "), 'unknown mode "size"'],
  ["unknown value in $when", (s) => s.replace("tone=strong: ", "tone=loud: "), 'unknown value "loud" for mode "tone"'],
  ["$when value of the wrong type", (s) => s.replace('tone=strong: "{color.ink}"', 'tone=strong: "{space.m}"'), "type mismatch"],
  ["unknown component token", (s) => s.replace('padding: "{box.padding}"', 'padding: "{box.gap}"'), 'unknown token "{box.gap}"'],
  ["mode prop named like a modifier", (s) => s.replace("tone: { type: mode", "window: { type: mode"), 'mode prop "window" has the name of modifier "window"'],
  ["$when on a group", (s) => s.replace("  tokens:\n", "  tokens:\n    $when: { tone=strong: 1 }\n"), "$when is only allowed on tokens"],
];
for (const [name, mutate, needle] of bad)
  test(`component tokens invalid: ${name}`, async () => {
    expect(msgs((await loadProject(memoryIO(project(mutate(BOX))))).diagnostics)).toContain(needle);
  });
test("a global token may not use a component's namespace", async () => {
  const r = await loadProject(memoryIO(project(BOX, `box: { extra: { $type: number, $value: 1 } }\n`)));
  expect(msgs(r.diagnostics)).toContain('token "box.extra" is in the namespace of component "box"');
});

test("token sheet: component tokens on the component root; $when rules in precedence order (fewest modes first)", async () => {
  const { project: p } = await loadProject(memoryIO(project(BOX)));
  const css = tokenSheet(p!.tokens);
  expect(css).toContain(':where([data-component="box"]) {\n  --box-fill: var(--color-paper);');
  expect(css).toContain(':where([data-component="box"][data-mode-tone="strong"]) {\n  --box-fill: var(--color-ink);');
  expect(css).toContain(':where(.ou-root[data-window="expanded"]) :where([data-component="box"]) {\n  --box-padding: var(--space-m);');
  expect(css).toContain('@media (width >= 600px) {\n  :where(.ou-root:not([data-window])) :where([data-component="box"]) {');
  const one = css.indexOf('--box-padding: var(--space-m)');
  const two = css.indexOf('[data-mode-tone="strong"]) {\n  --box-padding: 24px;');
  expect(one).toBeGreaterThan(-1);
  expect(two).toBeGreaterThan(one);
});
test("render: mode props always mark the root (default when not given)", async () => {
  const { project: p } = await loadProject(memoryIO(project(BOX)));
  expect(buildComponent(p!, "box", { variant: {}, state: "enabled", props: {} }).attrs["data-mode-tone"]).toBe("plain");
  expect(buildComponent(p!, "box", { variant: {}, state: "enabled", props: { tone: "strong" } }).attrs["data-mode-tone"]).toBe("strong");
});
test("checklist cases: mode props expand to all values; modifiers only when the component's tokens use them", async () => {
  const { project: p } = await loadProject(memoryIO(project(BOX)));
  const cases = expandCheck({ part: "root", property: "padding-left", expect: "8px" }, p!.components.get("box")!.doc, p!.tokens);
  expect(cases.map((c) => `${c.mode.window}/${c.mode.tone}`)).toEqual(["compact/plain", "compact/strong", "expanded/plain", "expanded/strong"]);
});
