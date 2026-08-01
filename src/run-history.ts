import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export class RunHistory {
  constructor({ file = null } = {}) {
    this.file = file;
    this.items = new Map();
    this.pendingWrite = Promise.resolve();
  }

  async load() {
    if (!this.file) return;
    try {
      const stored = JSON.parse(await readFile(this.file, "utf8"));
      for (const run of Array.isArray(stored) ? stored : []) {
        if (!run?.id) continue;
        if (["running", "waiting_for_user"].includes(run.state)) {
          run.state = "failed";
          run.error = "Bolo restarted before this task finished.";
          run.finishedAt = Date.now();
        }
        this.items.set(run.id, run);
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }

  get(id) {
    return this.items.get(id) || null;
  }

  set(run) {
    this.items.set(run.id, structuredClone(run));
    if (this.file) {
      this.pendingWrite = this.pendingWrite
        .catch(() => {})
        .then(() => this.persist());
    }
  }

  async persist() {
    await mkdir(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.tmp`;
    const recent = [...this.items.values()].slice(-100);
    await writeFile(temporary, JSON.stringify(recent, null, 2), {
      mode: 0o600,
    });
    await rename(temporary, this.file);
  }

  async close() {
    await this.pendingWrite;
  }
}
