/** Project file access. Paths are posix, relative to the project root. Browser-safe: no node imports here. */
export type ProjectIO = { list(): Promise<string[]>; read(path: string): Promise<string> };

export function memoryIO(files: Record<string, string>): ProjectIO {
  return {
    list: async () => Object.keys(files).sort(),
    read: async (path) => {
      if (!Object.hasOwn(files, path)) throw new Error(`file not found: ${path}`);
      return files[path]!;
    },
  };
}

/** Resolve `rel` against the directory of `fromFile`, normalizing `.` and `..`. */
export function resolvePath(fromFile: string, rel: string): string {
  const out = fromFile.split("/").slice(0, -1);
  for (const seg of rel.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === ".." && out.length && out[out.length - 1] !== "..") out.pop();
    else out.push(seg);
  }
  return out.join("/");
}
