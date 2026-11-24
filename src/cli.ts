import { formatDiagnostic } from "./diagnostics";
import { fsIO } from "./fs-io";
import { loadProject } from "./project";

const [cmd, dir] = process.argv.slice(2);
if (cmd !== "validate" || !dir) {
  console.error("usage: bun src/cli.ts validate <projectDir>");
  process.exit(2);
}
const { project, diagnostics } = await loadProject(fsIO(dir));
if (diagnostics.length || !project) {
  for (const d of diagnostics) console.log(formatDiagnostic(d));
  process.exit(1);
}
console.log(`ok: ${project.tokens.tokens.size} tokens, ${project.components.size} components`);
