// material-web tokens/versions/v0_192/*.scss → DTCG 2025.10 YAML. Parses the generated SCSS as text; never executes it.
import { readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { Document, isMap, isScalar, visit } from "yaml";
import type { TokenType } from "../src/tokens/values";

type Entry = { alias?: string; literal?: string };

/** Split on commas at paren depth 0. */
function splitTop(body: string): string[] {
  const out: string[] = [];
  let depth = 0, quote = "", start = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i]!;
    if (quote) { if (c === quote) quote = ""; continue; }
    if (c === "'" || c === '"') quote = c;
    else if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "," && depth === 0) { out.push(body.slice(start, i)); start = i + 1; }
  }
  out.push(body.slice(start));
  return out.map((s) => s.trim()).filter(Boolean);
}

const nsToPath = (ns: string) => ns.replace(/^md-(ref|sys|comp)-/, "md.$1.");

/** `@function name(...) { @return ( 'key': value, ... ); }` blocks → entries per function. */
export function parseScssTokens(scss: string): Record<string, Record<string, Entry>> {
  const out: Record<string, Record<string, Entry>> = {};
  for (const m of scss.matchAll(/@function ([\w-]+)\([^)]*\)\s*\{\s*@return\s*\(([\s\S]*?)\n\s*\);\s*\}/g)) {
    const entries: Record<string, Entry> = {};
    for (const raw of splitTop(m[2]!)) {
      const kv = /^'([^']+)'\s*:\s*([\s\S]*)$/.exec(raw);
      if (!kv) continue;
      const value = kv[2]!.replace(/\s+/g, " ").trim();
      if (value.startsWith("(")) continue; // composite map (e.g. typescale font shorthand)
      const alias = /^map\.get\(\$deps, '([a-z0-9-]+)', '([a-z0-9-]+)'\)$/.exec(value);
      const literal = /^if\( ?\$exclude-hardcoded-values, null, (.+?) ?\)$/.exec(value);
      if (alias) entries[kv[1]!] = { alias: `${nsToPath(alias[1]!)}.${alias[2]}` };
      else if (literal) entries[kv[1]!] = { literal: literal[1]! };
    }
    out[m[1]!] = entries;
  }
  return out;
}

export function inferType(key: string, literal: string): TokenType | null {
  if (/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(literal)) return "color";
  if (/^-?[\d.]+(px|rem)$/.test(literal)) return "dimension";
  if (/^-?[\d.]+$/.test(literal)) return key.includes("weight") ? "fontWeight" : "number";
  if (/^'[^']+'$|^"[^"]+"$/.test(literal)) return "fontFamily";
  const ident = /^\(?([A-Za-z][\w -]*)\)?$/.exec(literal);
  if (ident && !/\d+px/.test(literal) && (key === "brand" || key === "plain" || key.endsWith("font"))) return "fontFamily";
  return null;
}

