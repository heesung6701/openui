import { z } from "zod";

export type TokenType =
  | "color" | "dimension" | "number" | "duration" | "cubicBezier"
  | "fontFamily" | "fontWeight" | "shadow" | "typography" | "gradient";

export const TOKEN_TYPES: readonly TokenType[] = [
  "color", "dimension", "number", "duration", "cubicBezier",
  "fontFamily", "fontWeight", "shadow", "typography", "gradient",
];

/** DTCG 2025.10 named font weights. */
export const FONT_WEIGHT_NAMES: Record<string, number> = {
  thin: 100, hairline: 100, "extra-light": 200, "ultra-light": 200, light: 300,
  normal: 400, regular: 400, book: 400, medium: 500, "semi-bold": 600, "demi-bold": 600,
  bold: 700, "extra-bold": 800, "ultra-bold": 800, black: 900, heavy: 900,
  "extra-black": 950, "ultra-black": 950,
};

const ALIAS_RE = /^\{([^{}]+)\}$/;

export function aliasTarget(v: unknown): string | null {
  return typeof v === "string" ? (ALIAS_RE.exec(v)?.[1] ?? null) : null;
}

export function collectAliases(v: unknown): string[] {
  const t = aliasTarget(v);
  if (t) return [t];
  if (Array.isArray(v)) return v.flatMap(collectAliases);
  if (v && typeof v === "object") return Object.values(v).flatMap(collectAliases);
  return [];
}

const alias = z.string().regex(ALIAS_RE, 'alias must look like "{a.b.c}"');
const or = <T extends z.ZodType>(s: T) => z.union([alias, s]);
const unit01 = z.number().min(0).max(1);

const color = z.strictObject({
  colorSpace: z.literal("srgb", { error: 'colorSpace must be "srgb" in openui 0.1' }),
  components: z.tuple([unit01, unit01, unit01]),
  alpha: unit01.optional(),
  hex: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});
const dimension = z.strictObject({ value: z.number(), unit: z.enum(["px", "rem"]) });
const duration = z.strictObject({ value: z.number(), unit: z.enum(["ms", "s"]) });
const fontFamily = z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]);
const fontWeight = z.union([z.number().min(1).max(1000), z.enum(Object.keys(FONT_WEIGHT_NAMES) as [string, ...string[]])]);
const shadowLayer = z.strictObject({
  color: or(color), offsetX: or(dimension), offsetY: or(dimension), blur: or(dimension), spread: or(dimension),
  inset: z.boolean().optional(),
});

/** Value shapes without a top-level alias. */
export const baseSchemas: Record<TokenType, z.ZodType> = {
  color,
  dimension,
  number: z.number(),
  duration,
  cubicBezier: z.tuple([unit01, z.number(), unit01, z.number()]),
  fontFamily,
  fontWeight,
  shadow: z.union([shadowLayer, z.array(or(shadowLayer)).min(1)]),
  typography: z.strictObject({
    fontFamily: or(fontFamily), fontSize: or(dimension), fontWeight: or(fontWeight),
    letterSpacing: or(dimension), lineHeight: or(z.number()),
  }),
  gradient: z.array(z.strictObject({ color: or(color), position: or(unit01) })).min(1),
};

/** Value shapes accepting an alias at top level and inside composite sub-values. */
export const valueSchemas = Object.fromEntries(
  TOKEN_TYPES.map((t) => [t, or(baseSchemas[t])]),
) as unknown as Record<TokenType, z.ZodType>;

/** Aliases inside a value together with the token type each position expects. */
export function typedAliases(type: TokenType, value: unknown): { alias: string; expected: TokenType }[] {
  const top = aliasTarget(value);
  if (top) return [{ alias: top, expected: type }];
  const out: { alias: string; expected: TokenType }[] = [];
  const field = (obj: unknown, map: Record<string, TokenType>) => {
    if (!obj || typeof obj !== "object") return;
    for (const [k, t] of Object.entries(map)) {
      const a = aliasTarget((obj as Record<string, unknown>)[k]);
      if (a) out.push({ alias: a, expected: t });
    }
  };
  if (type === "shadow") {
    for (const layer of Array.isArray(value) ? value : [value]) {
      const a = aliasTarget(layer);
      if (a) out.push({ alias: a, expected: "shadow" });
      else field(layer, { color: "color", offsetX: "dimension", offsetY: "dimension", blur: "dimension", spread: "dimension" });
    }
  } else if (type === "typography") {
    field(value, { fontFamily: "fontFamily", fontSize: "dimension", fontWeight: "fontWeight", letterSpacing: "dimension", lineHeight: "number" });
  } else if (type === "gradient" && Array.isArray(value)) {
    for (const stop of value) field(stop, { color: "color", position: "number" });
  }
  return out;
}
