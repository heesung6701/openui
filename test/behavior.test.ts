import { expect, test } from "bun:test";
import { parse } from "yaml";
import { createController } from "../src/behavior/controller";
import { Component } from "../src/component/schema";
import { memoryIO } from "../src/io";
import { loadProject } from "../src/project";
import { msgs } from "./helpers";

const CHECK = `kind: Component
metadata: { id: check, name: Check }
data:
  props:
    disabled: { type: boolean, default: false }
    label:    { type: text, default: "{text.check.label}" }
  variants:
    type: { values: { unselected: {}, selected: {}, indeterminate: {} }, default: unselected }
  states: [enabled, hovered, focused, pressed, disabled]
  behavior:
    role: checkbox
    label: { prop: label }
    states:
      hovered: hover
      focused: focus-visible
      pressed: press
      disabled: { prop: disabled, inert: true }
    aria:
      checked: { type: { unselected: "false", selected: "true", indeterminate: mixed } }
    on:
      activate:
        set: { type: { unselected: selected, selected: unselected, indeterminate: selected } }
        emit: change
  tokens:
    size: { $type: dimension, $value: { value: 18, unit: px } }
  anatomy:
    root:
      kind: frame
      layout: { direction: none, width: "{check.size}", height: "{check.size}" }
      children:
        mark: { kind: frame }
  styles:
    base: { enabled: { mark: { visible: false } } }
    type=selected: { enabled: { mark: { visible: true } } }
    type=indeterminate: { enabled: { mark: { visible: true, direction: row } } }
`;
const doc = () => Component.parse(parse(CHECK));

test("controller: pointer and keyboard drive the declared states; the last active state in `states` wins", () => {
  const c = createController(doc(), {});
  expect(c.state()).toBe("enabled");
  c.input({ type: "pointerenter" });
  expect(c.state()).toBe("hovered");
  c.input({ type: "focus", visible: true });
  expect(c.state()).toBe("focused");
  c.input({ type: "pointerdown" });
  expect(c.state()).toBe("pressed");
  c.input({ type: "pointerup" });
  c.input({ type: "blur" });
  c.input({ type: "pointerleave" });
  expect(c.state()).toBe("enabled");
});
test("controller: activation applies the `set` transitions and emits activate + the named event", () => {
  const c = createController(doc(), {});
  expect(c.input({ type: "click" })).toEqual([{ name: "activate", detail: {} }, { name: "change", detail: { type: "selected" } }]);
  expect(c.values().type).toBe("selected");
  c.input({ type: "click" });
  expect(c.values().type).toBe("unselected");
  const ind = createController(doc(), { type: "indeterminate" });
  ind.input({ type: "click" });
  expect(ind.values().type).toBe("selected");
});
test("controller: role keys — checkbox toggles on Space (keyup), not on Enter", () => {
  const c = createController(doc(), {});
  c.input({ type: "focus", visible: true });
  c.input({ type: "keydown", key: " " });
  expect(c.state()).toBe("pressed");
  expect(c.values().type).toBe("unselected");
  c.input({ type: "keyup", key: " " });
  expect(c.values().type).toBe("selected");
  expect(c.input({ type: "keydown", key: "Enter" })).toEqual([]);
});
test("controller: an inert state blocks interaction and is reported to assistive tech", () => {
  const c = createController(doc(), { disabled: true });
  expect(c.state()).toBe("disabled");
  c.input({ type: "pointerenter" });
  expect(c.state()).toBe("disabled");
  expect(c.input({ type: "click" })).toEqual([]);
  expect(c.aria()).toMatchObject({ role: "checkbox", "aria-disabled": "true", tabindex: "-1", "aria-checked": "false" });
});
test("controller: aria attributes follow values", () => {
  const c = createController(doc(), {});
  expect(c.aria()).toEqual({ role: "checkbox", tabindex: "0", "aria-checked": "false" });
  c.input({ type: "click" });
  expect(c.aria()["aria-checked"]).toBe("true");
  c.set({ type: "indeterminate" });
  expect(c.aria()["aria-checked"]).toBe("mixed");
});

