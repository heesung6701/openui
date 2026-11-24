import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import type { ProjectIO } from "./io";

const SKIP = (name: string) => name === "node_modules" || name.startsWith(".");

/** Node/Bun-only ProjectIO over a directory. Kept out of io.ts so browser bundles never see node:fs. */
export function fsIO(root: string): ProjectIO {
  return {
    async list() {
      const out: string[] = [];
      const walk = async (dir: string) => {
        for (const e of await readdir(dir, { withFileTypes: true })) {
          if (SKIP(e.name)) continue; // never descend into node_modules / dot-directories
          const abs = join(dir, e.name);
          if (e.isDirectory()) await walk(abs);
          else if (e.isFile() && e.name.endsWith(".yaml")) out.push(relative(root, abs).split(sep).join("/"));
        }
      };
      await walk(root);
      return out.sort();
    },
    read: (path) => readFile(join(root, path), "utf8"),
  };
}
