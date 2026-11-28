import { z } from "zod";
import type { Diagnostic } from "../diagnostics";
import { aliasTarget, baseSchemas, TOKEN_TYPES, type TokenType } from "./values";

export type TokenDef = {
  path: string;
  /** null = inherits the type of its alias target; the resolver fills it in. */
  type: TokenType | null;
  value: unknown;
  description?: string;
  extensions?: Record<string, unknown>;
  /** Component tokens only: mode expression → value (§4.7). */
  when?: unknown;
  file: string;
};

const FigmaExtension = z.strictObject({
  scopes: z.array(z.string()).optional(),
  codeSyntax: z.strictObject({ WEB: z.string().optional(), ANDROID: z.string().optional(), iOS: z.string().optional() }).optional(),
  hiddenFromPublishing: z.boolean().optional(),
});

const KNOWN = new Set(["$value", "$type", "$description", "$extensions", "$deprecated"]);
const UNSUPPORTED = new Set(["$extends", "$root", "$ref"]);

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

export function walkTokenTree(doc: unknown, file: string, opts: { allowWhen?: boolean } = {}): { tokens: TokenDef[]; diagnostics: Diagnostic[] } {
  const tokens: TokenDef[] = [];
  const diagnostics: Diagnostic[] = [];
  const err = (path: (string | number)[], message: string) => diagnostics.push({ file, path, message });

  const checkType = (t: unknown, path: string[]): TokenType | null | undefined => {
    if (t === undefined) return undefined;
    if (typeof t === "string" && (TOKEN_TYPES as readonly string[]).includes(t)) return t as TokenType;
    err([...path, "$type"], `unsupported in openui 0.1: $type ${JSON.stringify(t)}`);
    return null;
  };

  const walk = (node: unknown, path: string[], inherited: TokenType | undefined): void => {
    if (!isObject(node)) {
      err(path, path.length ? "expected a group or token object" : "token file must be a mapping");
      return;
    }
    for (const k of Object.keys(node)) {
      if (!k.startsWith("$") || KNOWN.has(k)) continue;
      if (k === "$when" && opts.allowWhen) {
        if (!("$value" in node)) err([...path, k], "$when is only allowed on tokens");
        continue;
      }
      err([...path, k], UNSUPPORTED.has(k) ? `unsupported in openui 0.1: ${k}` : `unknown property ${k}`);
    }
    const children = Object.keys(node).filter((k) => !k.startsWith("$"));
    const ownType = checkType(node.$type, path);
    if (ownType === null) return;

    if ("$value" in node) {
      if (children.length) {
        err(path, `token has both $value and children (${children.join(", ")})`);
        return;
      }
      const value = node.$value;
      const isAlias = aliasTarget(value) !== null;
      const type = ownType ?? (isAlias ? null : inherited ?? null);
      if (!type && !isAlias) {
        err(path, "cannot determine $type (set $type on the token or a parent group)");
        return;
      }
      if (type && !isAlias) {
        const r = baseSchemas[type].safeParse(value);
        if (!r.success) {
          const hint = type === "color" && typeof value === "string"
            ? "color $value must be an object {colorSpace: srgb, components: [r, g, b]} (hex strings are not DTCG 2025.10)"
            : r.error.issues[0]!.message;
          const sub = r.error.issues[0]!.path.map(String);
          err([...path, "$value", ...sub], `invalid ${type} $value: ${hint}`);
          return;
        }
      }
      const ext = node.$extensions;
      if (ext !== undefined && !isObject(ext)) err([...path, "$extensions"], "$extensions must be a mapping");
      else if (ext && "com.figma" in ext) {
        const r = FigmaExtension.safeParse(ext["com.figma"]);
        if (!r.success) err([...path, "$extensions", "com.figma", ...r.error.issues[0]!.path.map(String)], r.error.issues[0]!.message);
      }
      tokens.push({
        path: path.join("."),
        type,
        value,
        ...(typeof node.$description === "string" ? { description: node.$description } : {}),
        ...(isObject(ext) ? { extensions: ext } : {}),
        ...("$when" in node && opts.allowWhen ? { when: node.$when } : {}),
        file,
      });
      return;
    }

    for (const k of children) {
      if (/[{}.]/.test(k)) {
        err([...path, k], `invalid name ${JSON.stringify(k)}: names must not contain "{", "}" or "."`);
        continue;
      }
      walk(node[k], [...path, k], ownType ?? inherited);
    }
  };

  walk(doc, [], undefined);
  return { tokens, diagnostics };
}