const files = (component: string) => ({
  "openui.yaml": `openui: "0.1"\ninfo: { title: t, version: "1" }\ntokens: tokens/r.resolver.yaml\ncomponents: ["c/*.yaml"]\n`,
  "tokens/r.resolver.yaml": `version: "2025.10"\nsets: { base: { sources: [{ $ref: base.tokens.yaml }] } }\nresolutionOrder: [{ $ref: "#/sets/base" }]\n`,
  "tokens/base.tokens.yaml": `text: { $type: string, check: { label: { $value: Accept } } }\n`,
  "c/check.yaml": component,
});
test("behavior: a valid behavior block loads clean (props used by behavior count as bound)", async () => {
  expect((await loadProject(memoryIO(files(CHECK)))).diagnostics).toEqual([]);
});
const bad: [string, (s: string) => string, string][] = [
  ["unknown role", (s) => s.replace("role: checkbox", "role: slider"), "role"],
  ["trigger for an undeclared state", (s) => s.replace("hovered: hover", "hovering: hover"), 'unknown state "hovering"'],
  ["unknown trigger", (s) => s.replace("hovered: hover", "hovered: wiggle"), "trigger"],
  ["the default state cannot have a trigger", (s) => s.replace("hovered: hover", "enabled: hover"), 'default state "enabled"'],
  ["prop trigger needs a boolean prop", (s) => s.replace("{ prop: disabled, inert: true }", "{ prop: label, inert: true }"), 'prop "label" is text'],
  ["label needs a text prop", (s) => s.replace("label: { prop: label }", "label: { prop: disabled }"), 'prop "disabled" is boolean'],
  ["aria on an unknown axis", (s) => s.replace("checked: { type:", "checked: { kind:"), 'unknown variant axis, mode prop or boolean prop "kind"'],
  ["aria with an unknown value", (s) => s.replace('unselected: "false", selected', 'unchecked: "false", selected'), 'unknown value "unchecked"'],
  ["set to an unknown value", (s) => s.replace("unselected: selected, selected: unselected", "unselected: on, selected: unselected"), 'unknown value "on"'],
  ["unknown aria attribute", (s) => s.replace("checked: { type:", "valuenow: { type:"), "aria"],
];
for (const [name, mutate, needle] of bad)
  test(`behavior invalid: ${name}`, async () => {
    expect(msgs((await loadProject(memoryIO(files(mutate(CHECK))))).diagnostics)).toContain(needle);
  });

test("runtime API names: props and variant axes cannot use names reserved by HTML or React", async () => {
  const m = msgs((await loadProject(memoryIO(files(CHECK.replace("    disabled: { type: boolean, default: false }", "    disabled: { type: boolean, default: false }\n    style: { type: mode, values: [a, b], default: a }"))))).diagnostics);
  expect(m).toContain('name "style" is reserved on runtime platforms');
});

import { runInteract, controllerActor } from "../src/checklist/interact";
test("interaction checks: steps drive the component; expect values, state, host attributes and events", async () => {
  const { project } = await loadProject(memoryIO(files(CHECK)));
  const actor = controllerActor(project!, "check");
  const ok = await runInteract({ do: ["focus", "key:Space"], expect: { values: { type: "selected" }, attrs: { "aria-checked": "true", role: "checkbox" }, events: ["activate", "change"] } }, actor);
  expect(ok).toMatchObject({ pass: true });
  const hover = await runInteract({ do: ["hover"], expect: { state: "hovered", attrs: { "aria-label": "Accept" } } }, actor);
  expect(hover.pass).toBe(true);
  const inert = await runInteract({ given: { disabled: true }, do: ["click"], expect: { events: [], values: { type: "unselected" }, attrs: { "aria-disabled": "true" } } }, actor);
  expect(inert.pass).toBe(true);
  const wrong = await runInteract({ do: ["key:Enter"], expect: { values: { type: "selected" } } }, actor);
  expect(wrong.pass).toBe(false);
  expect(wrong.actual).toContain("type=unselected");
});
