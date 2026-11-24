import type { z } from "zod";

export type Diagnostic = {
  file: string;
  path: (string | number)[];
  message: string;
  /** Source offsets when known without a path (YAML syntax errors). */
  range?: [number, number];
};

export function fromZod(err: z.ZodError, file: string, base: (string | number)[] = []): Diagnostic[] {
  return err.issues.map((i) => ({
    file,
    path: [...base, ...i.path.map((p) => (typeof p === "symbol" ? String(p) : p))],
    message: i.message,
  }));
}

export const formatDiagnostic = (d: Diagnostic): string => `${d.file}: ${d.path.join(".")}: ${d.message}`;
