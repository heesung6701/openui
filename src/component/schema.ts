import { z } from "zod";
import type { TokenType } from "../tokens/values";

export type PartKind = "frame" | "text" | "instance" | "slot" | "vector" | "image";
export const PART_KINDS: readonly PartKind[] = ["frame", "text", "instance", "slot", "vector", "image"];

export const Ident = z.string().regex(/^[a-z][a-zA-Z0-9]*$/, "identifier must match ^[a-z][a-zA-Z0-9]*$");
export const VariantValue = z.string().regex(/^[a-z0-9][a-zA-Z0-9-]*$/, "variant value must match ^[a-z0-9][a-zA-Z0-9-]*$");
export const ComponentId = z.string().regex(/^[a-z][a-z0-9-]*$/, "component id must match ^[a-z][a-z0-9-]*$");

/** Objects that accept their declared keys plus `x-*` extension keys. */
export const EXT_SCHEMAS = new WeakSet<z.ZodType>();
function ext<S extends z.ZodRawShape>(shape: S) {
  const s = z.object(shape).catchall(z.unknown()).superRefine((v, ctx) => {
    for (const k of Object.keys(v)) {
      if (!(k in shape) && !k.startsWith("x-")) ctx.addIssue({ code: "custom", message: `unknown property "${k}"`, path: [k] });
    }
  });
  EXT_SCHEMAS.add(s);
  return s;
}

const ALIAS = "\\{[^{}]+\\}";
export const aliasValue = z.string().regex(new RegExp(`^${ALIAS}$`), 'must be a token alias like "{a.b.c}"');
/** Dimension shorthand: `8px`, `1rem`, `"{token}"`, or unitless `0` (as in CSS). */
const dim = z.union([
  z.literal(0),
  z.string().regex(new RegExp(`^(-?\\d+(\\.\\d+)?(px|rem)|${ALIAS})$`), 'dimension must look like 8px, 1rem, 0 or "{token}"'),
]);
const color = z.string().regex(new RegExp(`^(#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?|transparent|${ALIAS})$`), 'color must be #rrggbb, #rrggbbaa, transparent or "{token}"');
const num01 = z.union([z.number().min(0).max(1), aliasValue]);
const sizing = z.union([z.enum(["hug", "fill"]), dim]);
const corners = z.union([dim, z.tuple([dim, dim, dim, dim])]);

type Prop = { schema: z.ZodType; tokenTypes: TokenType[]; parts: PartKind[] | "all"; layout: boolean };
const CONTAINER: PartKind[] = ["frame", "slot"];
const p = (schema: z.ZodType, tokenTypes: TokenType[], parts: PartKind[] | "all", layout = false): Prop => ({ schema, tokenTypes, parts, layout });

/** §L/§P — single source of truth for style property vocabulary. */
export const STYLE_PROPERTIES: Record<string, Prop> = {
  direction: p(z.enum(["row", "column", "grid", "none"]), [], CONTAINER, true),
  gap: p(dim, ["dimension"], CONTAINER, true),
  crossGap: p(dim, ["dimension"], CONTAINER, true),
  padding: p(z.union([dim, z.tuple([dim, dim]), z.tuple([dim, dim, dim, dim])]), ["dimension"], CONTAINER, true),
  align: p(z.strictObject({
    main: z.enum(["start", "center", "end", "space-between"]).optional(),
    cross: z.enum(["start", "center", "end", "baseline"]).optional(),
  }), [], CONTAINER, true),
  wrap: p(z.boolean(), [], CONTAINER, true),
  grid: p(z.strictObject({ columns: z.int().min(1), rows: z.int().min(1) }), [], CONTAINER, true),
  width: p(sizing, ["dimension"], "all", true),
  height: p(sizing, ["dimension"], "all", true),
  minWidth: p(dim, ["dimension"], "all", true),
  maxWidth: p(dim, ["dimension"], "all", true),
  minHeight: p(dim, ["dimension"], "all", true),
  maxHeight: p(dim, ["dimension"], "all", true),
  position: p(z.enum(["auto", "absolute"]), [], "all", true),
  x: p(dim, ["dimension"], "all", true),
  y: p(dim, ["dimension"], "all", true),
  fill: p(color, ["color", "gradient"], ["frame", "slot", "vector", "instance"]),
  fillOpacity: p(num01, ["number"], ["frame", "slot", "vector", "instance"]),
  strokeColor: p(color, ["color"], ["frame", "slot", "vector"]),
  strokeWidth: p(dim, ["dimension"], ["frame", "slot", "vector"]),
  strokeAlign: p(z.enum(["inside", "outside", "center"]), [], ["frame", "slot", "vector"]),
  cornerRadius: p(corners, ["dimension"], ["frame", "slot", "image"]),
  opacity: p(num01, ["number"], "all"),
  shadow: p(aliasValue, ["shadow"], ["frame", "slot"]),
  visible: p(z.boolean(), [], "all"),
  color: p(color, ["color"], ["text"]),
  typography: p(aliasValue, ["typography"], ["text"]),
  textAlign: p(z.enum(["left", "center", "right", "justified"]), [], ["text"]),
};

