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
test("YAML syntax error is one diagnostic (cascades summarized), not a throw", () => {
  const d = parseYaml('a: {b: 1\nc: [x\nd: "e\n', "a.yaml").diagnostics;
  expect(d.length).toBe(1);
  expect(d[0]!.message).toMatch(/^YAML: .*\(\+\d+ more\)$/);
  expect(d[0]!.range).toEqual([expect.any(Number), expect.any(Number)]);
});
test("comma inside an unquoted flow-map string gets a quoting hint", () => {
  const d = parseYaml("v: { description: Highest emphasis, primary actions }\n", "a.yaml").diagnostics;
  expect(d.length).toBe(1);
  expect(d[0]!.message).toContain("quote");
  expect(d[0]!.path).toEqual(["v", "primary actions"]);
});
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
    new Set(["color", "dimension", "number", "duration", "cubicBezier", "fontFamily", "fontWeight", "shadow", "typography", "gradient", "string"]));
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
  files["components/button.yaml"] = files["components/button.yaml"]!.replace("{type.label}", "{type.nope}");
  const r = await loadProject(memoryIO(files));
  expect(msgs(r.diagnostics)).toContain("type.nope");
  expect(r.project!.components.has("button")).toBe(true);
});
test("CLI exit codes", () => {
  const good = Bun.spawnSync(["bun", "src/cli.ts", "validate", "examples/conformance"]);
  expect(good.exitCode).toBe(0);
  expect(good.stdout.toString()).toContain("ok:");
  expect(Bun.spawnSync(["bun", "src/cli.ts", "validate", "test/fixtures/broken"]).exitCode).toBe(1);
});

test("C2: fsIO lists posix paths relative to the root for ./, trailing-slash and . roots", async () => {
  for (const root of ["./examples/conformance", "examples/conformance/"]) {
    const files = await fsIO(root).list();
    expect(files).toContain("openui.yaml");
    expect(files).toContain("components/button.yaml");
  }
  const r = Bun.spawnSync(["bun", "../../src/cli.ts", "validate", "."], { cwd: "examples/conformance" });
  expect(r.stdout.toString()).toContain("4 components");
});
test("C2: a components/checklists glob that matches nothing is a diagnostic", async () => {
  const files = await conformance();
  files["openui.yaml"] = files["openui.yaml"]!.replace('components: ["components/*.yaml"]', 'components: ["component/*.yaml"]');
  expect(msgs((await loadProject(memoryIO(files))).diagnostics)).toContain('"component/*.yaml" matches no files');
});

test("I4: instance cycles (component and instance-prop defaults) are diagnostics", async () => {
  const comp = (id: string, inner: string) => `kind: Component
metadata: { id: ${id}, name: ${id} }
data:
  props: { slotIcon: { type: instance, default: ${inner} } }
  anatomy: { root: { kind: frame, children: { inner: { kind: instance, prop: slotIcon } } } }
`;
  const files = {
    "openui.yaml": 'openui: "0.1"\ninfo: { title: t, version: "1" }\ntokens: r.yaml\ncomponents: ["c/*.yaml"]\n',
    "r.yaml": 'version: "2025.10"\nresolutionOrder: []\n',
    "c/a.yaml": comp("a", "b"),
    "c/b.yaml": comp("b", "a"),
  };
  expect(msgs((await loadProject(memoryIO(files))).diagnostics)).toContain("instance cycle: a → b → a");
});
