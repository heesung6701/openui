import { createController, type Controller, type Emitted, type Values } from "../behavior/controller";
import { hostAttributes } from "../behavior/host";
import type { Project } from "../project";

export const STEPS = ["hover", "unhover", "press", "release", "click", "focus", "blur", "key:Enter", "key:Space"] as const;
export type Step = (typeof STEPS)[number];
export type Interact = {
  given?: Record<string, string | boolean>;
  do: Step[];
  expect: { values?: Record<string, string | boolean>; state?: string; attrs?: Record<string, string>; events?: string[] };
};
export type Snapshot = { values: Values; state: string; attrs: Record<string, string>; events: string[] };
/** Something that can be put in an initial state, driven step by step and observed (the controller, or a live element). */
export type Actor = { start(given: Record<string, string | boolean>): Promise<void>; step(s: Step): Promise<void>; snapshot(): Snapshot };
export type InteractResult = { pass: boolean; actual: string; expected: string };

const show = (o: Record<string, unknown>) => Object.entries(o).map(([k, v]) => `${k}=${v}`).join(", ");

/** Run one interaction check. Expected events must match the emitted sequence exactly. */
export async function runInteract(i: Interact, actor: Actor): Promise<InteractResult> {
  await actor.start(i.given ?? {});
  for (const s of i.do) await actor.step(s);
  const snap = actor.snapshot();
  const exp: string[] = [];
  const act: string[] = [];
  let pass = true;
  const cmp = (label: string, want: unknown, got: unknown) => {
    exp.push(`${label}: ${want}`);
    act.push(`${label}: ${got}`);
    if (String(want) !== String(got)) pass = false;
  };
  if (i.expect.values) cmp("values", show(i.expect.values), show(Object.fromEntries(Object.keys(i.expect.values).map((k) => [k, snap.values[k]]))));
  if (i.expect.state) cmp("state", i.expect.state, snap.state);
  if (i.expect.attrs) cmp("attrs", show(i.expect.attrs), show(Object.fromEntries(Object.keys(i.expect.attrs).map((k) => [k, snap.attrs[k] ?? "(none)"]))));
  if (i.expect.events) cmp("events", `[${i.expect.events.join(", ")}]`, `[${snap.events.join(", ")}]`);
  return { pass, actual: act.join("; "), expected: exp.join("; ") };
}

/** Drive the platform-neutral controller (no DOM): what every runtime must reproduce. */
export function controllerActor(project: Project, id: string): Actor {
  const doc = project.components.get(id)!.doc;
  let ctl: Controller = createController(doc, {});
  let events: Emitted[] = [];
  const feed = (e: Parameters<Controller["input"]>[0]) => { events.push(...ctl.input(e)); };
  return {
    async start(given) { ctl = createController(doc, given); events = []; },
    async step(s) {
      if (s === "hover") feed({ type: "pointerenter" });
      else if (s === "unhover") feed({ type: "pointerleave" });
      else if (s === "press") feed({ type: "pointerdown" });
      else if (s === "release") feed({ type: "pointerup" });
      else if (s === "click") { feed({ type: "pointerdown" }); feed({ type: "pointerup" }); feed({ type: "click" }); }
      else if (s === "focus") feed({ type: "focus", visible: true });
      else if (s === "blur") feed({ type: "blur" });
      else { const key = s === "key:Enter" ? "Enter" : " "; feed({ type: "keydown", key }); feed({ type: "keyup", key }); }
    },
    snapshot: () => ({ values: ctl.values(), state: ctl.state(), attrs: hostAttributes(project, id, ctl, {}), events: events.map((e) => e.name) }),
  };
}
