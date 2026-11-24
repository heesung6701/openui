import { expect, test } from "bun:test";
import { convert, inferType, parseScssTokens } from "../scripts/material-web-tokens";

const scss = `$_default: (
  'md-sys-color': md-sys-color.values-light(),
);

@function values-light($deps: $_default) {
  @return (
    'primary': map.get($deps, 'md-ref-palette', 'primary40'),
    'hover-state-layer-opacity':
      map.get($deps, 'md-sys-state', 'hover-state-layer-opacity'),
    'container-height': if($exclude-hardcoded-values, null, 40px),
    'focus-indicator-thickness':
      if(
        $exclude-hardcoded-values,
        null,
        3px
      ),
    'label-large': (
      'font': map.get($deps, 'md-ref-typeface', 'plain'),
    ),
    'brand': if($exclude-hardcoded-values, null, (Roboto))
  );
}`;
test("parseScssTokens: aliases, literals (incl. multi-line), skips composites and $_default", () => {
  expect(parseScssTokens(scss)).toEqual({
    "values-light": {
      primary: { alias: "md.ref.palette.primary40" },
      "hover-state-layer-opacity": { alias: "md.sys.state.hover-state-layer-opacity" },
      "container-height": { literal: "40px" },
      "focus-indicator-thickness": { literal: "3px" },
      brand: { literal: "(Roboto)" },
    },
  });
});
test("inferType", () => {
  expect(inferType("primary40", "#6750a4")).toBe("color");
  expect(inferType("label-large-size", "0.875rem")).toBe("dimension");
  expect(inferType("label-large-tracking", "-0.015625rem")).toBe("dimension");
  expect(inferType("weight-medium", "500")).toBe("fontWeight");
  expect(inferType("disabled-container-opacity", "0.12")).toBe("number");
  expect(inferType("plain", "(Roboto)")).toBe("fontFamily");
  expect(inferType("x", "solid")).toBeNull();
  expect(inferType("container-shape", "(16px 16px 0px 0px)")).toBeNull();
});
test("typescale synthesis keeps exact line-height ratio", () => {
  const out = convert({ "_md-sys-typescale.scss": `@function values($deps: $_default, $exclude-hardcoded-values: false) {
  @return (
    'label-large-font': map.get($deps, 'md-ref-typeface', 'plain'),
    'label-large-line-height': if($exclude-hardcoded-values, null, 1.25rem),
    'label-large-size': if($exclude-hardcoded-values, null, 0.875rem),
    'label-large-tracking': if($exclude-hardcoded-values, null, 0.00625rem),
    'label-large-weight': map.get($deps, 'md-ref-typeface', 'weight-medium'),
  );
}`, "_md-ref-typeface.scss": `@function values($exclude-hardcoded-values: false) {
  @return (
    'plain': if($exclude-hardcoded-values, null, (Roboto)),
    'weight-medium': if($exclude-hardcoded-values, null, 500)
  );
}` }).outputs["sys.tokens.yaml"] as any;
  const t = out.md.sys.typescale["label-large"];
  expect(t.$type).toBe("typography");
  expect(t.$value.fontSize).toBe("{md.sys.typescale.label-large-size}");
  expect(t.$value.lineHeight).toBeCloseTo(1.25 / 0.875, 10);
  expect(out.md.sys.typescale["label-large-size"]).toEqual({ $type: "dimension", $value: { value: 0.875, unit: "rem" } });
});
test("color literal → srgb object; light/dark split; alias to skipped token is skipped", () => {
  const r = convert({
    "_md-ref-palette.scss": `@function values($exclude-hardcoded-values: false) {
  @return (
    'primary40': if($exclude-hardcoded-values, null, #6750a4),
    'black': if($exclude-hardcoded-values, null, #000)
  );
}`,
    "_md-sys-color.scss": `@function values-dark($deps: $_default-dark) {
  @return (
    'primary': map.get($deps, 'md-ref-palette', 'primary40'),
  );
}
@function values-light($deps: $_default) {
  @return (
    'primary': map.get($deps, 'md-ref-palette', 'primary40'),
  );
}`,
    "_md-comp-x.scss": `@function values($deps: $_default, $exclude-hardcoded-values: false) {
  @return (
    'shape': if($exclude-hardcoded-values, null, (16px 16px 0px 0px)),
    'shape-alias': map.get($deps, 'md-comp-x', 'shape'),
    'color': map.get($deps, 'md-sys-color', 'primary'),
  );
}`,
  });
  const ref = r.outputs["ref.tokens.yaml"] as any;
  expect(ref.md.ref.palette.primary40.$value).toEqual({ colorSpace: "srgb", components: [103 / 255, 80 / 255, 164 / 255], hex: "#6750a4" });
  expect(ref.md.ref.palette.black.$value.hex).toBe("#000000");
  expect((r.outputs["sys-color-dark.tokens.yaml"] as any).md.sys.color.primary.$value).toBe("{md.ref.palette.primary40}");
  expect((r.outputs["comp.tokens.yaml"] as any).md.comp.x.color.$value).toBe("{md.sys.color.primary}");
  expect(r.skipped.join("\n")).toContain("md.comp.x.shape-alias");
});
