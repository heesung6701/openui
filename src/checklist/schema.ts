import { z } from "zod";

/** CSS shorthands are rejected: computed values of shorthands are not reliably comparable. */
export const SHORTHANDS = new Set([
  "background", "border", "border-radius", "padding", "margin", "font", "gap", "inset", "outline",
  "flex", "grid", "place-items", "overflow", "transition", "animation",
]);

const oneOrMany = (s: z.ZodString) => z.union([s, z.array(s).min(1)]);

const Check = z.strictObject({
  variant: z.record(z.string(), oneOrMany(z.string())).optional(),
  state: oneOrMany(z.string()).optional(),
  mode: z.record(z.string(), oneOrMany(z.string())).optional(),
  part: z.string().min(1),
  property: z.string().regex(/^[a-z-]+$/, "property must be a CSS property name").superRefine((p, ctx) => {
    if (SHORTHANDS.has(p)) ctx.addIssue({ code: "custom", message: `"${p}" is a CSS shorthand; use a longhand (e.g. padding-left)` });
  }),
  expect: z.union([z.string(), z.number()]),
});

const Item = z.strictObject({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "item id must be kebab-case"),
  title: z.string().min(1),
  check: Check.optional(),
  manual: z.literal(true).optional(),
  hint: z.strictObject({ variant: z.record(z.string(), z.string()).optional(), state: z.string().optional() }).optional(),
}).superRefine((v, ctx) => {
  if ((v.check === undefined) === (v.manual === undefined)) ctx.addIssue({ code: "custom", message: "item needs exactly one of check or manual" });
});

export const Checklist = z.strictObject({
  kind: z.literal("Checklist"),
  metadata: z.strictObject({
    id: z.string().regex(/^[a-z][a-z0-9-]*$/),
    component: z.string().min(1),
    source: z.string().optional(),
    description: z.string().optional(),
  }),
  items: z.array(Item).min(1),
});
export type Checklist = z.infer<typeof Checklist>;
export type ChecklistItem = Checklist["items"][number];
export type Check = NonNullable<ChecklistItem["check"]>;
