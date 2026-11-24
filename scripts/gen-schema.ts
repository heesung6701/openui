import { z } from "zod";
import { Component, EXT_SCHEMAS } from "../src/component/schema";
import { Manifest } from "../src/manifest";
import { Checklist } from "../src/checklist/schema";

const convert = (schema: z.ZodType): string =>
  JSON.stringify(
    z.toJSONSchema(schema, {
      override: (ctx) => {
        if (!EXT_SCHEMAS.has(ctx.zodSchema as unknown as z.ZodType)) return;
        ctx.jsonSchema.additionalProperties = false;
        ctx.jsonSchema.patternProperties = { "^x-": {} };
      },
    }),
    null,
    2,
  ) + "\n";

export function genSchemas(): Record<string, string> {
  return {
    "component.schema.json": convert(Component),
    "manifest.schema.json": convert(Manifest),
    "checklist.schema.json": convert(Checklist),
  };
}

if (import.meta.main) {
  for (const [name, text] of Object.entries(genSchemas())) await Bun.write(`schema/${name}`, text);
}
