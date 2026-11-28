export const msgs = (d: { message: string }[]): string => d.map((x) => x.message).join("\n");

export const CHIP_YAML = `kind: Component
metadata: { id: chip, name: Chip }
data:
  props: { label: { type: text, default: "{text.chip.label}" }, trailing: { type: slot, max: 1 }, tone: { type: mode, values: [a, b], default: a } }
  variants: { layout: { values: { inline: {}, stacked: {} }, default: inline } }
  tokens:
    g: { $type: dimension, $value: "{g}" }
  anatomy:
    root:
      kind: frame
      layout: { direction: row, gap: "{chip.g}", padding: ["{chip.z}", "{chip.p}"], width: hug, height: "{chip.h}" }
      children:
        label: { kind: text, text: { prop: label } }
        tail: { kind: slot, prop: trailing }
  styles:
    base: { enabled: { root: { fill: "{chip.c}", cornerRadius: "{chip.r}" }, label: { color: "{chip.c}" } } }
    layout=stacked: { enabled: { root: { direction: column } } }
  x-figma: { parts: { root: { blendMode: PASS_THROUGH } } }
  x-note: anything
`;