function literalValue(type: TokenType, lit: string): unknown {
  switch (type) {
    case "color": {
      let hex = lit.toLowerCase();
      if (hex.length === 4) hex = `#${[...hex.slice(1)].map((c) => c + c).join("")}`;
      const comps = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
      return { colorSpace: "srgb", components: comps, hex };
    }
    case "dimension": {
      const m = /^(-?[\d.]+)(px|rem)$/.exec(lit)!;
      return { value: parseFloat(m[1]!), unit: m[2] };
    }
    case "fontFamily":
      return lit.replace(/^\(|\)$/g, "").replace(/^['"]|['"]$/g, "");
    default:
      return parseFloat(lit);
  }
}

const OUTPUT: Record<string, (fn: string) => string | null> = {
  "md-ref-palette": () => "ref.tokens.yaml",
  "md-ref-typeface": () => "ref.tokens.yaml",
  "md-sys-color": (fn) => (fn === "values-light" ? "sys-color-light.tokens.yaml" : fn === "values-dark" ? "sys-color-dark.tokens.yaml" : null),
};
const outputFor = (ns: string, fn: string): string | null =>
  OUTPUT[ns]?.(fn) ?? (ns.startsWith("md-sys-") ? (fn === "values" ? "sys.tokens.yaml" : null) : ns.startsWith("md-comp-") ? (fn === "values" ? "comp.tokens.yaml" : null) : null);

function setPath(root: Record<string, unknown>, path: string, value: unknown) {
  const segs = path.split(".");
  let node = root;
  for (const s of segs.slice(0, -1)) node = (node[s] ??= {}) as Record<string, unknown>;
  node[segs[segs.length - 1]!] = value;
}

export function convert(files: Record<string, string>): { outputs: Record<string, object>; skipped: string[] } {
  const skipped: string[] = [];
  // keyed by file + path: light/dark color files share token paths
  type T = { file: string; path: string; token: Record<string, unknown>; alias?: string };
  const tokens = new Map<string, T>();
  const put = (t: T) => tokens.set(`${t.file}|${t.path}`, t);
  const byPath = (path: string) => [...tokens.values()].find((t) => t.path === path);
  for (const [name, scss] of Object.entries(files)) {
    const ns = /^_?(md-(?:ref|sys|comp)-.+)\.scss$/.exec(basename(name))?.[1];
    if (!ns) continue;
    for (const [fn, entries] of Object.entries(parseScssTokens(scss))) {
      const file = outputFor(ns, fn);
      if (!file) continue;
      for (const [key, e] of Object.entries(entries)) {
        const path = `${nsToPath(ns)}.${key}`;
        if (e.alias) {
          put({ file, path, token: { $value: `{${e.alias}}` }, alias: e.alias });
          continue;
        }
        const type = inferType(key, e.literal!);
        if (!type) {
          skipped.push(`${path}: unsupported literal ${e.literal}`);
          continue;
        }
        put({ file, path, token: { $type: type, $value: literalValue(type, e.literal!) } });
      }
    }
  }

  // Typescale composites: md.sys.typescale.<style> from its -font/-size/-weight/-line-height/-tracking parts.
  for (const { path } of [...tokens.values()]) {
    const m = /^md\.sys\.typescale\.(.+)-font$/.exec(path);
    if (!m) continue;
    const base = `md.sys.typescale.${m[1]}`;
    const size = byPath(`${base}-size`)?.token.$value as { value: number; unit: string } | undefined;
    const lh = byPath(`${base}-line-height`)?.token.$value as { value: number; unit: string } | undefined;
    if (!size?.value || !lh?.value || size.unit !== lh.unit || !byPath(`${base}-weight`) || !byPath(`${base}-tracking`)) {
      skipped.push(`${base}: cannot synthesize typography (missing or aliased parts)`);
      continue;
    }
    put({
      file: "sys.tokens.yaml",
      path: base,
      token: {
        $type: "typography",
        $value: { fontFamily: `{${base}-font}`, fontSize: `{${base}-size}`, fontWeight: `{${base}-weight}`, letterSpacing: `{${base}-tracking}`, lineHeight: lh.value / size.value },
      },
    });
  }

  // Drop aliases whose targets did not survive, until stable.
  for (let changed = true; changed;) {
    changed = false;
    const paths = new Set([...tokens.values()].map((t) => t.path));
    for (const [k, t] of tokens) {
      if (t.alias && !paths.has(t.alias)) {
        tokens.delete(k);
        skipped.push(`${t.path}: alias target ${t.alias} not converted`);
        changed = true;
      }
    }
  }

  const outputs: Record<string, Record<string, unknown>> = {};
  for (const { file, path, token } of tokens.values()) setPath((outputs[file] ??= {}), path, token);
  return { outputs, skipped };
}

function toYaml(obj: object, header: string): string {
  const doc = new Document(obj);
  doc.commentBefore = header;
  visit(doc, {
    Map(_, node) {
      if (node.items.some((p) => isScalar(p.key) && p.key.value === "$value")) node.flow = true;
    },
  });
  return doc.toString({ lineWidth: 0 });
}

if (import.meta.main) {
  const [srcDir, outDir, sha] = process.argv.slice(2);
  if (!srcDir || !outDir || !sha) {
    console.error("usage: bun scripts/material-web-tokens.ts <srcDir> <outDir> <sha>");
    process.exit(2);
  }
  const files: Record<string, string> = {};
  for (const f of await readdir(srcDir)) if (f.endsWith(".scss")) files[f] = await readFile(join(srcDir, f), "utf8");
  const { outputs, skipped } = convert(files);
  const header = ` generated by scripts/material-web-tokens.ts from material-web@${sha} tokens/versions/v0_192 — do not edit`;
  for (const [name, obj] of Object.entries(outputs)) await writeFile(join(outDir, name), toYaml(obj, header));
  console.error(`wrote ${Object.keys(outputs).join(", ")}; skipped ${skipped.length}:`);
  for (const s of skipped) console.error(`  ${s}`);
}
