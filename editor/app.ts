import { autocompletion, type CompletionContext } from "@codemirror/autocomplete";
import { yaml } from "@codemirror/lang-yaml";
import { setDiagnostics, type Diagnostic as CmDiagnostic } from "@codemirror/lint";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { basicSetup } from "codemirror";
import type { Diagnostic } from "../src/diagnostics";
import { memoryIO } from "../src/io";
import { loadProject, type Project } from "../src/project";
import { bundledProjects, bundleIO, canOpenFolder, folderIO, serverIO, type BundledProject, type EditorIO } from "./io";
import { escapeHtml, filesHtml, problemsHtml, rangeOf, tokenCompletion } from "./support";

export { escapeHtml };

type Buffer = { text: string; saved: string };

export const state = {
  files: [] as string[],
  buffers: new Map<string, Buffer>(),
  editorStates: new Map<string, EditorState>(),
  current: "",
  project: undefined as Project | undefined,
  diagnostics: [] as Diagnostic[],
  io: serverIO as EditorIO,
  bundled: null as BundledProject[] | null,
};

/** Hooks filled in by the preview / checklist modules. */
export const hooks = { afterValidate: [] as (() => void)[], afterOpen: [] as (() => void)[] };

declare global {
  interface Window {
    __openui: { diagnostics: Diagnostic[]; runAll?: () => Promise<unknown>; state: typeof state; view?: EditorView; openFile?: typeof openFile };
  }
}
window.__openui = { diagnostics: [], state };

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

document.querySelector("#app")!.innerHTML = `
  <header>
    <strong>OpenUI editor</strong>
    <span id="source"></span>
    <span id="modes"></span>
    <button id="save" title="Save (⌘S)">Save</button>
    <a id="guide" href="./guide.html" target="_blank" rel="noopener">스펙 해설</a>
    <span id="status"></span>
  </header>
  <aside id="files"></aside>
  <section id="code"></section>
  <section id="right"><div id="preview"></div><div id="checklist"></div></section>
  <footer id="problems"></footer>`;

// ---------- validation ----------
let timer: ReturnType<typeof setTimeout> | undefined;
let generation = 0;
export function scheduleValidate(delay = 200) {
  clearTimeout(timer);
  timer = setTimeout(validate, delay);
}
async function validate() {
  const gen = ++generation;
  const files = Object.fromEntries([...state.buffers].map(([p, b]) => [p, b.text]));
  let result: Awaited<ReturnType<typeof loadProject>>;
  try {
    result = await loadProject(memoryIO(files));
  } catch (e) {
    result = { diagnostics: [{ file: "openui.yaml", path: [], message: `internal error: ${(e as Error).message}` }] };
  }
  if (gen !== generation) return; // a newer edit superseded this run
  if (result.project) state.project = result.project;
  state.diagnostics = result.diagnostics;
  window.__openui.diagnostics = result.diagnostics;
  pushLint();
  renderProblems();
  renderFiles();
  for (const h of hooks.afterValidate) {
    try {
      h();
    } catch (e) {
      console.error(e); // one failing panel must not block the others
    }
  }
}

// ---------- editor ----------
// Diagnostics arrive asynchronously (after validation), so they are pushed, not pulled by a linter.
const lintSource = (v: EditorView): CmDiagnostic[] => {
  const text = v.state.doc.toString();
  return state.diagnostics
    .filter((d) => d.file === state.current)
    .map((d) => {
      const r = d.range ? { from: d.range[0], to: d.range[1] } : rangeOf(text, d.path);
      return { from: Math.min(r.from, text.length), to: Math.min(Math.max(r.to, r.from), text.length), severity: "error", message: `${d.path.join(".") || "(file)"}: ${d.message}` };
    });
};

const completion = (ctx: CompletionContext) => {
  const line = ctx.state.doc.lineAt(ctx.pos);
  const r = tokenCompletion(line.text.slice(0, ctx.pos - line.from), [...(state.project?.tokens.tokens.keys() ?? [])]);
  if (!r) return null;
  return { from: line.from + r.from, options: r.options.map((label) => ({ label, type: "variable", apply: label })), validFor: /^[\w.-]*$/ };
};

const extensions: Extension[] = [
  basicSetup,
  yaml(),
  autocompletion({ override: [completion] }),
  keymap.of([{ key: "Mod-s", preventDefault: true, run: () => (save(), true) }]),
  EditorView.updateListener.of((u) => {
    if (!u.docChanged) return;
    const b = state.buffers.get(state.current);
    if (b) b.text = u.state.doc.toString();
    renderFiles();
    scheduleValidate();
  }),
];

