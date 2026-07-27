import {
  mkdir,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

function publicRun(run) {
  return {
    id: run.id,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt || run.createdAt,
    finishedAt: run.finishedAt || null,
    state: run.state,
    stage: run.stage,
    plan: run.plan,
    steps: run.steps || {},
    verification: run.verification || null,
    completion: run.completion || null,
    error: run.error || null,
  };
}

export class RunStore {
  constructor({ file = null } = {}) {
    this.file = file;
    this.runs = new Map();
    this.writeChain = Promise.resolve();
  }

  async load() {
    if (!this.file) return this;
    try {
      const values = JSON.parse(await readFile(this.file, "utf8"));
      for (const value of Array.isArray(values) ? values : []) {
        const interrupted = ["executing", "awaiting_approval"].includes(
          value.state,
        );
        this.runs.set(value.id, {
          ...value,
          state: interrupted ? "failed" : value.state,
          stage: interrupted ? "Interrupted" : value.stage,
          error: interrupted
            ? "Bolo restarted before this task completed."
            : value.error,
          finishedAt: interrupted ? Date.now() : value.finishedAt,
          abortController: new AbortController(),
          cancelled: false,
        });
      }
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw new Error(`Could not load run history: ${error.message}`);
      }
    }
    return this;
  }

  get size() {
    return this.runs.size;
  }

  get(id) {
    return this.runs.get(id);
  }

  set(id, run) {
    this.runs.set(id, run);
    this.persist();
    return this;
  }

  touch(id) {
    const run = this.runs.get(id);
    if (run) {
      run.updatedAt = Date.now();
      this.persist();
    }
  }

  delete(id) {
    const deleted = this.runs.delete(id);
    if (deleted) this.persist();
    return deleted;
  }

  [Symbol.iterator]() {
    return this.runs[Symbol.iterator]();
  }

  persist() {
    if (!this.file) return;
    this.writeChain = this.writeChain
      .catch(() => {})
      .then(async () => {
        await mkdir(path.dirname(this.file), { recursive: true });
        const temporary = `${this.file}.tmp`;
        const body = JSON.stringify(
          [...this.runs.values()].map(publicRun),
          null,
          2,
        );
        await writeFile(temporary, body, { mode: 0o600 });
        await rename(temporary, this.file);
      });
  }

  async close() {
    await this.writeChain;
  }
}
