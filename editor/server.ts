import { existsSync, lstatSync, realpathSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve, sep } from "node:path";
import { fsIO } from "../src/fs-io";
import index from "./index.html";

/** Absolute path for a project-relative `.yaml` path, or null if it could escape the root. */
export function safePath(root: string, rel: string): string | null {
  if (!rel || rel.includes("\0") || isAbsolute(rel) || !rel.endsWith(".yaml")) return null;
  const rootReal = realpathSync(root);
  const abs = resolve(rootReal, rel);
  if (!abs.startsWith(rootReal + sep)) return null;
  const inside = (p: string) => p === rootReal || p.startsWith(rootReal + sep);
  // Walk every existing component (leaf included): a symlink must resolve inside the root;
  // a dangling symlink is rejected because writing through it would create its (outside) target.
  let p = rootReal;
  for (const seg of abs.slice(rootReal.length + 1).split(sep)) {
    p = `${p}${sep}${seg}`;
    let isLink: boolean;
    try {
      isLink = lstatSync(p).isSymbolicLink();
    } catch {
      break; // does not exist: nothing below it exists either
    }
    if (!isLink) continue;
    let target: string;
    try {
      target = realpathSync(p);
    } catch {
      return null; // dangling
    }
    if (!inside(target)) return null;
  }
  return abs;
}

/** DNS-rebinding guard: only our own loopback origin may call the API. */
export const allowedHost = (host: string | null, port: number): boolean =>
  host === `127.0.0.1:${port}` || host === `localhost:${port}`;

export function startServer(opts: { root: string; port: number }) {
  const io = fsIO(opts.root);
  const guard = (req: Request): Response | null =>
    allowedHost(req.headers.get("host"), server.port!) ? null : new Response("forbidden host", { status: 403 });
  const target = (req: Request): string | null => safePath(opts.root, new URL(req.url).searchParams.get("path") ?? "");

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: opts.port,
    development: process.env.NODE_ENV !== "production",
    routes: {
      "/": index,
      "/api/files": {
        GET: async (req) => guard(req) ?? Response.json({ files: await io.list() }),
      },
      "/api/file": {
        GET: async (req) => {
          const denied = guard(req);
          if (denied) return denied;
          const abs = target(req);
          if (!abs) return new Response("bad path", { status: 400 });
          const file = Bun.file(abs);
          return (await file.exists()) ? new Response(file, { headers: { "content-type": "text/plain; charset=utf-8" } }) : new Response("not found", { status: 404 });
        },
        PUT: async (req) => {
          const denied = guard(req);
          if (denied) return denied;
          const abs = target(req);
          if (!abs) return new Response("bad path", { status: 400 });
          await mkdir(dirname(abs), { recursive: true });
          await writeFile(abs, await req.text(), "utf8");
          return new Response(null, { status: 204 });
        },
      },
    },
  });
  return server;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const portAt = args.indexOf("--port");
  const port = portAt >= 0 ? Number(args[portAt + 1]) : 4173;
  const root = args.find((a, i) => !a.startsWith("--") && (portAt < 0 || i !== portAt + 1)) ?? ".";
  if (!existsSync(resolve(root, "openui.yaml"))) {
    console.error(`no openui.yaml in ${root}`);
    process.exit(1);
  }
  const server = startServer({ root, port });
  console.log(`openui editor → http://127.0.0.1:${server.port}  (project: ${root})`);
}
