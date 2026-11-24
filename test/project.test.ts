import { expect, test } from "bun:test";
import { parseYaml } from "../src/yaml";
import { globToRegExp } from "../src/glob";
import { loadProject } from "../src/project";
import { memoryIO } from "../src/io";
import { fsIO } from "../src/fs-io";
import { msgs } from "./helpers";

test("duplicate YAML key is an error with file name", () => {
  const r = parseYaml("styles:\n  size=small: {}\n  size=small: {}\n", "c/a.yaml");
  expect(r.diagnostics.length).toBe(1);
  expect(r.diagnostics[0]!.file).toBe("c/a.yaml");
});
test("unquoted alias gets a hint", () =>
  expect(parseYaml("fill: {md.sys.color.primary}\n", "a.yaml").diagnostics[0]!.message).toContain('"{md.sys.color.primary}"'));
test("YAML syntax error is a diagnostic, not a throw", () =>
  expect(parseYaml('a: "unterminated\n', "a.yaml").diagnostics.length).toBeGreaterThan(0));
test("globToRegExp", () => {
  expect(globToRegExp("components/*.yaml").test("components/button.yaml")).toBe(true);
  expect(globToRegExp("components/*.yaml").test("components/x/button.yaml")).toBe(false);
  expect(globToRegExp("components/**/*.yaml").test("components/x/button.yaml")).toBe(true);
  expect(globToRegExp("components/**/*.yaml").test("components/button.yaml")).toBe(true);
});
const conformance = async () => {
  const io = fsIO("examples/conformance");
  const files: Record<string, string> = {};
  for (const p of await io.list()) files[p] = await io.read(p);
  return files;
};
test("conformance project is clean and covers every token type and part kind", async () => {
  const { project, diagnostics } = await loadProject(fsIO("examples/conformance"));
  expect(diagnostics).toEqual([]);
  expect(project!.components.size).toBe(4);
  expect(new Set([...project!.tokens.tokens.values()].map((t) => t.type))).toEqual(
    new Set(["color", "dimension", "number", "duration", "cubicBezier", "fontFamily", "fontWeight", "shadow", "typography", "gradient"]));
  const kinds = new Set<string>();
  const walk = (p: any) => { kinds.add(p.kind); Object.values(p.children ?? {}).forEach(walk); };
  for (const { doc } of project!.components.values()) walk(doc.data.anatomy.root);
  expect(kinds).toEqual(new Set(["frame", "text", "instance", "slot", "vector", "image"]));
});
test("duplicate metadata.id across files", async () => {
  const files = await conformance();
  files["components/icon2.yaml"] = files["components/icon.yaml"]!;
  expect(msgs((await loadProject(memoryIO(files))).diagnostics)).toContain('duplicate metadata.id "icon"');
});
test("unknown instance component across files", async () => {
  const files = await conformance();
  files["components/button.yaml"] = files["components/button.yaml"]!.replace("default: icon", "default: ghost");
  expect(msgs((await loadProject(memoryIO(files))).diagnostics)).toContain("ghost");
});
test("component with semantic errors is still loaded (best-effort preview)", async () => {
  const files = await conformance();
  files["components/button.yaml"] = files["components/button.yaml"]!.replace("{color.primary}", "{color.nope}");
  const r = await loadProject(memoryIO(files));
  expect(msgs(r.diagnostics)).toContain("color.nope");
  expect(r.project!.components.has("button")).toBe(true);
});
test("CLI exit codes", () => {
  const good = Bun.spawnSync(["bun", "src/cli.ts", "validate", "examples/conformance"]);
  expect(good.exitCode).toBe(0);
  expect(good.stdout.toString()).toContain("ok:");
  expect(Bun.spawnSync(["bun", "src/cli.ts", "validate", "test/fixtures/broken"]).exitCode).toBe(1);
});
