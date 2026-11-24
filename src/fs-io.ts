import { readdir, readFile } from "node:fs/promises";
import type { ProjectIO } from "./io";

/** Node/Bun-only ProjectIO over a directory. Kept out of io.ts so browser bundles never see node:fs. */
export function fsIO(root: string): ProjectIO {
  return {
    async list() {
      const entries = await readdir(root, { recursive: true, withFileTypes: true });
      return entries
        .filter((e) => e.isFile() && e.name.endsWith(".yaml"))
        .map((e) => `${e.parentPath}/${e.name}`.slice(root.replace(/\/$/, "").length + 1))
        .filter((p) => !p.split("/").some((s) => s === "node_modules" || s.startsWith(".")))
        .sort();
    },
    read: (path) => readFile(`${root}/${path}`, "utf8"),
  };
}
