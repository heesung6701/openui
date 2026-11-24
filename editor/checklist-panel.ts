import { runChecklist, type ItemResult, type Measure } from "../src/checklist/run";
import type { Checklist } from "../src/checklist/schema";
import type { Project } from "../src/project";
import { buildComponent } from "../src/render/vnode";
import { escapeHtml, hooks, state } from "./app";
import { ouRoot, previewTarget, toDOM } from "./preview";

/** Render one case off-screen and read computed styles: the part's actual value vs. a probe set to `expect`. */
export function domMeasure(p: Project, id: string): Measure {
  return async (c) => {
    const stage = document.body.appendChild(document.createElement("div"));
    stage.style.cssText = "position:fixed;left:-10000px;top:0;";
    const root = stage.appendChild(ouRoot(p, c.mode));
    const top = root.appendChild(toDOM(buildComponent(p, id, { variant: c.variant, state: c.state, props: {} })));
    const probe = root.appendChild(document.createElement("div"));
    try {
      // parts of nested instances also carry data-part; only match parts owned by the top component
      const el = c.part === "root" ? top : [...top.querySelectorAll(`[data-part="${CSS.escape(c.part)}"]`)].find((e) => e.closest("[data-component]") === top);
      const actual = el ? getComputedStyle(el).getPropertyValue(c.property).trim() : "(part not rendered)";
      probe.style.setProperty(c.property, c.expectCss);
      const expected = getComputedStyle(probe).getPropertyValue(c.property).trim();
      return { actual, expected };
    } finally {
      stage.remove();
    }
  };
}

export async function runAll(): Promise<Record<string, ItemResult[]>> {
  const p = state.project;
  const out: Record<string, ItemResult[]> = {};
  if (!p) return out;
  for (const [id, { doc }] of p.checklists) {
    const comp = p.components.get(id);
    if (comp) out[id] = await runChecklist(doc, comp.doc, p.tokens, domMeasure(p, id));
  }
  return out;
}
window.__openui.runAll = runAll;

const key = (cl: Checklist, item: string) => `openui:check:${cl.metadata.id}:${item}`;
const getTick = (k: string) => {
  try {
    return localStorage.getItem(k) === "1";
  } catch {
    return false;
  }
};
const setTick = (k: string, v: boolean) => {
  try {
    if (v) localStorage.setItem(k, "1");
    else localStorage.removeItem(k);
  } catch {
    // storage unavailable (private mode): ticks just don't persist
  }
};

const host = document.querySelector<HTMLElement>("#checklist")!;
let generation = 0;
let current: { cl: Checklist; results: ItemResult[] } | null = null;

const fmtCase = (c: ItemResult["cases"][number]) =>
  `${[...Object.entries(c.variant).map(([k, v]) => `${k}=${v}`), c.state, ...Object.values(c.mode)].join(" · ")}: ${c.actual} ≠ ${c.expected}`;

function render() {
  if (!current) {
    host.innerHTML = "";
    return;
  }
  const { cl, results } = current;
  const auto = results.filter((r) => r.kind === "auto");
  const manual = results.filter((r) => r.kind === "manual");
  const ticked = manual.filter((r) => getTick(key(cl, r.id))).length;
  host.innerHTML = `<h3>Checklist · <span class="${auto.every((r) => r.pass) ? "ok" : "err"}">auto ${auto.filter((r) => r.pass).length}/${auto.length}</span> · manual ${ticked}/${manual.length}</h3>` +
    results.map((r) => {
      if (r.kind === "manual") {
        return `<div class="ck-item" data-item="${r.id}"><label><input type="checkbox" data-tick="${r.id}"${getTick(key(cl, r.id)) ? " checked" : ""}> ✋ ${escapeHtml(r.title)}</label></div>`;
      }
      const fails = r.cases.filter((c) => !c.pass);
      return `<div class="ck-item" data-item="${r.id}"><span class="${r.pass ? "ok" : "err"}">${r.pass ? "✓" : "✗"}</span> ${escapeHtml(r.title)} <span class="muted">(${r.cases.length - fails.length}/${r.cases.length})</span>` +
        (fails.length ? `<ul>${fails.slice(0, 5).map((c) => `<li>${escapeHtml(fmtCase(c))}</li>`).join("")}${fails.length > 5 ? `<li>… ${fails.length - 5} more</li>` : ""}</ul>` : "") + "</div>";
    }).join("");
}

host.addEventListener("change", (e) => {
  const el = e.target as HTMLInputElement;
  if (!el.dataset.tick || !current) return;
  setTick(key(current.cl, el.dataset.tick), el.checked);
  render();
});

host.addEventListener("click", (e) => {
  const id = (e.target as HTMLElement).closest<HTMLElement>("[data-item]")?.dataset.item;
  const item = id && current?.cl.items.find((i) => i.id === id);
  if (!item) return;
  const filter = item.check ?? item.hint ?? {};
  const list = (v: string | string[] | undefined) => (v === undefined ? undefined : Array.isArray(v) ? v : [v]);
  for (const td of document.querySelectorAll<HTMLElement>("#preview td[data-cell]")) {
    const cell = JSON.parse(td.dataset.cell!) as { variant: Record<string, string>; state: string };
    const states = list(filter.state);
    const match = (!states || states.includes(cell.state)) &&
      Object.entries(filter.variant ?? {}).every(([axis, v]) => list(v)!.includes(cell.variant[axis]!));
    td.classList.toggle("hl", match);
  }
});

async function refresh() {
  const p = state.project;
  const id = p && previewTarget(p);
  const entry = id ? p.checklists.get(id) : undefined;
  const comp = id ? p!.components.get(id) : undefined;
  const gen = ++generation;
  if (!p || !id || !entry || !comp) {
    current = null;
    render();
    return;
  }
  const results = await runChecklist(entry.doc, comp.doc, p.tokens, domMeasure(p, id));
  if (gen !== generation) return;
  current = { cl: entry.doc, results };
  render();
}

hooks.afterValidate.push(refresh);
hooks.afterOpen.push(refresh);
