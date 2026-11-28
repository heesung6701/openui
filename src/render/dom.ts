import type { VNode } from "./vnode";

const SVG_NS = "http://www.w3.org/2000/svg";

/** VNode → DOM (browser). Shared by the editor preview and the web runtime. */
export function toDOM(v: VNode): Element {
  const el = v.tag === "svg" || v.tag === "path" ? document.createElementNS(SVG_NS, v.tag) : document.createElement(v.tag);
  for (const [k, val] of Object.entries(v.attrs)) el.setAttribute(k, val);
  for (const [k, val] of Object.entries(v.style)) (el as HTMLElement).style.setProperty(k, val);
  if (v.text !== undefined) el.textContent = v.text;
  for (const c of v.children) el.appendChild(toDOM(c));
  return el;
}
