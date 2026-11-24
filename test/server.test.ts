import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { allowedHost, safePath, startServer } from "../editor/server";

const tmp = (p: string) => realpathSync(mkdtempSync(join(tmpdir(), p)));

test("safePath", () => {
  const root = tmp("ou-");
  mkdirSync(join(root, "components"));
  expect(safePath(root, "components/a.yaml")).toBe(join(root, "components/a.yaml"));
  for (const bad of ["../x.yaml", "/etc/passwd", "a.txt", "components/../../x.yaml", "a\0.yaml", ""]) expect(safePath(root, bad)).toBeNull();
  const outside = tmp("ou-out-");
  symlinkSync(outside, join(root, "link"));
  expect(safePath(root, "link/a.yaml")).toBeNull();
});
test("I1: dangling symlinks (leaf or directory) cannot redirect writes outside the root", () => {
  const root = tmp("ou-");
  const outside = tmp("ou-out-");
  mkdirSync(join(root, "components"));
  symlinkSync(join(outside, "pwned.yaml"), join(root, "components/x.yaml")); // target does not exist yet
  symlinkSync(join(outside, "nope"), join(root, "gone"));
  expect(safePath(root, "components/x.yaml")).toBeNull();
  expect(safePath(root, "gone/a.yaml")).toBeNull();
  writeFileSync(join(root, "components/real.yaml"), "a: 1\n");
  symlinkSync(join(root, "components/real.yaml"), join(root, "components/alias.yaml")); // stays inside: allowed
  expect(safePath(root, "components/alias.yaml")).toBe(join(root, "components/alias.yaml"));
});
test("allowedHost", () => {
  expect(allowedHost("127.0.0.1:4173", 4173)).toBe(true);
  expect(allowedHost("localhost:4173", 4173)).toBe(true);
  expect(allowedHost("evil.com:4173", 4173)).toBe(false);
  expect(allowedHost("127.0.0.1:9999", 4173)).toBe(false);
  expect(allowedHost(null, 4173)).toBe(false);
});
test("file API round trip", async () => {
  const root = tmp("ou-");
  writeFileSync(join(root, "openui.yaml"), 'openui: "0.1"\n');
  const server = startServer({ root, port: 0 });
  try {
    const base = `http://127.0.0.1:${server.port}`;
    expect((await (await fetch(`${base}/api/files`)).json()).files).toEqual(["openui.yaml"]);
    expect(await (await fetch(`${base}/api/file?path=openui.yaml`)).text()).toBe('openui: "0.1"\n');
    expect((await fetch(`${base}/api/file?path=openui.yaml`, { method: "PUT", body: "x: 1\n" })).status).toBe(204);
    expect(readFileSync(join(root, "openui.yaml"), "utf8")).toBe("x: 1\n");
    expect((await fetch(`${base}/api/file?path=..%2Fx.yaml`, { method: "PUT", body: "" })).status).toBe(400);
    expect((await fetch(`${base}/api/file?path=%2e%2e/x.yaml`)).status).toBe(400);
  } finally {
    server.stop(true);
  }
});
