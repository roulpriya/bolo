import {
  type AgentInputItem,
  MemorySession,
  type Session,
} from "@openai/agents";
import type { ThreadRepository } from "./thread-repository.ts";

/** SDK adapter; model history is persisted by the thread repository. */
export class ModelHistorySession implements Session {
  private readonly memory: MemorySession;
  private pending = Promise.resolve();

  private readonly threadId: string;
  private readonly repository: ThreadRepository;

  constructor(threadId: string, repository: ThreadRepository) {
    this.threadId = threadId;
    this.repository = repository;
    this.memory = new MemorySession({
      initialItems: repository.getContext(threadId),
      sessionId: threadId,
    });
  }

  getSessionId(): Promise<string> {
    return Promise.resolve(this.threadId);
  }

  async getItems(limit?: number): Promise<AgentInputItem[]> {
    await this.pending;
    return this.memory.getItems(limit);
  }

  private update<T>(change: () => Promise<T>): Promise<T> {
    const operation = this.pending.then(async () => {
      const result = await change();
      await this.repository.setContext(
        this.threadId,
        await this.memory.getItems()
      );
      return result;
    });
    this.pending = operation.then(
      () => undefined,
      () => undefined
    );
    return operation;
  }

  addItems(items: AgentInputItem[]) {
    return this.update(() => this.memory.addItems(items));
  }

  popItem() {
    return this.update(() => this.memory.popItem());
  }

  clearSession() {
    return this.update(() => this.memory.clearSession());
  }

  async flush(): Promise<void> {
    await this.pending;
  }
}
