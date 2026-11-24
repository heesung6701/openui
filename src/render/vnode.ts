import type { PartNode } from "../component/schema";
import { resolveStyles } from "../component/resolve";
import { statesOf } from "../component/validate";
import type { Project } from "../project";
import { partStyle } from "./style";

export type VNode = { tag: string; attrs: Record<string, string>; style: Record<string, string>; text?: string; children: VNode[] };
export type RenderOptions = { variant: Record<string, string>; state: string; props: Record<string, string | boolean | null> };

const MAX_DEPTH = 8;
const note = (text: string): VNode => ({ tag: "div", attrs: {}, style: {}, text, children: [] });

/** Spec → VNode tree. Every part carries `data-part`; the root also `data-component`. */
export function buildComponent(project: Project, id: string, opts: RenderOptions, depth = 0): VNode {
  if (depth > MAX_DEPTH) return note("instance depth limit");
  const comp = project.components.get(id);
  if (!comp) return note(`unknown component "${id}"`);
  const doc = comp.doc;
  const styles = resolveStyles(doc, opts.variant, opts.state);
  const props = doc.data.props ?? {};
  const propVal = (name: string) => {
    const v = opts.props[name];
    if (v !== undefined) return v;
    const d = props[name];
    return d && "default" in d ? d.default ?? null : null;
  };

  const build = (name: string, part: PartNode, parentDirection: string | null, isRoot: boolean): VNode => {
    const resolved = styles[name] ?? {};
    const style = partStyle(part.kind, resolved, { parentDirection, isRoot });
    if (part.visible && propVal(part.visible.prop) === false) style.display = "none";
    const attrs: Record<string, string> = { "data-part": name };
    if (isRoot) attrs["data-component"] = id;
    const dir = part.kind === "frame" || part.kind === "slot" ? ((resolved.direction as string | undefined) ?? "none") : null;
    const kids = () => Object.entries(part.children ?? {}).map(([n, p]) => build(n, p, dir, false));

    switch (part.kind) {
      case "frame":
        return { tag: "div", attrs, style, children: kids() };
      case "slot":
        if (part.children && Object.keys(part.children).length) return { tag: "div", attrs, style, children: kids() };
        Object.assign(style, { outline: "1px dashed currentColor", "outline-offset": "-1px", "min-width": style["min-width"] ?? "24px", "min-height": style["min-height"] ?? "24px", font: "12px/1.4 monospace", opacity: style.opacity ?? "0.6" });
        return { tag: "div", attrs, style, text: part.prop, children: [] };
      case "text": {
        const t = part.text;
        return { tag: "div", attrs, style, text: typeof t === "string" ? t : t ? String(propVal(t.prop) ?? "") : "", children: [] };
      }
      case "instance": {
        const target = part.component ?? (part.prop ? propVal(part.prop) : null);
        if (typeof target !== "string") return { tag: "div", attrs, style, children: [] };
        const targetDoc = project.components.get(target)?.doc;
        const inner = buildComponent(project, target, { variant: {}, state: targetDoc ? statesOf(targetDoc)[0]! : "enabled", props: {} }, depth + 1);
        const sized = (k: "width" | "height") => resolved[k] !== undefined && resolved[k] !== "hug";
        if (sized("width")) inner.style.width = "100%";
        if (sized("height")) inner.style.height = "100%";
        return { tag: "div", attrs, style, children: [inner] };
      }
      case "vector": {
        const d = part.svg!.d;
        return { tag: "svg", attrs: { ...attrs, viewBox: part.svg!.viewBox }, style, children: (Array.isArray(d) ? d : [d]).map((p) => ({ tag: "path", attrs: { d: p }, style: {}, children: [] })) };
      }
      case "image":
        return { tag: "img", attrs: { ...attrs, src: part.src!, alt: "" }, style, children: [] };
    }
  };
  return build("root", doc.data.anatomy.root as PartNode, null, true);
}
