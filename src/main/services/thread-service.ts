import type {
  LegacyChat,
  Thread,
  ThreadSummary,
} from "../../shared/threads.ts";
import {
  importLegacyChat,
  migrateLegacyHistory,
} from "../state/legacy-history.ts";
import type { ThreadRepository } from "../state/thread-repository.ts";

export class ThreadService {
  readonly repository: ThreadRepository;
  private selectedThreadId: string | null = null;
  private pendingSelection = Promise.resolve();
  private initialization: Promise<void> | null = null;

  constructor(repository: ThreadRepository) {
    this.repository = repository;
  }

  initialize(): Promise<void> {
    this.initialization ??= this.serialize(async () => {
      await this.repository.load();
      await migrateLegacyHistory(this.repository);
    });
    return this.initialization;
  }

  private serialize<T>(operation: () => T | Promise<T>): Promise<T> {
    const result = this.pendingSelection.then(operation);
    this.pendingSelection = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  private async createSelected(): Promise<Thread> {
    const thread = this.repository.create();
    await this.repository.flush();
    this.selectedThreadId = thread.id;
    return thread;
  }

  create(): Promise<Thread> {
    return this.serialize(() => this.createSelected());
  }

  select(id: string): Promise<Thread> {
    return this.serialize(() => {
      const thread = this.get(id);
      this.selectedThreadId = thread.id;
      return thread;
    });
  }

  list(): ThreadSummary[] {
    return this.repository.list();
  }

  get(id: string): Thread {
    return this.repository.get(id);
  }

  restore(options: { legacyChat?: LegacyChat } = {}): Promise<Thread> {
    return this.serialize(async () => {
      if (options.legacyChat) {
        await importLegacyChat(this.repository, options.legacyChat);
      }
      return this.selectedThreadId
        ? this.get(this.selectedThreadId)
        : this.createSelected();
    });
  }
}
