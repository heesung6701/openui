// The web runtime (§4.8, appendix C): a custom element that renders and runs a component straight from its YAML spec.
import { createController, type Controller, type Emitted, type Input, type Values } from "../behavior/controller";
import { hostAttributes } from "../behavior/host";
import { variantAxes } from "../component/validate";
import { memoryIO } from "../io";
import { loadProject, type Project } from "../project";
import { toDOM } from "../render/dom";
import { conditionCss, tokenSheet } from "../render/tokens";
import { buildComponent } from "../render/vnode";
import type { Condition } from "../tokens/resolver";

const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

// Focus modality (as :focus-visible): keyboard unless the last input was a pointer.
let pointerModality = false;
if (typeof document !== "undefined") {
  document.addEventListener("pointerdown", () => { pointerModality = true; }, true);
  document.addEventListener("keydown", () => { pointerModality = false; }, true);
}

function conditionMatches(c: Condition, el: Element): boolean {
  if ("device" in c) return false; // the app chooses data-device explicitly
  if ("language" in c) {
    const lang = (el.closest("[lang]")?.getAttribute("lang") ?? navigator.language).toLowerCase();
    const want = c.language.toLowerCase();
    return lang === want || lang.startsWith(`${want}-`);
  }
  const media = conditionCss(c)?.media;
  return !!media && matchMedia(media).matches;
}

/** Global modes for an element: explicit `data-<modifier>` on the nearest `.ou-root`, else the matching condition, else default. */
export function globalModes(project: Project, el: Element): Record<string, string> {
  const root = el.closest(".ou-root") ?? document.documentElement;
  const out: Record<string, string> = {};
  for (const c of project.tokens.collections) {
    if (c.kind !== "modifier") continue;
    const explicit = root.getAttribute(`data-${c.name}`);
    if (explicit && c.modes.includes(explicit)) out[c.name] = explicit;
    else out[c.name] = Object.entries(c.when ?? {}).find(([, cond]) => conditionMatches(cond, el))?.[0] ?? c.defaultMode;
  }
  return out;
}

const BASE_CSS = `[data-ou-host]{display:inline-flex;vertical-align:middle;-webkit-tap-highlight-color:transparent}
[data-ou-host][tabindex="0"]{cursor:pointer;user-select:none}`;

/** Token sheet + host base styles; marks `root` as the token scope (`.ou-root`). */
export function installTokens(project: Project, root: Element = document.documentElement): void {
  let sheet = document.getElementById("ou-tokens") as HTMLStyleElement | null;
  if (!sheet) {
    sheet = document.head.appendChild(document.createElement("style"));
    sheet.id = "ou-tokens";
  }
  sheet.textContent = `${BASE_CSS}\n${tokenSheet(project.tokens)}`;
  root.classList.add("ou-root");
}

export class OuElement extends HTMLElement {
  project: Project | null = null;
  componentId = "";
  #ctl: Controller | null = null;
  #slotted = new Map<string, Node[]>();
  #observer: MutationObserver | null = null;
  #hostAttrs = new Set<string>();

