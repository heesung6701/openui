import { formatDiagnostic } from "./diagnostics";
import { fsIO } from "./fs-io";
import { loadProject } from "./project";

const USAGE = `usage:
  bun src/cli.ts validate <projectDir>     check the YAML
  bun src/cli.ts bundle <projectDir>       print the project as one JSON file for the web runtime (loadBundle)`;

const [cmd, dir] = process.argv.slice(2);
if (!dir || !["validate", "bundle"].includes(cmd!)) {
  console.error(USAGE);
  process.exit(2);
}
const io = fsIO(dir);
const { project, diagnostics } = await loadProject(io);
if (diagnostics.length || !project) {
  for (const d of diagnostics) (cmd === "validate" ? console.log : console.error)(formatDiagnostic(d)); // bundle: keep stdout clean
  process.exit(1);
}
if (cmd === "validate") console.log(`ok: ${project.tokens.tokens.size} tokens, ${project.components.size} components`);
else {
  const files: Record<string, string> = {};
  for (const p of await io.list()) if (p.endsWith(".yaml") || p.endsWith(".yml")) files[p] = await io.read(p);
  console.log(JSON.stringify({ files }));
}
