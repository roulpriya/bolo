import type { InputEvent, PendingInput } from "../shared/input-routing.ts";
import {
  createTurnRecord,
  isTerminalTurn,
  summarizeThread,
  type Thread,
  type ThreadEvent,
} from "../shared/threads.ts";

const PREVIEW_NOTICE =
  "Browser preview — connect the Bolo desktop app for real agent execution.";

function request<T>(operation: () => T): Promise<T> {
  return Promise.resolve().then(operation);
}

/** In-memory preview uses the same thread contract as the Electron bridge. */
export function installBrowserShimIfNeeded() {
  if (window.boloDesktop) {
    return;
  }
  const threads = new Map<string, Thread>();
  let selectedThreadId: string | null = null;
  const listeners = new Set<(event: ThreadEvent) => void>();
  const inputListeners = new Set<(event: InputEvent) => void>();
  let pendingInput: PendingInput | null = null;
  const emitInput = (event: InputEvent) => {
    for (const listener of inputListeners) {
      listener(event);
    }
  };
  const cancelInput = () => {
    if (pendingInput) {
      const { id, threadId } = pendingInput;
      pendingInput = null;
      emitInput({ pending: null, requestId: id, sourceThreadId: threadId });
    }
    return { ok: true as const };
  };
  const get = (id: string) => {
    const thread = threads.get(id);
    if (!thread) {
      throw new Error("Thread not found.");
    }
    return thread;
  };
  const create = () => {
    cancelInput();
    const now = Date.now();
    const thread: Thread = {
      createdAt: now,
      id: crypto.randomUUID(),
      revision: 0,
      title: "New conversation",
      turns: [],
      updatedAt: now,
    };
    threads.set(thread.id, thread);
    selectedThreadId = thread.id;
    return structuredClone(thread);
  };
  const emit = (thread: Thread, turnId: string) => {
    thread.revision += 1;
    thread.updatedAt = Date.now();
    const event: ThreadEvent = {
      revision: thread.revision,
      thread: structuredClone(thread),
      threadId: thread.id,
      turnId,
      type: "thread.updated",
    };
    for (const listener of listeners) {
      listener(event);
    }
  };
  window.boloDesktop = {
    answerQuestion: () =>
      Promise.reject(new Error("No question is waiting in this preview.")),
    cancelInput: async () => cancelInput(),
    cancelTurn: (threadId, turnId) =>
      request(() => {
        const thread = get(threadId);
        const turn = thread.turns.find((item) => item.id === turnId);
        if (!turn) {
          throw new Error("Turn not found.");
        }
        if (!isTerminalTurn(turn.state)) {
          turn.state = "cancelled";
          turn.progress = "Stopped";
          turn.finishedAt = Date.now();
          emit(thread, turn.id);
        }
        return { ok: true };
      }),
    cancelVoiceSession: async () => ({ ok: true }),
    createThread: async () => create(),
    getMcpServers: async () => [],
    getPendingInput: async (threadId) =>
      pendingInput?.threadId === threadId
        ? structuredClone(pendingInput)
        : null,
    getThread: async (id) => structuredClone(get(id)),
    getTurn: (threadId, turnId) =>
      request(() => {
        const turn = get(threadId).turns.find((item) => item.id === turnId);
        if (!turn) {
          throw new Error("Turn not found.");
        }
        return structuredClone(turn);
      }),
    health: async () => ({ ok: true }),
    hideWindow: () => undefined,
    listThreads: async () => [...threads.values()].map(summarizeThread),
    onFocusCommand: () => () => undefined,
    onInputEvent: (listener) => {
      inputListeners.add(listener);
      return () => inputListeners.delete(listener);
    },
    onMcpOAuthEvent: () => () => undefined,
    onNewCommand: () => () => undefined,
    onThreadEvent: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onVoiceEvent: () => () => undefined,
    openSettings: () =>
      request(() => {
        window.open("../settings/index.html", "_blank", "noopener");
        return { ok: true };
      }),
    resolveInput: async ({ requestId, choice }) => {
      if (!pendingInput || pendingInput.id !== requestId) {
        throw new Error(
          "This conversation choice is stale or already handled."
        );
      }
      const pending = pendingInput;
      pendingInput = null;
      const threadId = choice === "new" ? create().id : pending.threadId;
      const started = await window.boloDesktop.startTurn({
        text: pending.text,
        threadId,
      });
      emitInput({
        pending: null,
        requestId,
        sourceThreadId: pending.threadId,
        started,
      });
      return { ok: true };
    },
    restoreThread: async () =>
      selectedThreadId ? structuredClone(get(selectedThreadId)) : create(),
    saveMcpServers: async (servers) => servers,
    selectThread: (id) =>
      request(() => {
        cancelInput();
        const thread = get(id);
        selectedThreadId = id;
        return structuredClone(thread);
      }),
    sendVoiceChunk: () => undefined,
    setExpanded: () => undefined,
    setIgnoreMouseEvents: () => undefined,
    speech: () =>
      Promise.reject(
        new Error("Speech playback is unavailable in the browser preview.")
      ),
    startMcpOAuth: async () => ({ status: "pending" }),
    startTurn: ({ threadId, text }) =>
      request(() => {
        if (
          [...threads.values()].some((item) =>
            item.turns.some((candidate) => !isTerminalTurn(candidate.state))
          )
        ) {
          throw new Error("A turn is already running.");
        }
        const thread = get(threadId);
        const turn = createTurnRecord(threadId, text);
        thread.turns.push(turn);
        thread.title = thread.turns[0]?.input.slice(0, 80) ?? thread.title;
        emit(thread, turn.id);
        setTimeout(() => {
          if (isTerminalTurn(turn.state)) {
            return;
          }
          turn.state = "completed";
          turn.finishedAt = Date.now();
          turn.progress = "Complete";
          turn.result = `You said: "${text}". ${PREVIEW_NOTICE}`;
          turn.response = turn.result;
          turn.messages.push({
            id: crypto.randomUUID(),
            kind: "result",
            role: "assistant",
            text: turn.result,
          });
          emit(thread, turn.id);
        }, 600);
        return { threadId, turnId: turn.id };
      }),
    startVoiceSession: () =>
      Promise.reject(
        new Error("Voice input is unavailable in the browser preview.")
      ),
    submitInput: async ({ threadId, text }) => {
      if (get(threadId).turns.length) {
        pendingInput = {
          id: crypto.randomUUID(),
          inputMode: "typed",
          reason: "unconfigured",
          state: "choice",
          text,
          threadId,
        };
        emitInput({
          pending: structuredClone(pendingInput),
          requestId: pendingInput.id,
          sourceThreadId: threadId,
        });
      } else {
        await window.boloDesktop.startTurn({ text, threadId });
      }
      return { ok: true };
    },
  };
}
