import { expect, test } from "bun:test";
import { parse } from "yaml";
import { validateComponent, type ValidateContext } from "../src/component/validate";
import type { TokenEntry } from "../src/tokens/resolver";
import type { TokenType } from "../src/tokens/values";
import { CHIP_YAML, msgs } from "./helpers";

const good = parse(CHIP_YAML);
const entry = (type: TokenType): TokenEntry => ({ collection: "base", type, byMode: {} });
const ctx: ValidateContext = {
  tokens: {
    collections: [
      { name: "base", kind: "set", modes: ["default"], defaultMode: "default" },
      { name: "chip-tone", kind: "modifier", modes: ["a", "b"], defaultMode: "a" },
      { name: "window", kind: "modifier", modes: ["compact", "expanded"], defaultMode: "compact", when: { compact: { width: { max: 600 } }, expanded: { width: { min: 600 } } } },
    ],
    tokens: new Map([["c", entry("color")], ["h", entry("dimension")], ["t", entry("typography")], ["sh", entry("shadow")], ["g", entry("dimension")], ["z", entry("dimension")], ["p", entry("dimension")], ["r", entry("dimension")], ["text.chip.label", entry("string")], ["text.chip.other", entry("string")]]),
  },
  componentIds: new Set(["icon", "chip"]),
};

test("good component has no diagnostics", () => expect(validateComponent(good, "f", ctx)).toEqual([]));

const cases: [string, (d: any) => void, string][] = [
  ["unknown axis",             d => (d.data.styles["layut=inline"] = {}),                       "layut"],
  ["unknown variant value",    d => (d.data.styles["layout=huge"] = {}),                        "huge"],
  ["axis twice",               d => (d.data.styles["layout=inline,layout=stacked"] = {}),       "layout"],
  ["unknown state",            d => (d.data.styles.base.hover = {}),                            "hover"],
  ["state combo not allowed",  d => (d.data.styles.base["enabled,pressed"] = {}),               "enabled,pressed"],
  ["unknown part",             d => (d.data.styles.base.enabled.lable = {}),                    "lable"],
  ["typography on frame",      d => (d.data.styles.base.enabled.root.typography = "{t}"),       "typography"],
  ["alias type mismatch",      d => (d.data.styles.base.enabled.root.fill = "{h}"),             "{h}"],
  ["missing token",            d => (d.data.styles.base.enabled.root.fill = "{nope}"),          "{nope}"],
  ["shadow literal",           d => (d.data.styles.base.enabled.root.shadow = "#000000"),       "shadow"],
  ["text prop wrong type",     d => (d.data.anatomy.root.children.label.text = { prop: "trailing" }), "trailing"],
  ["unbound prop",             d => (d.data.props.extra = { type: "boolean", default: false }), "extra"],
  ["slot bound twice",         d => (d.data.anatomy.root.children.tail2 = { kind: "slot", prop: "trailing" }), "trailing"],
  ["unknown component ref",    d => (d.data.props.icon = { type: "instance", default: "ghost" }), "ghost"],
  ["duplicate part name",      d => (d.data.anatomy.root.children.wrap = { kind: "frame", children: { label: { kind: "text", text: "{text.chip.other}" } } }), "label"],
  ["root not frame",           d => (d.data.anatomy.root.kind = "text"),                        "root"],
  ["axis named state",         d => (d.data.variants.state = { values: { a: {} }, default: "a" }), "state"],
  ["x-figma duplicates core",  d => (d.data["x-figma"] = { parts: { root: { fill: "#000000" } } }), "fill"],
  ["fillOpacity on text",      d => (d.data.styles.base.enabled.label.fillOpacity = 0.5),       "fillOpacity"],
  ["strokeOpacity on text",    d => (d.data.styles.base.enabled.label.strokeOpacity = 0.5),     "strokeOpacity"],
  ["variant axis that only swaps tokens", d => { d.data.variants.tone = { values: { a: {}, b: {} }, default: "a" }; d.data.styles["tone=b"] = { enabled: { root: { fill: "{c}", height: "{p}" } } }; }, 'variant axis "tone" does not change the UI tree'],
  ["variant axis with no styles",   d => (d.data.variants.size = { values: { s: {}, l: {} }, default: "s" }), 'variant axis "size" does not change the UI tree'],
  ["mode prop: unknown modifier",   d => (d.data.props.tone.modifier = "nope"),                      'unknown modifier "nope"'],
  ["mode prop: conditional modifier", d => (d.data.props.tone.modifier = "window"),                  'modifier "window" is selected by conditions'],
  ["mode prop: a set is not a modifier", d => (d.data.props.tone.modifier = "base"),                 'unknown modifier "base"'],
  ["text part: unknown text token", d => (d.data.anatomy.root.children.label.text = "{text.nope}"), "{text.nope}"],
  ["text part: non-string token",   d => (d.data.anatomy.root.children.label.text = "{c}"),          '"{c}" is color, text expects string'],
  ["text prop: non-string default", d => (d.data.props.label.default = "{h}"),                       '"{h}" is dimension, text expects string'],
  ["string token used as a style",  d => (d.data.styles.base.enabled.label.color = "{text.chip.label}"), "{text.chip.label}"],
];
for (const [name, mutate, needle] of cases)
  test(name, () => {
    const d = structuredClone(good);
    mutate(d);
    const m = msgs(validateComponent(d, "f", ctx));
    expect(m.length).toBeGreaterThan(0);
    expect(m).toContain(needle);
  });
