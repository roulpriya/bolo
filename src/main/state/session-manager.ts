import type { TurnExecution } from "../agent/turn-execution.ts";
import { ModelHistorySession } from "./model-history-session.ts";
import type { ThreadRepository } from "./thread-repository.ts";

export interface PendingAnswer {
  questionId: string;
  reject: (error: unknown) => void;
  resolve: (answer: string) => void;
}

export interface ThreadSession {
  execution: TurnExecution | null;
  id: string;
  modelHistory: ModelHistorySession;
  pendingAnswer: PendingAnswer | null;
  threadId: string;
  work: Promise<void> | null;
}

export class SessionManager {
  private readonly sessions = new Map<string, ThreadSession>();

  private readonly repository: ThreadRepository;

  constructor(repository: ThreadRepository) {
    this.repository = repository;
  }

  get(threadId: string): ThreadSession {
    let session = this.sessions.get(threadId);
    if (!session) {
      for (const [id, idle] of this.sessions) {
        if (!(idle.execution || idle.work)) {
          this.sessions.delete(id);
        }
      }
      session = {
        execution: null,
        id: crypto.randomUUID(),
        modelHistory: new ModelHistorySession(threadId, this.repository),
        pendingAnswer: null,
        threadId,
        work: null,
      };
      this.sessions.set(threadId, session);
    }
    return session;
  }

  active(): ThreadSession | undefined {
    // A cancelled turn retains its lease until its tools and SDK writes settle.
    return [...this.sessions.values()].find(
      (session) => session.execution !== null
    );
  }

  async close(): Promise<void> {
    await Promise.all(
      [...this.sessions.values()].map(async (session) => {
        await session.work;
        await session.modelHistory.flush();
      })
    );
    this.sessions.clear();
  }
}
