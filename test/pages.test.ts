import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPages, bundleProjects } from "../scripts/build-pages";

test("bundleProjects embeds every YAML file and takes the title from the manifest", async () => {
  const [m3, conf] = await bundleProjects(["examples/material3", "examples/conformance"]);
  expect(m3!.name).toBe("material3");
  expect(m3!.title).toBe("Material 3 (material-web v0.192)");
  expect(Object.keys(m3!.files)).toContain("openui.yaml");
  expect(Object.keys(m3!.files)).toContain("components/button.yaml");
  expect(conf!.files["components/button.yaml"]).toContain("kind: Component");
});
test("buildPages writes a relative-path static site with projects.json and .nojekyll", async () => {
  const out = mkdtempSync(join(tmpdir(), "ou-pages-"));
  await buildPages(out, ["examples/material3", "examples/conformance"]);
  const html = readFileSync(join(out, "index.html"), "utf8");
  expect(html).toMatch(/src="\.\/[^"]+\.js"/);
  expect(existsSync(join(out, ".nojekyll"))).toBe(true);
  const { projects } = JSON.parse(readFileSync(join(out, "projects.json"), "utf8"));
  expect(projects.map((p: { name: string }) => p.name)).toEqual(["material3", "conformance"]);
});
