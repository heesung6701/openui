export const msgs = (d: { message: string }[]): string => d.map((x) => x.message).join("\n");

export const CHIP_YAML = `kind: Component
metadata: { id: chip, name: Chip }
data:
  props: { label: { type: text, default: "{text.chip.label}" }, trailing: { type: slot, max: 1 }, tone: { type: mode, modifier: chip-tone } }
  variants: { layout: { values: { inline: {}, stacked: {} }, default: inline } }
  anatomy:
    root:
      kind: frame
      layout: { direction: row, gap: "{g}", padding: ["{z}", "{p}"], width: hug, height: "{h}" }
      children:
        label: { kind: text, text: { prop: label } }
        tail: { kind: slot, prop: trailing }
  styles:
    base: { enabled: { root: { fill: "{c}", cornerRadius: "{r}" }, label: { color: "{c}" } } }
    layout=stacked: { enabled: { root: { direction: column } } }
  x-figma: { parts: { root: { blendMode: PASS_THROUGH } } }
  x-note: anything
`;
