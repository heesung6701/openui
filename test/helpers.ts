export const msgs = (d: { message: string }[]): string => d.map((x) => x.message).join("\n");

export const CHIP_YAML = `kind: Component
metadata: { id: chip, name: Chip }
data:
  props: { label: { type: text, default: Chip }, trailing: { type: slot, max: 1 } }
  variants: { size: { values: { small: {}, large: {} }, default: small } }
  anatomy:
    root:
      kind: frame
      layout: { direction: row, gap: 8px, padding: [0, 12px], width: hug, height: "{h}" }
      children:
        label: { kind: text, text: { prop: label } }
        tail: { kind: slot, prop: trailing }
  styles:
    base: { enabled: { root: { fill: "#6750A4", cornerRadius: 8px }, label: { color: "{c}" } } }
  x-figma: { parts: { root: { blendMode: PASS_THROUGH } } }
  x-note: anything
`;
