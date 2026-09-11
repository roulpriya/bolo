import type { Session } from "@openai/agents";
import {
  type AnswerQuestionInput,
  ipcArgs,
  type StartTurnInput,
} from "../../shared/ipc.ts";
import {
  createTurnRecord,
  isTerminalTurn,
  type ThreadEvent,
  type Turn,
} from "../../shared/threads.ts";
import { failOpenToolCalls } from "../agent/agent-service.ts";
import type { TurnExecution } from "../agent/turn-execution.ts";
import {
  SessionManager,
  type ThreadSession,
} from "../state/session-manager.ts";
import type { ThreadRepository } from "../state/thread-repository.ts";
import { normalizeLanguageCode } from "./sarvam.ts";
import { cleanText, safeError } from "./service-errors.ts";
import type { SpeechService } from "./speech-service.ts";

export interface AgentExecutor {
  browserAvailable: () => boolean;
  close: () => Promise<void>;
  execute: (
    execution: TurnExecution,
    askUser: (prompt: string, kind: string) => Promise<string>,
    onTextDelta: (delta: string) => void,
    session: Session
  ) => Promise<unknown>;
}

export class TurnCoordinator {
  readonly sessions: SessionManager;
  private readonly repository: ThreadRepository;
  private readonly agent: AgentExecutor;
  private readonly speech: SpeechService;
  private readonly onEvent: (event: ThreadEvent) => void;
  private closing = Boolean(false);

  constructor(
    repository: ThreadRepository,
    agent: AgentExecutor,
    speech: SpeechService,
    onEvent: (event: ThreadEvent) => void
  ) {
    this.repository = repository;
    this.agent = agent;
    this.speech = speech;
    this.onEvent = onEvent;
    this.sessions = new SessionManager(repository);
  }

  assertAvailable(): void {
    if (this.closing) {
      throw new Error("Bolo is shutting down.");
    }
    if (this.sessions.active()) {
      throw new Error("A turn is already running or stopping.");
    }
  }

  async start(
    input: StartTurnInput,
    options: { inputMode?: Turn["inputMode"]; languageCode?: string } = {}
  ) {
    const [{ threadId, text }] = ipcArgs.startTurn.parse([input]);
    this.assertAvailable();
    const session = this.sessions.get(threadId);
    let checkpointTimer: ReturnType<typeof setTimeout> | undefined;
    const execution: TurnExecution = {
      ...createTurnRecord(
        threadId,
        text,
        options.inputMode,
        normalizeLanguageCode(options.languageCode ?? "en-IN")
      ),
      abortController: new AbortController(),
      notify: () => {
        if (isTerminalTurn(execution.state) || checkpointTimer) {
          return;
        }
        checkpointTimer = setTimeout(() => {
          checkpointTimer = undefined;
          if (!isTerminalTurn(execution.state)) {
            this.publish(execution);
          }
        }, 50);
      },
    };
    session.execution = execution;
    this.publish(execution);
    // Reserve before awaiting storage, so simultaneous inputs cannot both start.
    session.work = this.execute(session, execution).finally(() => {
      clearTimeout(checkpointTimer);
      session.execution = null;
      session.work = null;
      // Publish the terminal event only once tools and history writes have settled.
      // Advance the revision so an earlier listing marked stopping cannot replace it.
      this.repository.saveTurn(execution);
      this.emit(execution);
    });
    session.work.catch(() => undefined);
    await this.repository.flush();
    return { threadId, turnId: execution.id };
  }

  private async execute(
    session: ThreadSession,
    execution: TurnExecution
  ): Promise<void> {
    try {
      await this.repository.flush();
      execution.abortController.signal.throwIfAborted();
      const result = await this.agent.execute(
        execution,
        (prompt, kind) => this.askQuestion(session, execution, prompt, kind),
        (delta) => {
          if (!isTerminalTurn(execution.state)) {
            execution.response += delta;
            execution.notify();
          }
        },
        session.modelHistory
      );
      execution.abortController.signal.throwIfAborted();
      execution.progress = "Preparing response";
      execution.notify();
      const response = await this.speech.localize(
        String(result || "The task is complete."),
        execution.languageCode
      );
      execution.abortController.signal.throwIfAborted();
      execution.result = response;
      execution.response = response;
      execution.state = "completed";
      execution.progress = "Complete";
      execution.messages.push({
        id: crypto.randomUUID(),
        kind: "result",
        role: "assistant",
        text: response,
      });
    } catch (error) {
      if (execution.state !== "cancelled") {
        failOpenToolCalls(execution, error);
        execution.state = "failed";
        execution.error = safeError(error);
        execution.progress = "Failed";
        execution.messages.push({
          id: crypto.randomUUID(),
          kind: "error",
          role: "assistant",
          text: execution.error,
        });
      }
    } finally {
      this.rejectAnswer(session);
      execution.pendingQuestion = null;
      execution.currentTool = null;
      execution.finishedAt ??= Date.now();
      this.publish(execution);
      await session.modelHistory.flush();
      try {
        await this.repository.flush();
      } catch (error) {
        if (execution.state !== "cancelled") {
          execution.state = "failed";
        }
        execution.error = `Could not save conversation history: ${safeError(error)}`;
        execution.progress = "History could not be saved";
        execution.messages.push({
          id: crypto.randomUUID(),
          kind: "error",
          role: "assistant",
          text: execution.error,
        });
        this.publish(execution);
        await this.repository.flush();
      }
    }
  }

