import { modePropsOf } from "../component/tokens";
import { partsOf, statesOf, variantAxes } from "../component/validate";
import type { Diagnostic } from "../diagnostics";
import type { Project } from "../project";
import { aliasTarget } from "../tokens/values";
import type { Checklist } from "./schema";

const list = (v: string | string[] | undefined): string[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

export function validateChecklist(cl: Checklist, file: string, project: Project): Diagnostic[] {
  const out: Diagnostic[] = [];
  const err = (path: (string | number)[], message: string) => out.push({ file, path, message });
  const comp = project.components.get(cl.metadata.component);
  if (!comp) {
    err(["metadata", "component"], `unknown component "${cl.metadata.component}"`);
    return out;
  }
  const parts = partsOf(comp.doc);
  const axes = variantAxes(comp.doc);
  const states = statesOf(comp.doc);
  const modifiers = new Map(project.tokens.collections.filter((c) => c.kind === "modifier").map((c) => [c.name, c.modes]));
  const ids = new Set<string>();

  const checkVariant = (variant: Record<string, string | string[]> | undefined, at: (string | number)[]) => {
    for (const [axis, v] of Object.entries(variant ?? {})) {
      if (!axes[axis]) err([...at, axis], `unknown variant axis "${axis}"`);
      else for (const value of list(v)) if (!axes[axis].values.includes(value)) err([...at, axis], `unknown value "${value}" for axis "${axis}"`);
    }
  };
  const checkStates = (s: string | string[] | undefined, at: (string | number)[]) => {
    for (const state of list(s)) if (!states.includes(state)) err(at, `unknown state "${state}" (declared: ${states.join(", ")})`);
  };

  cl.items.forEach((item, i) => {
    const at = ["items", i];
    if (ids.has(item.id)) err([...at, "id"], `duplicate item id "${item.id}"`);
    ids.add(item.id);
    if (item.check) {
      const c = item.check;
      if (!parts.has(c.part)) err([...at, "check", "part"], `unknown part "${c.part}"`);
      checkVariant(c.variant, [...at, "check", "variant"]);
      checkStates(c.state, [...at, "check", "state"]);
      const modeProps = modePropsOf(comp.doc);
      for (const [m, v] of Object.entries(c.mode ?? {})) {
        const modes = modifiers.get(m) ?? modeProps[m]?.values;
        if (!modes) err([...at, "check", "mode", m], `unknown modifier "${m}"`);
        else for (const ctx of list(v)) if (!modes.includes(ctx)) err([...at, "check", "mode", m], `unknown context "${ctx}" of modifier "${m}"`);
      }
      if (c.property === "text") {
        const alias = aliasTarget(c.expect);
        const t = alias ? project.tokens.tokens.get(alias) : undefined;
        if (!alias) err([...at, "check", "expect"], 'text check expects one text token like "{text.button.label}"');
        else if (t && t.type !== "string") err([...at, "check", "expect"], `token "{${alias}}" is ${t.type}, text check expects string`);
      }
      if (typeof c.expect === "string") {
        for (const [, alias] of c.expect.matchAll(/\{([^{}]+)\}/g)) {
          if (!project.tokens.tokens.has(alias!)) err([...at, "check", "expect"], `unknown token "{${alias}}"`);
        }
      }
    }
    if (item.interact) {
      const i = item.interact;
      const p = [...at, "interact"];
      const props = comp.doc.data.props ?? {};
      const space = (name: string): string[] | null => {
        const def = props[name];
        return axes[name]?.values ?? (def?.type === "mode" ? def.values : def?.type === "boolean" ? ["true", "false"] : null);
      };
      const checkValues = (vals: Record<string, string | boolean> | undefined, where: string) => {
        for (const [k, v] of Object.entries(vals ?? {})) {
          const def = props[k];
          if (def?.type === "text") continue; // any text
          const vs = space(k);
          if (!vs) err([...p, where, k], `unknown variant axis or prop "${k}"`);
          else if (!vs.includes(String(v))) err([...p, where, k], `unknown value "${v}" for "${k}" (${vs.join(", ")})`);
        }
      };
      checkValues(i.given, "given");
      checkValues(i.expect.values, "expect");
      if (i.expect.state !== undefined && !states.includes(i.expect.state)) err([...p, "expect", "state"], `unknown state "${i.expect.state}" (declared: ${states.join(", ")})`);
      if (!comp.doc.data.behavior) err(p, `component "${cl.metadata.component}" has no behavior (data.behavior) to interact with`);
    }
    if (item.hint) {
      checkVariant(item.hint.variant, [...at, "hint", "variant"]);
      checkStates(item.hint.state, [...at, "hint", "state"]);
    }
  });
  return out;
}
