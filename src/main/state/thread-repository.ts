import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentInputItem } from "@openai/agents";
import { z } from "zod";
import {
  entityId,
  isTerminalTurn,
  summarizeThread,
  type Thread,
  type Turn,
  threadSchema,
  turnSchema,
} from "../../shared/threads.ts";

export const contextItem = z.custom<AgentInputItem>(
  (value) =>
    typeof value === "object" &&
    value !== null &&
    (("role" in value && typeof value.role === "string") ||
      ("type" in value && typeof value.type === "string"))
);
const storedThread = z.object({
  context: z.array(contextItem),
  legacySources: z.array(z.string()).default([]),
  thread: threadSchema,
  version: z.literal(1),
});
type StoredThread = z.infer<typeof storedThread>;

export function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export async function readOptionalJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (isMissingFile(error)) {
      return null;
    }
    throw error;
  }
}

export async function optionalDirectory(directory: string): Promise<string[]> {
  try {
    return await readdir(directory);
  } catch (error) {
    if (isMissingFile(error)) {
      return [];
    }
    throw error;
  }
}

/** One atomic document holds a thread's public turns and private model context. */
export class ThreadRepository {
  private readonly records = new Map<string, StoredThread>();
  private pendingWrite = Promise.resolve();

  readonly directory: string | null;

  constructor(directory: string | null = null) {
    this.directory = directory;
  }

  async load(): Promise<void> {
    if (!this.directory) {
      return;
    }
    const directory = path.join(this.directory, "threads");
    const files = await optionalDirectory(directory);
    for (const file of files) {
      if (
        !(
          file.endsWith(".json") &&
          entityId.safeParse(file.slice(0, -5)).success
        )
      ) {
        continue;
      }
      const record = storedThread.parse(
        // biome-ignore lint/performance/noAwaitInLoops: Restore and validate one independent thread at a time.
        await readOptionalJson(path.join(directory, file))
      );
      if (
        record.thread.id !== file.slice(0, -5) ||
        record.thread.turns.some((turn) => turn.threadId !== record.thread.id)
      ) {
        throw new Error("Saved thread ownership is invalid.");
      }
      if (
        new Set(record.thread.turns.map((turn) => turn.id)).size !==
        record.thread.turns.length
      ) {
        throw new Error("Saved thread contains duplicate turns.");
      }
      this.records.set(record.thread.id, record);
      this.recoverInterrupted(record.thread);
    }
    await this.flush();
  }

  private recoverInterrupted(thread: Thread): void {
    for (const turn of thread.turns) {
      if (isTerminalTurn(turn.state)) {
        continue;
      }
      turn.state = "failed";
      turn.error = "Bolo restarted before this turn finished.";
      turn.progress = "Interrupted by restart";
      turn.finishedAt = Date.now();
      turn.currentTool = null;
      turn.pendingQuestion = null;
      turn.messages.push({
        id: crypto.randomUUID(),
        kind: "error",
        role: "assistant",
        text: turn.error,
      });
      for (const activity of turn.toolActivity) {
        if (activity.status === "running") {
          activity.status = "failed";
          activity.completedAt = turn.finishedAt;
          activity.output = turn.error;
        }
      }
      this.saveTurn(turn);
    }
  }

  has(id: string): boolean {
    return this.records.has(id);
  }

  private record(id: string): StoredThread {
    const record = this.records.get(entityId.parse(id));
    if (!record) {
      throw new Error("Thread not found.");
    }
    return record;
  }

  get(id: string): Thread {
    return structuredClone(this.record(id).thread);
  }

  list() {
    return [...this.records.values()]
      .map(({ thread }) => summarizeThread(thread))
      .sort((left, right) => right.updatedAt - left.updatedAt);
  }

  create(title = "New conversation", id: string = crypto.randomUUID()): Thread {
    entityId.parse(id);
    if (this.records.has(id)) {
      throw new Error("Thread already exists.");
    }
    const now = Date.now();
    const thread: Thread = {
      createdAt: now,
      id,
      revision: 0,
      title,
      turns: [],
      updatedAt: now,
    };
    this.records.set(id, {
      context: [],
      legacySources: [],
      thread,
      version: 1,
    });
    this.enqueue(id);
    return this.get(id);
  }

  getTurn(threadId: string, turnId: string): Turn {
    const turn = this.record(threadId).thread.turns.find(
      (item) => item.id === turnId
    );
    if (!turn) {
      throw new Error("Turn does not belong to this thread.");
    }
    return structuredClone(turn);
  }

  saveTurn(value: Turn): Thread {
    const turn = turnSchema.parse(value);
    const { thread } = this.record(turn.threadId);
    const index = thread.turns.findIndex((item) => item.id === turn.id);
    if (index < 0) {
      if (
        !isTerminalTurn(turn.state) &&
        thread.turns.some((item) => !isTerminalTurn(item.state))
      ) {
        throw new Error("This thread already has an active turn.");
      }
      if (!thread.turns.length && thread.title === "New conversation") {
        thread.title = turn.input.slice(0, 80);
      }
      thread.turns.push(turn);
    } else {
      thread.turns[index] = turn;
    }
    thread.revision += 1;
    thread.updatedAt = Date.now();
    this.enqueue(thread.id);
    return this.get(thread.id);
  }

  getContext(threadId: string): AgentInputItem[] {
    return structuredClone(this.record(threadId).context);
  }

  async setContext(threadId: string, items: AgentInputItem[]): Promise<void> {
    this.record(threadId).context = structuredClone(items);
    this.enqueue(threadId);
    await this.flush();
  }

  findLegacyThread(source: string): Thread | null {
    const record = [...this.records.values()].find((item) =>
      item.legacySources.includes(source)
    );
    return record ? structuredClone(record.thread) : null;
  }

  hasLegacySource(source: string): boolean {
    return this.findLegacyThread(source) !== null;
  }

  markLegacySource(threadId: string, source: string): void {
    this.record(threadId).legacySources.push(source);
    this.enqueue(threadId);
  }

  private enqueue(threadId: string): void {
    if (!this.directory) {
      return;
    }
    this.pendingWrite = this.pendingWrite
      .catch(() => undefined)
      .then(async () => {
        const directory = path.join(this.directory ?? "", "threads");
        await mkdir(directory, { mode: 0o700, recursive: true });
        const file = path.join(directory, `${threadId}.json`);
        await writeFile(`${file}.tmp`, JSON.stringify(this.record(threadId)), {
          mode: 0o600,
        });
        await rename(`${file}.tmp`, file);
      });
    // Event-driven checkpoints have no caller; flush() still reports write failures.
    this.pendingWrite.catch(() => undefined);
  }

  async flush(): Promise<void> {
    let checkpoint: Promise<void>;
    do {
      checkpoint = this.pendingWrite;
      // biome-ignore lint/performance/noAwaitInLoops: Drain writes queued while the previous checkpoint was in flight.
      await checkpoint;
    } while (checkpoint !== this.pendingWrite);
  }
}
