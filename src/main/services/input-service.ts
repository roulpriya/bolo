import type {
  ConversationChoice,
  InputEvent,
  PendingInput,
} from "../../shared/input-routing.ts";
import { ipcArgs, type StartTurnInput } from "../../shared/ipc.ts";
import type { Turn } from "../../shared/threads.ts";
import type { ContinuationDetector } from "./jev-routing.ts";
import type { ThreadService } from "./thread-service.ts";
import type { TurnCoordinator } from "./turn-coordinator.ts";

interface InputRequest {
  abort: AbortController;
  options: { inputMode?: Turn["inputMode"]; languageCode?: string };
  pending: PendingInput;
}

function isPresent(request: InputRequest | null): request is InputRequest {
  return request !== null;
}

/** Reserves input while judging, before any turn or model history is written. */
export class InputService {
  private active: InputRequest | null = null;
  private readonly threads: ThreadService;
  private readonly turns: TurnCoordinator;
  private readonly detector: ContinuationDetector;
  private readonly onEvent: (event: InputEvent) => void;

  constructor(
    threads: ThreadService,
    turns: TurnCoordinator,
    detector: ContinuationDetector,
    onEvent: (event: InputEvent) => void
  ) {
    this.threads = threads;
    this.turns = turns;
    this.detector = detector;
    this.onEvent = onEvent;
  }

  assertAvailable(): void {
    this.turns.assertAvailable();
    if (this.active) {
      throw new Error(
        "Choose a conversation or cancel the pending request first."
      );
    }
  }

  getPending(threadId: string): PendingInput | null {
    this.threads.get(threadId);
    return isPresent(this.active) && this.active.pending.threadId === threadId
      ? structuredClone(this.active.pending)
      : null;
  }

  private emit(
    request: InputRequest,
    pending: PendingInput | null,
    started?: InputEvent["started"]
  ): void {
    this.onEvent({
      pending: pending ? structuredClone(pending) : null,
      requestId: request.pending.id,
      sourceThreadId: request.pending.threadId,
      started,
    });
  }

  async submit(
    input: StartTurnInput,
    options: InputRequest["options"] = {}
  ): Promise<{ ok: true; started?: { threadId: string; turnId: string } }> {
    const [{ text, threadId }] = ipcArgs.startTurn.parse([input]);
    this.assertAvailable();
    const thread = this.threads.get(threadId);
    const request: InputRequest = {
      abort: new AbortController(),
      options,
      pending: {
        id: crypto.randomUUID(),
        inputMode: options.inputMode ?? "typed",
        state: "checking",
        text,
        threadId,
      },
    };
    this.active = request;
    this.emit(request, request.pending);
    try {
      const decision = thread.turns.length
        ? await this.detector.decide(thread, text, request.abort.signal)
        : { choice: "continue" as const };
      request.abort.signal.throwIfAborted();
      if (decision.choice === "ask") {
        request.pending.state = "choice";
        request.pending.reason = decision.reason;
        this.emit(request, request.pending);
        return { ok: true as const };
      }
      const started = await this.start(request, decision.choice);
      return { ok: true as const, started };
    } catch (error) {
      if (this.active === request) {
        this.active = null;
        this.emit(request, null);
      }
      if (request.abort.signal.aborted) {
        return { ok: true as const };
      }
      throw error;
    }
  }

  async resolve(value: { requestId: string; choice: ConversationChoice }) {
    const [input] = ipcArgs.resolveInput.parse([value]);
    const request = this.active;
    if (
      !request ||
      request.pending.id !== input.requestId ||
      request.pending.state !== "choice"
    ) {
      throw new Error("This conversation choice is stale or already handled.");
    }
    await this.start(request, input.choice);
    return { ok: true as const };
  }

  private async start(request: InputRequest, choice: ConversationChoice) {
    request.abort.signal.throwIfAborted();
    this.turns.assertAvailable();
    const sourceThreadId = request.pending.threadId;
    const threadId =
      choice === "new" ? this.threads.repository.create().id : sourceThreadId;
    // TurnCoordinator reserves synchronously. Release the routing slot only after that.
    const started = this.turns.start(
      { text: request.pending.text, threadId },
      request.options
    );
    this.active = null;
    const selection = this.threads.select(threadId);
    try {
      const result = await started;
      await selection;
      this.emit(request, null, result);
      return result;
    } catch (error) {
      await selection;
      this.emit(request, null);
      throw error;
    }
  }

  cancel(threadId?: string) {
    const request = this.active;
    if (request && (!threadId || request.pending.threadId === threadId)) {
      this.active = null;
      request.abort.abort(new Error("Conversation routing was cancelled."));
      this.emit(request, null);
    }
    return { ok: true as const };
  }
}