  private publish(execution: TurnExecution): void {
    this.repository.saveTurn(execution);
    if (!isTerminalTurn(execution.state)) {
      this.emit(execution);
    }
  }

  private emit(execution: TurnExecution): void {
    const thread = this.repository.get(execution.threadId);
    this.onEvent({
      revision: thread.revision,
      thread,
      threadId: thread.id,
      turnId: execution.id,
      type: "thread.updated",
    });
  }

  private async askQuestion(
    session: ThreadSession,
    execution: TurnExecution,
    prompt: string,
    kind: string
  ): Promise<string> {
    execution.abortController.signal.throwIfAborted();
    if (session.pendingAnswer || execution.pendingQuestion) {
      throw new Error("This turn already has a pending question.");
    }
    // Reserve the question before translation, which can overlap a second tool call.
    const question = {
      id: crypto.randomUUID(),
      kind:
        kind === "confirmation"
          ? ("confirmation" as const)
          : ("input" as const),
      prompt: "",
    };
    execution.pendingQuestion = question;
    try {
      question.prompt = await this.speech.localize(
        cleanText(prompt, 600, "The agent asked an empty question."),
        execution.languageCode
      );
      execution.abortController.signal.throwIfAborted();
    } catch (error) {
      if (execution.pendingQuestion?.id === question.id) {
        execution.pendingQuestion = null;
      }
      throw error;
    }
    const answer = new Promise<string>((resolve, reject) => {
      session.pendingAnswer = { questionId: question.id, reject, resolve };
    });
    execution.state = "waiting_for_user";
    execution.progress = "Waiting for your answer";
    execution.messages.push({
      id: crypto.randomUUID(),
      kind: "question",
      questionId: question.id,
      role: "assistant",
      text: question.prompt,
    });
    this.publish(execution);
    return answer;
  }

  waiting(threadId: string, turnId: string, questionId: string): ThreadSession {
    const session = this.sessions.active();
    if (
      session?.threadId !== threadId ||
      session.execution?.id !== turnId ||
      session.execution.state !== "waiting_for_user" ||
      session.pendingAnswer?.questionId !== questionId
    ) {
      throw new Error(
        "That question is stale or no longer waiting for an answer."
      );
    }
    return session;
  }

  async answer(input: AnswerQuestionInput, alreadyTranslated = false) {
    const [answer] = ipcArgs.answerQuestion.parse([input]);
    const session = this.waiting(
      answer.threadId,
      answer.turnId,
      answer.questionId
    );
    const { execution } = session;
    if (!execution) {
      throw new Error("Turn is no longer active.");
    }
    const text = alreadyTranslated
      ? answer.text
      : await this.speech.translateAnswer(answer.text, execution.languageCode);
    this.waiting(answer.threadId, answer.turnId, answer.questionId);
    const pending = session.pendingAnswer;
    session.pendingAnswer = null;
    execution.pendingQuestion = null;
    execution.state = "running";
    execution.progress = "Continuing";
    execution.messages.push({
      id: crypto.randomUUID(),
      kind: "answer",
      questionId: answer.questionId,
      role: "user",
      text: answer.text,
    });
    this.publish(execution);
    pending?.resolve(text);
    return { ok: true as const };
  }

  get(threadId: string, turnId: string): Turn {
    return this.repository.getTurn(threadId, turnId);
  }

  async cancel(threadId: string, turnId: string) {
    const turn = this.get(threadId, turnId);
    const session = this.sessions.active();
    if (session?.threadId === threadId && session.execution?.id === turnId) {
      const { execution } = session;
      if (!isTerminalTurn(execution.state)) {
        failOpenToolCalls(execution, "Stopped by the user.");
        execution.state = "cancelled";
        execution.progress = "Stopped";
        execution.error = "Stopped by the user.";
        execution.finishedAt = Date.now();
        execution.pendingQuestion = null;
        execution.currentTool = null;
        execution.messages.push({
          id: crypto.randomUUID(),
          kind: "error",
          role: "assistant",
          text: execution.error,
        });
        execution.abortController.abort();
        this.rejectAnswer(session);
        this.publish(execution);
      }
      await session.work;
    } else if (!isTerminalTurn(turn.state)) {
      throw new Error("Turn has no live session.");
    }
    return { ok: true as const };
  }

  private rejectAnswer(session: ThreadSession): void {
    const answer = session.pendingAnswer;
    session.pendingAnswer = null;
    answer?.reject(new DOMException("Aborted", "AbortError"));
  }

  async close(): Promise<void> {
    this.closing = true;
    const session = this.sessions.active();
    if (session?.execution) {
      await this.cancel(session.threadId, session.execution.id);
    }
    await this.sessions.close();
    await this.repository.flush();
  }
}
