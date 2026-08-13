import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

type HistoryRecord = {
  id: string;
  state?: unknown;
  error?: unknown;
  finishedAt?: unknown;
} & Record<string, unknown>;

export class RunHistory<T extends HistoryRecord = HistoryRecord> {
  file: string | null;
  items: Map<string, T>;
  pendingWrite: Promise<void>;

  constructor({ file = null }: { file?: string | null } = {}) {
    this.file = file;
    this.items = new Map();
    this.pendingWrite = Promise.resolve();
  }

  async load() {
    const { file } = this;
    if (!file) {
      return;
    }
    try {
      const stored: unknown = JSON.parse(await readFile(file, "utf8"));
      for (const run of Array.isArray(stored) ? (stored as T[]) : []) {
        if (!run.id) {
          continue;
        }
        if (["running", "waiting_for_user"].includes(String(run.state))) {
          run.state = "failed";
          run.error = "Bolo restarted before this task finished.";
          run.finishedAt = Date.now();
        }
        this.items.set(run.id, run);
      }
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
  }

  get(id: string) {
    return this.items.get(id) || null;
  }

  set(run: T) {
    this.items.set(run.id, structuredClone(run));
    if (this.file) {
      this.pendingWrite = this.pendingWrite
        .catch(() => undefined)
        .then(() => this.persist());
    }
  }

  async persist() {
    const { file } = this;
    if (!file) {
      return;
    }
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.tmp`;
    const recent = [...this.items.values()].slice(-100);
    await writeFile(temporary, JSON.stringify(recent, null, 2), {
      mode: 0o600,
    });
    await rename(temporary, file);
  }

  async close() {
    await this.pendingWrite;
  }
}