const pushLint = () => view.dispatch(setDiagnostics(view.state, lintSource(view)));

const view = new EditorView({ parent: $("#code"), state: EditorState.create({ doc: "", extensions }) });
window.__openui.view = view; // automation hook (E2E checks)

export function openFile(path: string, select?: { from: number; to: number }) {
  if (state.current) state.editorStates.set(state.current, view.state);
  state.current = path;
  const b = state.buffers.get(path);
  view.setState(state.editorStates.get(path) ?? EditorState.create({ doc: b?.text ?? "", extensions }));
  if (select) view.dispatch({ selection: { anchor: select.from, head: select.to }, scrollIntoView: true });
  view.focus();
  pushLint();
  renderFiles();
  for (const h of hooks.afterOpen) h();
}

window.__openui.openFile = (p, s) => openFile(p, s);

async function save() {
  const path = state.current;
  const b = state.buffers.get(path);
  if (!b) return;
  const text = b.text;
  try {
    const how = await state.io.write(path, text);
    b.saved = text;
    $("#status").textContent = `${how} ${path}`;
  } catch (e) {
    $("#status").textContent = (e as Error).message;
  }
  renderFiles();
}
$("#save").addEventListener("click", () => save());

// ---------- side panels ----------
function renderFiles() {
  $("#files").innerHTML = filesHtml(state.files, state.buffers, state.current, state.diagnostics);
}
$("#files").addEventListener("click", (e) => {
  const f = (e.target as HTMLElement).closest<HTMLElement>("[data-file]")?.dataset.file;
  if (f) openFile(f);
});

function renderProblems() {
  $("#problems").innerHTML = problemsHtml(state.diagnostics);
}
$("#problems").addEventListener("click", (e) => {
  const i = (e.target as HTMLElement).closest<HTMLElement>("[data-i]")?.dataset.i;
  if (i === undefined) return;
  const d = state.diagnostics[Number(i)]!;
  if (!state.buffers.has(d.file)) return;
  openFile(d.file, rangeOf(state.buffers.get(d.file)!.text, d.path));
});


window.addEventListener("beforeunload", (e) => {
  if (dirty()) e.preventDefault();
});

// ---------- project source ----------
const dirty = () => [...state.buffers.values()].some((b) => b.text !== b.saved);

function renderSource() {
  const parts: string[] = [];
  if (state.bundled) {
    parts.push(`<select id="project" title="Example project">${state.bundled
      .map((p, i) => `<option value="${i}"${state.io.kind === "bundle" && state.io.label === p.title ? " selected" : ""}>${escapeHtml(p.title)}</option>`).join("")}${state.io.kind === "folder" ? `<option selected>📁 ${escapeHtml(state.io.label)}</option>` : ""}</select>`);
    if (canOpenFolder()) parts.push(`<button id="open-folder" title="Edit YAML files in a local folder (writes in place)">Open folder…</button>`);
    if (state.io.kind === "bundle") parts.push(`<span class="muted">example · Save downloads the file</span>`);
  }
  $("#source").innerHTML = parts.join(" ");
}
$("#source").addEventListener("change", async (e) => {
  const sel = e.target as HTMLSelectElement;
  if (sel.id !== "project" || !state.bundled?.[Number(sel.value)]) return;
  if (dirty() && !confirm("Discard unsaved changes?")) return renderSource();
  await load(bundleIO(state.bundled[Number(sel.value)]!));
});
$("#source").addEventListener("click", async (e) => {
  if ((e.target as HTMLElement).id !== "open-folder") return;
  if (dirty() && !confirm("Discard unsaved changes?")) return;
  try {
    await load(await folderIO());
  } catch (err) {
    if ((err as Error).name !== "AbortError") $("#status").textContent = (err as Error).message;
  }
});

export async function load(io: EditorIO) {
  state.io = io;
  state.files = await io.list();
  state.buffers.clear();
  state.editorStates.clear();
  state.current = "";
  await Promise.all(state.files.map(async (f) => {
    const text = await io.read(f);
    state.buffers.set(f, { text, saved: text });
  }));
  renderSource();
  openFile(state.files.find((f) => f.startsWith("components/")) ?? state.files[0] ?? "");
  $("#status").textContent = io.label;
  await validate();
}

// ---------- boot ----------
export async function boot() {
  state.bundled = await bundledProjects();
  await load(state.bundled?.length ? bundleIO(state.bundled[0]!) : serverIO);
}
