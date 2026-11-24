import { variantCombos } from "../src/component/resolve";
import { statesOf } from "../src/component/validate";
import type { Project } from "../src/project";
import { tokenSheet } from "../src/render/tokens";
import { buildComponent, type RenderOptions, type VNode } from "../src/render/vnode";
import { escapeHtml, hooks, state } from "./app";
import { previewMode } from "./support";

const SVG_NS = "http://www.w3.org/2000/svg";

export function toDOM(v: VNode): Element {
  const el = v.tag === "svg" || v.tag === "path" ? document.createElementNS(SVG_NS, v.tag) : document.createElement(v.tag);
  for (const [k, val] of Object.entries(v.attrs)) el.setAttribute(k, val);
  for (const [k, val] of Object.entries(v.style)) (el as HTMLElement).style.setProperty(k, val);
  if (v.text !== undefined) el.textContent = v.text;
  for (const c of v.children) el.appendChild(toDOM(c));
  return el;
}

/** Per-viewer UI choices: prop values per component, selected context per modifier. */
export const ui = { props: {} as Record<string, RenderOptions["props"]>, modes: {} as Record<string, string> };

export const modifiersOf = (p: Project) => p.tokens.collections.filter((c) => c.kind === "modifier");
export const modeOf = (p: Project, name: string) => ui.modes[name] ?? modifiersOf(p).find((c) => c.name === name)!.defaultMode;

/** Wrap content in a `.ou-root` carrying the token sheet scope and modifier attributes. */
export function ouRoot(p: Project, modes: Record<string, string> = {}): HTMLElement {
  const root = document.createElement("div");
  root.className = "ou-root";
  for (const c of modifiersOf(p)) root.setAttribute(`data-${c.name}`, modes[c.name] ?? modeOf(p, c.name));
  return root;
}

/** Component id shown for the current file (a component file, or the component a checklist targets). */
export function previewTarget(p: Project): string | null {
  for (const [id, c] of p.components) if (c.file === state.current) return id;
  for (const [id, c] of p.checklists) if (c.file === state.current && p.components.has(id)) return id;
  return null;
}

const host = document.querySelector<HTMLElement>("#preview")!;
const sheet = document.head.appendChild(document.createElement("style"));
sheet.id = "ou-tokens";

function renderModes(p: Project) {
  document.querySelector("#modes")!.innerHTML = modifiersOf(p)
    .map((c) => `<label>${escapeHtml(c.name)}<select data-modifier="${escapeHtml(c.name)}">${c.modes
      .map((m) => `<option${m === modeOf(p, c.name) ? " selected" : ""}>${escapeHtml(m)}</option>`).join("")}</select></label>`)
    .join("");
}
document.querySelector("#modes")!.addEventListener("change", (e) => {
  const sel = e.target as HTMLSelectElement;
  ui.modes[sel.dataset.modifier!] = sel.value;
  renderPreview();
});

function propsPanel(p: Project, id: string): string {
  const props = p.components.get(id)!.doc.data.props ?? {};
  const values = (ui.props[id] ??= {});
  const ids = [...p.components.keys()];
  const rows = Object.entries(props).map(([name, def]) => {
    const v = values[name];
    const n = escapeHtml(name);
    if (def.type === "text") return `<label>${n} <input data-prop="${n}" value="${escapeHtml(String(v ?? def.default))}"></label>`;
    if (def.type === "boolean") return `<label><input type="checkbox" data-prop="${n}"${(v ?? def.default) ? " checked" : ""}> ${n}</label>`;
    if (def.type === "instance") {
      const current = v === undefined ? def.default ?? "" : v ?? "";
      const options = ["", ...(def.preferred ?? []), ...ids.filter((x) => !(def.preferred ?? []).includes(x))];
      return `<label>${n} <select data-prop="${n}">${options.map((o) => `<option value="${o}"${o === current ? " selected" : ""}>${o || "(none)"}</option>`).join("")}</select></label>`;
    }
    return `<span class="muted">${n}: slot</span>`;
  });
  return rows.length ? `<div class="pv-props">${rows.join("")}</div>` : "";
}
host.addEventListener("input", (e) => {
  const el = e.target as HTMLInputElement;
  const p = state.project;
  const id = p && previewTarget(p);
  if (!el.dataset.prop || !id) return;
  ui.props[id]![el.dataset.prop] = el.type === "checkbox" ? el.checked : el.tagName === "SELECT" ? el.value || null : el.value;
  renderGrid(p, id);
});

let lastGood: { file: string; id: string; grid: HTMLElement } | null = null;

export function renderGrid(p: Project, id: string) {
  const doc = p.components.get(id)!.doc;
  const states = statesOf(doc);
  const dark = Object.values(modifiersOf(p).map((c) => modeOf(p, c.name))).some((m) => m.includes("dark"));
  const grid = document.createElement("table");
  grid.className = `pv-grid${dark ? " dark" : ""}`;
  grid.innerHTML = `<tr><th></th>${states.map((s) => `<th>${escapeHtml(s)}</th>`).join("")}</tr>`;
  for (const variant of variantCombos(doc)) {
    const tr = grid.insertRow();
    tr.insertCell().outerHTML = `<th class="row">${escapeHtml(Object.entries(variant).map(([k, v]) => `${k}=${v}`).join(", ") || "base")}</th>`;
    for (const s of states) {
      const td = tr.insertCell();
      td.dataset.cell = JSON.stringify({ variant, state: s });
      const root = ouRoot(p);
      root.appendChild(toDOM(buildComponent(p, id, { variant, state: s, props: ui.props[id] ?? {} })));
      td.appendChild(root);
    }
  }
  const slot = host.querySelector(".pv-grid-slot")!;
  slot.replaceChildren(grid);
  lastGood = { file: state.current, id, grid };
}

export function renderPreview() {
  const p = state.project;
  if (!p) return;
  try {
    sheet.textContent = tokenSheet(p.tokens);
  } catch (e) {
    console.error("token sheet failed", e); // keep the previous sheet; diagnostics explain why
  }
  renderModes(p);
  const id = previewTarget(p);
  const mode = previewMode(state.current, id !== null, state.diagnostics, lastGood?.file ?? null);
  if (mode === "keep") {
    host.innerHTML = `<h3>${escapeHtml(lastGood!.id)}</h3><div class="pv-error">Preview paused: fix the errors in this file to update it.</div><div class="pv-grid-slot"></div>`;
    host.querySelector(".pv-grid-slot")!.replaceChildren(lastGood!.grid);
    return;
  }
  if (mode === "none" || !id) {
    host.innerHTML = `<p class="muted">Open a component or checklist file to preview it.</p>`;
    lastGood = null;
    return;
  }
  host.innerHTML = `<h3>${escapeHtml(p.components.get(id)!.doc.metadata.name)}</h3>${propsPanel(p, id)}<div class="pv-error" hidden></div><div class="pv-grid-slot"></div>`;
  try {
    renderGrid(p, id);
  } catch (e) {
    // keep the last good render of this component and say why the new one failed
    if (lastGood?.id === id) host.querySelector(".pv-grid-slot")!.replaceChildren(lastGood.grid);
    const banner = host.querySelector<HTMLElement>(".pv-error")!;
    banner.hidden = false;
    banner.textContent = `render failed: ${(e as Error).message}`;
  }
}

hooks.afterValidate.push(renderPreview);
hooks.afterOpen.push(renderPreview);
