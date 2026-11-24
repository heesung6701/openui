import { expect, test } from "bun:test";
import { parse } from "yaml";
import { resolveStyles, variantCombos } from "../src/component/resolve";

const doc = parse(`kind: Component
metadata: { id: b, name: B }
data:
  variants:
    size: { values: { small: {}, large: {} }, default: large }
    tone: { values: { a: {}, b: {} }, default: a }
  states: [enabled, pressed]
  anatomy: { root: { kind: frame, layout: { direction: row, gap: 8px } } }
  styles:
    size=small,tone=b: { enabled: { root: { fill: "#000004" } } }
    base:
      enabled: { root: { fill: "#000001", cornerRadius: 4px } }
      pressed: { root: { fill: "#000002" } }
    size=small: { enabled: { root: { fill: "#000003", gap: 4px } } }
`);
test("variant layer overrides base within same state", () =>
  expect(resolveStyles(doc, { size: "small" }, "enabled").root).toEqual({ direction: "row", gap: "4px", fill: "#000003", cornerRadius: "4px" }));
test("state layer beats variant specificity", () =>
  expect(resolveStyles(doc, { size: "small" }, "pressed").root!.fill).toBe("#000002"));
test("missing axis uses default; anatomy layout is the base", () =>
  expect(resolveStyles(doc, {}, "pressed").root).toEqual({ direction: "row", gap: "8px", fill: "#000002", cornerRadius: "4px" }));
test("more axes win regardless of document order", () =>
  expect(resolveStyles(doc, { size: "small", tone: "b" }, "enabled").root!.fill).toBe("#000004"));
test("unknown state throws", () => expect(() => resolveStyles(doc, {}, "hover")).toThrow());
test("unknown variant value throws", () => expect(() => resolveStyles(doc, { size: "huge" }, "enabled")).toThrow());
test("variantCombos is the cartesian product in axis order", () =>
  expect(variantCombos(doc)).toEqual([{ size: "small", tone: "a" }, { size: "small", tone: "b" }, { size: "large", tone: "a" }, { size: "large", tone: "b" }]));
test("variantCombos without variants is one empty combo", () =>
  expect(variantCombos({ ...doc, data: { ...doc.data, variants: undefined } })).toEqual([{}]));
