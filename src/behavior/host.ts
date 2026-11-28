import type { Project } from "../project";
import { resolveToken } from "../tokens/resolver";
import { aliasTarget } from "../tokens/values";
import type { Controller } from "./controller";

/** Host element attributes: role, tabindex, aria-* from the controller, plus aria-label from `behavior.label`. */
export function hostAttributes(project: Project, id: string, ctl: Controller, modes: Record<string, string>): Record<string, string> {
  const out = ctl.aria();
  const label = project.components.get(id)?.doc.data.behavior?.label;
  if (label) {
    const raw = typeof label === "object" ? ctl.values()[label.prop] : label;
    const a = aliasTarget(raw);
    const text = a ? resolveToken(project.tokens, a, { ...modes, ...stringValues(ctl.values()) }) : raw;
    if (typeof text === "string" && text) out["aria-label"] = text;
  }
  return out;
}
const stringValues = (v: Record<string, unknown>) => Object.fromEntries(Object.entries(v).filter(([, x]) => typeof x === "string")) as Record<string, string>;
