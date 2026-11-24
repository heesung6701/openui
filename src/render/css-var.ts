/** CSS custom property name for a token path: `md.sys.color.primary` → `--md-sys-color-primary`. */
// ponytail: `a.b-c` and `a-b.c` collide; DTCG names rarely mix both, add escaping if a real collision appears.
export const cssVar = (path: string): string => `--${path.replaceAll(".", "-")}`;

/** Replace every `{a.b}` alias inside a string with `var(--a-b)`. */
export const aliasesToVars = (s: string): string => s.replace(/\{([^{}]+)\}/g, (_, p: string) => `var(${cssVar(p)})`);
