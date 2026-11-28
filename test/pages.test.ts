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
test("buildPages ships the spec guide page without a sources section or benchmark references", async () => {
  const out = mkdtempSync(join(tmpdir(), "ou-pages-"));
  await buildPages(out, ["examples/conformance"]);
  const guide = readFileSync(join(out, "guide.html"), "utf8");
  for (const heading of ["한눈에 보기", "토큰", "컴포넌트 문서", "속성 어휘", "스타일 해석 규칙", "체크리스트", "Figma · 웹 매핑", "도구", "텍스트 토큰", "조건부 토큰"]) expect(guide).toContain(heading);
  for (const banned of ["rootage", "seed-design", "daangn", "당근", "출처", "벤치마킹"]) expect(guide).not.toContain(banned);
  expect(guide).toMatch(/href="\.\/"/); // back to the editor, relative (Pages serves under /openui/)
});
