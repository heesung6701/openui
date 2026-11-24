/** Where the editor reads and saves YAML: the local dev server, a bundled example (static Pages build), or a local folder. */
export type EditorIO = {
  kind: "server" | "bundle" | "folder";
  label: string;
  list(): Promise<string[]>;
  read(path: string): Promise<string>;
  /** "downloaded" when the target cannot be written in place (bundled examples). */
  write(path: string, text: string): Promise<"saved" | "downloaded">;
};

export type BundledProject = { name: string; title: string; files: Record<string, string> };

export const serverIO: EditorIO = {
  kind: "server",
  label: "local server",
  list: async () => ((await (await fetch("/api/files")).json()) as { files: string[] }).files,
  read: async (p) => {
    const res = await fetch(`/api/file?path=${encodeURIComponent(p)}`);
    if (!res.ok) throw new Error(`cannot read ${p} (${res.status})`); // never load an error body as file content
    return res.text();
  },
  write: async (p, text) => {
    const res = await fetch(`/api/file?path=${encodeURIComponent(p)}`, { method: "PUT", body: text });
    if (!res.ok) throw new Error(`save failed (${res.status})`);
    return "saved";
  },
};

function download(path: string, text: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/yaml" }));
  a.download = path.split("/").pop()!;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 0);
}

export function bundleIO(p: BundledProject): EditorIO {
  return {
    kind: "bundle",
    label: p.title,
    list: async () => Object.keys(p.files).sort(),
    read: async (f) => p.files[f] ?? "",
    write: async (f, text) => {
      p.files[f] = text;
      download(f, text);
      return "downloaded";
    },
  };
}

export const canOpenFolder = (): boolean => "showDirectoryPicker" in window;

// Minimal File System Access API surface (Chromium); not in TS's DOM lib.
type FileHandle = { kind: "file"; getFile(): Promise<File>; createWritable(): Promise<{ write(t: string): Promise<void>; close(): Promise<void> }> };
type DirHandle = { kind: "directory"; name: string; entries(): AsyncIterable<[string, FileHandle | DirHandle]> };

/** Pick a local folder containing openui.yaml; edits are written back in place. */
export async function folderIO(): Promise<EditorIO> {
  const dir = (await (window as unknown as { showDirectoryPicker(o: object): Promise<DirHandle> }).showDirectoryPicker({ mode: "readwrite" }));
  const files = new Map<string, FileHandle>();
  const walk = async (d: DirHandle, prefix: string) => {
    for await (const [name, h] of d.entries()) {
      if (name.startsWith(".") || name === "node_modules") continue;
      if (h.kind === "directory") await walk(h, `${prefix}${name}/`);
      else if (name.endsWith(".yaml")) files.set(prefix + name, h);
    }
  };
  await walk(dir, "");
  if (!files.has("openui.yaml")) throw new Error(`no openui.yaml in "${dir.name}"`);
  return {
    kind: "folder",
    label: dir.name,
    list: async () => [...files.keys()].sort(),
    read: async (p) => (await files.get(p)!.getFile()).text(),
    write: async (p, text) => {
      const w = await files.get(p)!.createWritable();
      await w.write(text);
      await w.close();
      return "saved";
    },
  };
}

/** Static build ships projects.json; the dev server does not. */
export async function bundledProjects(): Promise<BundledProject[] | null> {
  try {
    const res = await fetch("./projects.json", { cache: "no-cache" }); // revalidate: Pages serves max-age=600
    return res.ok ? ((await res.json()) as { projects: BundledProject[] }).projects : null;
  } catch {
    return null;
  }
}
