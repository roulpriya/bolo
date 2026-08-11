import {
  lstat,
  mkdir,
  readFile,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

const MAX_LINES = 2000;
const MAX_LINE_LENGTH = 2000;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const SENSITIVE_FILE_PATTERN =
  /^(?:id_rsa|id_ed25519|credentials(?:\.json)?)$/i;
const noop = () => undefined;

function checkAbort(signal) {
  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
}

function isSensitivePath(filePath) {
  const name = path.basename(filePath).toLowerCase();
  return (
    ((name === ".env" || name.startsWith(".env.")) &&
      name !== ".env.example") ||
    SENSITIVE_FILE_PATTERN.test(name)
  );
}

/** Pi-style file tools, scoped to the agent workspace. */
export class LocalFiles {
  constructor({ cwd, signal, onActivity = noop }) {
    this.cwd = path.resolve(cwd);
    this.signal = signal;
    this.onActivity = onActivity;
    this.rootPromise = realpath(this.cwd);
  }

  async read({ filePath, offset = 1, limit = MAX_LINES }) {
    checkAbort(this.signal);
    const target = await this.existingPath(filePath);
    this.onActivity("Reading a workspace file");
    const info = await stat(target);
    if (!info.isFile()) {
      throw new Error("read only accepts regular files.");
    }
    if (info.size > MAX_FILE_BYTES) {
      throw new Error(
        `File is too large to read (${info.size} bytes; limit is ${MAX_FILE_BYTES}).`
      );
    }
    const contents = await readFile(target, {
      encoding: "utf8",
      signal: this.signal,
    });
    if (contents.includes("\0")) {
      throw new Error("read only accepts text files.");
    }
    const lines = contents.split("\n");
    const start = Math.max(1, Math.floor(Number(offset) || 1));
    const count = Math.min(
      MAX_LINES,
      Math.max(1, Math.floor(Number(limit) || MAX_LINES))
    );
    const selected = lines.slice(start - 1, start - 1 + count);
    return {
      content: selected
        .map((line, index) => {
          const clipped = line.length > MAX_LINE_LENGTH;
          return `${String(start + index).padStart(5, " ")} | ${line.slice(0, MAX_LINE_LENGTH)}${clipped ? "…" : ""}`;
        })
        .join("\n"),
      lineEnd: start + selected.length - 1,
      lineStart: start,
      path: this.displayPath(target),
      totalLines: lines.length,
      truncated: start - 1 + selected.length < lines.length,
    };
  }

  async write({ filePath, content }) {
    checkAbort(this.signal);
    const target = await this.writablePath(filePath);
    this.onActivity("Writing a workspace file");
    await mkdir(path.dirname(target), { recursive: true });
    checkAbort(this.signal);
    await writeFile(target, content, { encoding: "utf8", signal: this.signal });
    return {
      bytesWritten: Buffer.byteLength(content),
      path: this.displayPath(target),
    };
  }

  async edit({ filePath, oldText, newText }) {
    checkAbort(this.signal);
    const target = await this.existingPath(filePath);
    this.onActivity("Editing a workspace file");
    const info = await stat(target);
    if (!info.isFile()) {
      throw new Error("edit only accepts regular files.");
    }
    if (info.size > MAX_FILE_BYTES) {
      throw new Error("File is too large to edit safely.");
    }
    const content = await readFile(target, {
      encoding: "utf8",
      signal: this.signal,
    });
    if (content.includes("\0")) {
      throw new Error("edit only accepts text files.");
    }
    const first = content.indexOf(oldText);
    if (first === -1) {
      throw new Error("oldText was not found in the file.");
    }
    if (content.indexOf(oldText, first + oldText.length) !== -1) {
      throw new Error(
        "oldText appears more than once; provide a unique exact match."
      );
    }
    await writeFile(target, content.replace(oldText, newText), {
      encoding: "utf8",
      signal: this.signal,
    });
    return { path: this.displayPath(target), replacements: 1 };
  }

  async existingPath(filePath) {
    const candidate = await this.lexicalPath(filePath);
    const resolved = await realpath(candidate);
    await this.assertInsideRoot(resolved);
    if (isSensitivePath(resolved)) {
      throw new Error("Access to credential files is blocked.");
    }
    return resolved;
  }

  async writablePath(filePath) {
    const candidate = await this.lexicalPath(filePath);
    if (isSensitivePath(candidate)) {
      throw new Error("Access to credential files is blocked.");
    }
    try {
      const details = await lstat(candidate);
      if (details.isSymbolicLink()) {
        throw new Error("Writing through symbolic links is not allowed.");
      }
      const resolved = await realpath(candidate);
      await this.assertInsideRoot(resolved);
      return resolved;
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
    let ancestor = path.dirname(candidate);
    while (ancestor !== path.dirname(ancestor)) {
      try {
        // biome-ignore lint/performance/noAwaitInLoops: Each parent must be resolved in order until the nearest existing ancestor is found.
        const resolvedAncestor = await realpath(ancestor);
        await this.assertInsideRoot(resolvedAncestor, { allowRoot: true });
        return candidate;
      } catch (error) {
        if (error.code !== "ENOENT") {
          throw error;
        }
        ancestor = path.dirname(ancestor);
      }
    }
    throw new Error("The file path is outside the workspace.");
  }

  lexicalPath(filePath) {
    if (typeof filePath !== "string" || !filePath.trim()) {
      throw new Error("A file path is required.");
    }
    const candidate = path.resolve(this.cwd, filePath);
    const relative = path.relative(this.cwd, candidate);
    if (
      relative === "" ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      throw new Error("The file path must be inside the workspace.");
    }
    return candidate;
  }

  async assertInsideRoot(candidate, { allowRoot = false } = {}) {
    const root = await this.rootPromise;
    const relative = path.relative(root, candidate);
    if (
      (!allowRoot && relative === "") ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      throw new Error("The file path must be inside the workspace.");
    }
  }

  displayPath(absolutePath) {
    return path.relative(this.cwd, absolutePath) || ".";
  }
}
