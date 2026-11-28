import { variantAxes, statesOf } from "../component/validate";
import type { Component } from "../component/schema";

/** Runtime values: variant axes, mode props and props (§4.8: every one of them is runtime API). */
export type Values = Record<string, string | boolean | null>;
export type Input =
  | { type: "pointerenter" | "pointerleave" | "pointerdown" | "pointerup" | "blur" | "click" }
  | { type: "focus"; visible: boolean }
  | { type: "keydown" | "keyup"; key: string };
export type Emitted = { name: string; detail: Record<string, string | boolean> };

/** Activation keys per role (WAI-ARIA practices): Enter fires on keydown, Space on keyup. */
export const ROLE_KEYS: Record<string, { enter: boolean; space: boolean }> = {
  button: { enter: true, space: true }, link: { enter: true, space: false },
  checkbox: { enter: false, space: true }, switch: { enter: true, space: true }, radio: { enter: false, space: true },
};
const INTERACTIVE = new Set(Object.keys(ROLE_KEYS));

export function defaultValues(doc: Component): Values {
  const out: Values = {};
  for (const [axis, { default: d }] of Object.entries(variantAxes(doc))) out[axis] = d;
  for (const [name, def] of Object.entries(doc.data.props ?? {})) {
    if (def.type === "mode" || def.type === "text" || def.type === "boolean") out[name] = def.default;
    else if (def.type === "instance") out[name] = def.default ?? null;
  }
  return out;
}

/**
 * The platform-neutral behavior of a component: inputs (pointer, focus, keys) → current state, values, ARIA and
 * emitted events. The web runtime drives it from DOM events; generated React/Compose code implements the same table.
 */
export function createController(doc: Component, init: Values) {
  const b = doc.data.behavior;
  const states = statesOf(doc);
  const values: Values = { ...defaultValues(doc), ...init };
  const flags = { hover: false, focusVisible: false, pressed: false, keyPressed: false };
  const isBool = (name: string) => doc.data.props?.[name]?.type === "boolean";
  const asKey = (v: unknown) => String(v);

  const active = (state: string): boolean => {
    const t = b?.states?.[state];
    if (!t) return false;
    if (typeof t === "object") return values[t.prop] === true;
    return t === "hover" ? flags.hover : t === "focus-visible" ? flags.focusVisible : flags.pressed || flags.keyPressed;
  };
  const inert = () => Object.entries(b?.states ?? {}).some(([s, t]) => typeof t === "object" && t.inert && active(s));
  /** Last declared state whose trigger is active; an active inert state wins over pointer/focus states. */
  const state = (): string => {
    const inertState = Object.entries(b?.states ?? {}).find(([s, t]) => typeof t === "object" && t.inert && active(s));
    if (inertState) return inertState[0];
    for (let i = states.length - 1; i > 0; i--) if (active(states[i]!)) return states[i]!;
    return states[0]!;
  };
  const activate = (): Emitted[] => {
    const changed: Record<string, string | boolean> = {};
    for (const [name, map] of Object.entries(b?.on?.activate?.set ?? {})) {
      const next = map[asKey(values[name])];
      if (next === undefined) continue;
      values[name] = isBool(name) ? next === "true" : next;
      changed[name] = values[name] as string | boolean;
    }
    const out: Emitted[] = [{ name: "activate", detail: {} }];
    if (b?.on?.activate?.emit) out.push({ name: b.on.activate.emit, detail: changed });
    return out;
  };
  const keys = ROLE_KEYS[b?.role ?? "none"];

  return {
    state,
    values: () => ({ ...values }),
    inert,
    set(next: Values) { Object.assign(values, next); },
    input(e: Input): Emitted[] {
      if (inert()) { flags.hover = flags.pressed = flags.keyPressed = flags.focusVisible = false; return []; }
      switch (e.type) {
        case "pointerenter": flags.hover = true; return [];
        case "pointerleave": flags.hover = false; flags.pressed = false; return [];
        case "pointerdown": flags.pressed = true; return [];
        case "pointerup": flags.pressed = false; return [];
        case "focus": flags.focusVisible = e.visible; return [];
        case "blur": flags.focusVisible = false; flags.keyPressed = false; return [];
        case "click": return keys || b?.on?.activate ? activate() : [];
        case "keydown":
          if (!keys) return [];
          if (e.key === "Enter" && keys.enter) return activate();
          if (e.key === " " && keys.space) flags.keyPressed = true;
          return [];
        case "keyup":
          if (e.key === " " && keys?.space && flags.keyPressed) { flags.keyPressed = false; return activate(); }
          return [];
      }
    },
    /** role, tabindex and aria-* for the host element. */
    aria(): Record<string, string> {
      const out: Record<string, string> = {};
      if (!b || b.role === "none") return out;
      out.role = b.role;
      if (INTERACTIVE.has(b.role)) out.tabindex = inert() ? "-1" : "0";
      if (inert()) out["aria-disabled"] = "true";
      for (const [attr, byName] of Object.entries(b.aria ?? {}))
        for (const [name, map] of Object.entries(byName)) {
          const v = map[asKey(values[name])];
          if (v !== undefined) out[`aria-${attr}`] = v;
        }
      return out;
    },
  };
}
export type Controller = ReturnType<typeof createController>;
