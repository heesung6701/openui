// Static build of the editor for GitHub Pages: bundled editor + example projects embedded as projects.json.
import { mkdir, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { parse } from "yaml";
import { fsIO } from "../src/fs-io";

export type BundledProject = { name: string; title: string; files: Record<string, string> };

export async function bundleProjects(dirs: string[]): Promise<BundledProject[]> {
  return Promise.all(dirs.map(async (dir) => {
    const io = fsIO(dir);
    const files: Record<string, string> = {};
    for (const p of await io.list()) files[p] = await io.read(p);
    const title = (parse(files["openui.yaml"] ?? "") as { info?: { title?: string } } | null)?.info?.title ?? basename(dir);
    return { name: basename(dir), title, files };
  }));
}

export async function buildPages(outdir: string, dirs: string[]): Promise<void> {
  await rm(outdir, { recursive: true, force: true });
  await mkdir(outdir, { recursive: true });
  const pages = ["index.html", "guide.html"].map((f) => join(import.meta.dir, "../editor", f));
  const r = await Bun.build({ entrypoints: pages, outdir, minify: true });
  if (!r.success) throw new AggregateError(r.logs, "editor build failed");
  await writeFile(join(outdir, "projects.json"), JSON.stringify({ projects: await bundleProjects(dirs) }));
  await writeFile(join(outdir, ".nojekyll"), ""); // serve files as-is (no Jekyll processing)
}

if (import.meta.main) {
  const outdir = process.argv[2] ?? "dist";
  await buildPages(outdir, ["examples/material3", "examples/conformance"]);
  console.log(`built ${outdir}/`);
}