const shapeOf = (filter: (v: Prop) => boolean) =>
  Object.fromEntries(Object.entries(STYLE_PROPERTIES).filter(([, v]) => filter(v)).map(([k, v]) => [k, v.schema.optional()]));

export const Layout = z.strictObject(shapeOf((v) => v.layout));
export const StyleCell = z.strictObject(shapeOf(() => true));

const PropRef = z.strictObject({ prop: Ident });
const common = { visible: PropRef.optional(), description: z.string().optional() };

const Frame = ext({
  kind: z.literal("frame"),
  layout: Layout.optional(),
  get children(): z.ZodOptional<z.ZodRecord<z.ZodString, typeof Part>> { return z.record(z.string(), Part).optional(); },
  ...common,
});
const Slot = ext({
  kind: z.literal("slot"),
  prop: Ident,
  layout: Layout.optional(),
  get children(): z.ZodOptional<z.ZodRecord<z.ZodString, typeof Part>> { return z.record(z.string(), Part).optional(); },
  ...common,
});
const Text = ext({ kind: z.literal("text"), text: z.union([z.string(), PropRef]).optional(), ...common });
const Instance = ext({ kind: z.literal("instance"), prop: Ident.optional(), component: ComponentId.optional(), ...common })
  .refine((v) => (v.prop === undefined) !== (v.component === undefined), "instance needs exactly one of prop or component");
const Vector = ext({
  kind: z.literal("vector"),
  svg: z.strictObject({ viewBox: z.string(), d: z.union([z.string(), z.array(z.string()).min(1)]) }),
  ...common,
});
const Image = ext({ kind: z.literal("image"), src: z.string().min(1), ...common });

export const Part: z.ZodType<PartNode> = z.discriminatedUnion("kind", [Frame, Slot, Text, Instance, Vector, Image]);
export type PartNode = {
  kind: PartKind;
  layout?: Record<string, unknown>;
  children?: Record<string, PartNode>;
  text?: string | { prop: string };
  prop?: string;
  component?: string;
  svg?: { viewBox: string; d: string | string[] };
  src?: string;
  visible?: { prop: string };
  description?: string;
  [ext: `x-${string}`]: unknown;
};

const PropDef = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("text"), default: z.string(), description: z.string().optional() }),
  z.strictObject({ type: z.literal("boolean"), default: z.boolean(), description: z.string().optional() }),
  z.strictObject({
    type: z.literal("instance"), default: ComponentId.optional(), preferred: z.array(ComponentId).optional(),
    description: z.string().optional(),
  }),
  z.strictObject({
    type: z.literal("slot"), min: z.int().min(0).optional(), max: z.int().min(1).optional(),
    preferred: z.array(ComponentId).optional(), preferredOnly: z.boolean().optional(), description: z.string().optional(),
  }),
]);

const Variant = z.strictObject({
  values: z.record(VariantValue, z.strictObject({ description: z.string().optional() }))
    .refine((v) => Object.keys(v).length > 0, "variant needs at least one value"),
  default: z.string(),
  description: z.string().optional(),
}).refine((v) => Object.hasOwn(v.values, v.default), { message: "default must be one of values", path: ["default"] });

const Data = ext({
  props: z.record(Ident, PropDef).optional(),
  variants: z.record(Ident, Variant).optional(),
  states: z.array(Ident).min(1).refine((s) => new Set(s).size === s.length, "states must be unique").optional(),
  anatomy: z.strictObject({ root: Part }),
  styles: z.record(z.string(), z.record(z.string(), z.record(z.string(), StyleCell))).optional(),
  "x-figma": z.strictObject({ parts: z.record(z.string(), z.record(z.string(), z.unknown())).optional() }).optional(),
});

export const Component = z.strictObject({
  kind: z.literal("Component"),
  metadata: z.strictObject({ id: ComponentId, name: z.string().min(1), description: z.string().optional() }),
  data: Data,
});
export type Component = z.infer<typeof Component>;