  get #doc() { return this.project?.components.get(this.componentId)?.doc; }
  /** Current runtime values (variant axes, mode props, props). */
  get values(): Values { return this.#ctl?.values() ?? {}; }
  /** Current interaction state. */
  get state(): string { return this.#ctl?.state() ?? ""; }

  /** (Re)bind to a project/component, e.g. after the YAML changed. `values` override attributes. */
  reset(project: Project, id: string, values: Values = {}): void {
    this.project = project;
    this.componentId = id;
    this.#ctl = null;
    this.#observer?.disconnect();
    this.#observer = null;
    if (this.isConnected) this.#setup(values);
    this.render();
  }
  /** Set runtime values (like setting attributes) and re-render. */
  set(values: Values): void {
    this.#ctl?.set(values);
    this.render();
  }

  connectedCallback() {
    if (!this.#ctl) this.#setup({});
    this.render();
  }
  disconnectedCallback() {
    this.#observer?.disconnect();
    this.#observer = null;
  }

  #names(): string[] {
    const doc = this.#doc!;
    return [...Object.keys(variantAxes(doc)), ...Object.entries(doc.data.props ?? {}).filter(([, d]) => d.type !== "slot").map(([n]) => n)];
  }
  #readAttributes(): Values {
    const doc = this.#doc!;
    const out: Values = {};
    for (const name of this.#names()) {
      const attr = kebab(name);
      if (!this.hasAttribute(attr)) continue;
      const v = this.getAttribute(attr)!;
      out[name] = doc.data.props?.[name]?.type === "boolean" ? v !== "false" : v;
    }
    return out;
  }

  #setup(overrides: Values) {
    const doc = this.#doc;
    if (!doc) return;
    // light-DOM children become slot content: slot="<prop>", else the first slot prop
    if (!this.#slotted.size) {
      const slotProps = Object.entries(doc.data.props ?? {}).filter(([, d]) => d.type === "slot").map(([n]) => n);
      for (const child of [...this.childNodes]) {
        const name = (child instanceof Element && child.getAttribute("slot")) || slotProps[0];
        if (!name || !slotProps.includes(name)) continue;
        if (child.nodeType === Node.TEXT_NODE && !child.textContent!.trim()) continue;
        this.#slotted.set(name, [...(this.#slotted.get(name) ?? []), child]);
      }
    }
    this.#ctl = createController(doc, { ...this.#readAttributes(), ...overrides });
    this.setAttribute("data-ou-host", "");
    if (!this.#observer) {
      const feed = (e: Input) => this.#input(e);
      this.addEventListener("pointerenter", () => feed({ type: "pointerenter" }));
      this.addEventListener("pointerleave", () => feed({ type: "pointerleave" }));
      this.addEventListener("pointerdown", () => feed({ type: "pointerdown" }));
      this.addEventListener("pointerup", () => feed({ type: "pointerup" }));
      this.addEventListener("focus", () => feed({ type: "focus", visible: !pointerModality }));
      this.addEventListener("blur", () => feed({ type: "blur" }));
      this.addEventListener("click", () => feed({ type: "click" }));
      this.addEventListener("keydown", (e) => {
        if (e.key === " " && this.getAttribute("tabindex") === "0") e.preventDefault(); // no page scroll
        feed({ type: "keydown", key: e.key });
      });
      this.addEventListener("keyup", (e) => feed({ type: "keyup", key: e.key }));
    }
    this.#observer = new MutationObserver(() => {
      const next = this.#readAttributes();
      const cur = this.#ctl!.values();
      if (Object.entries(next).some(([k, v]) => cur[k] !== v)) this.set(next);
    });
    this.#observer.observe(this, { attributes: true, attributeFilter: this.#names().map(kebab) });
  }

  #input(e: Input) {
    const ctl = this.#ctl;
    if (!ctl) return;
    const before = JSON.stringify([ctl.state(), ctl.values()]);
    const emitted: Emitted[] = ctl.input(e);
    if (JSON.stringify([ctl.state(), ctl.values()]) !== before) {
      // reflect changed values to attributes so markup and CSS see them
      for (const ev of emitted) for (const [k, v] of Object.entries(ev.detail)) this.setAttribute(kebab(k), String(v));
      this.render();
    }
    for (const ev of emitted) this.dispatchEvent(new CustomEvent(ev.name, { detail: ev.detail, bubbles: true, composed: true }));
  }

  render(): void {
    const project = this.project;
    const doc = this.#doc;
    const ctl = this.#ctl;
    if (!project || !doc || !ctl) return;
    const v = ctl.values();
    const axes = Object.keys(variantAxes(doc));
    const variant = Object.fromEntries(axes.map((a) => [a, String(v[a])]));
    const props = Object.fromEntries(Object.entries(v).filter(([k]) => !axes.includes(k)));
    const modes = globalModes(project, this);
    const dom = toDOM(buildComponent(project, this.componentId, { variant, state: ctl.state(), props, modes, slotted: new Set(this.#slotted.keys()) }));
    for (const [name, nodes] of this.#slotted) dom.querySelector(`[data-slot="${name}"]`)?.append(...nodes);
    this.replaceChildren(dom);
    const attrs = hostAttributes(project, this.componentId, ctl, modes);
    for (const k of this.#hostAttrs) if (!(k in attrs)) this.removeAttribute(k);
    for (const [k, val] of Object.entries(attrs)) this.setAttribute(k, val);
    this.#hostAttrs = new Set(Object.keys(attrs));
  }
}

/** Register `<prefix-<component id>>` for every component of the project. */
export function defineElements(project: Project, prefix = "ou"): string[] {
  const names: string[] = [];
  for (const id of project.components.keys()) {
    const name = `${prefix}-${id}`;
    names.push(name);
    if (customElements.get(name)) continue;
    customElements.define(name, class extends OuElement {
      constructor() {
        super();
        this.project = project;
        this.componentId = id;
      }
    });
  }
  return names;
}

/** Load a bundled project: `{ files: { "openui.yaml": "...", ... } }` (see `openui bundle`). */
export async function loadBundle(source: string | { files: Record<string, string> }): Promise<Project> {
  const bundle = typeof source === "string" ? ((await (await fetch(source)).json()) as { files: Record<string, string> }) : source;
  const { project, diagnostics } = await loadProject(memoryIO(bundle.files));
  if (!project) throw new Error(`invalid OpenUI project: ${diagnostics.map((d) => `${d.file}: ${d.message}`).join("; ")}`);
  return project;
}
