import { z } from "zod";

export const Manifest = z.strictObject({
  openui: z.literal("0.1"),
  info: z.strictObject({ title: z.string().min(1), version: z.string().min(1), description: z.string().optional() }),
  tokens: z.string().min(1),
  components: z.array(z.string().min(1)).min(1),
  checklists: z.array(z.string().min(1)).optional(),
});
export type Manifest = z.infer<typeof Manifest>;
