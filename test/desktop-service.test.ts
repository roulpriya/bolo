import assert from "node:assert/strict";
import { homedir } from "node:os";
import type { Session } from "@openai/agents";
import { test, vi } from "vitest";
import type { TurnExecution } from "../src/main/agent/turn-execution.ts";
import { DesktopService } from "../src/main/services/desktop-service.ts";
import type { SarvamLike } from "../src/main/services/speech-service.ts";
import { ThreadRepository } from "../src/main/state/thread-repository.ts";
import type { VoiceStartOptions } from "../src/shared/ipc.ts";
import type { ThreadEvent } from "../src/shared/threads.ts";

class FakeAgent {
  browserAvailable() {
    return true;
  }
  async execute(
    turn: TurnExecution,
    askUser: (prompt: string, kind: string) => Promise<string>,
    onText: (text: string) => void,
    session: Session
  ) {
    await session.addItems([{ content: turn.input, role: "user" }]);
    const result =
      turn.input === "ask"
        ? `Using ${await askUser("Which city?", "input")}.`
        : `Completed: ${turn.input}`;
    onText(result);
    await session.addItems([
      {
        content: [{ text: result, type: "output_text" }],
        role: "assistant",
        status: "completed",
        type: "message",
      },
    ]);
    return result;
  }
  async close() {
    await Promise.resolve();
  }
}
class FakeVoice {
  options: VoiceStartOptions | undefined;
  start(options: VoiceStartOptions) {
    this.options = options;
    return { sessionId: crypto.randomUUID() };
  }
  sendChunk() {
    /* Test transport. */
  }
  cancel() {
    /* Test transport. */
  }
  close() {
    /* Test transport. */
  }
}
function service(sarvam?: SarvamLike) {
  return new DesktopService({
    agentService: new FakeAgent(),
    continuationDetector: { decide: async () => ({ choice: "continue" }) },
    repository: new ThreadRepository(),
    sarvam: sarvam ?? {
      synthesize: async () => Buffer.from("audio"),
      translateText: async (text) => ({ text }),
    },
    voiceService: new FakeVoice(),
  });
}
async function settled(desktop: DesktopService) {
  await vi.waitUntil(() => desktop.turns.sessions.active() === undefined);
}

test("starts a typed turn and stores its transcript under the owning thread", async () => {
  const desktop = service();
  const thread = await desktop.createThread();
  const started = await desktop.startTurn({
    text: "Do the task",
    threadId: thread.id,
  });
  await settled(desktop);
  const turn = desktop.getTurn(thread.id, started.turnId);
  assert.equal(turn.state, "completed");
  assert.equal(turn.threadId, thread.id);
  assert.deepEqual(
    turn.messages.map((message) => message.text),
    ["Do the task", "Completed: Do the task"]
  );
  assert.equal(desktop.getThread(thread.id).turns.length, 1);
  assert.equal("abortController" in turn, false);
  assert.equal("notify" in turn, false);
  assert.equal(desktop.workspaceDirectory, homedir());
  await desktop.close();
});

test("clarification answers resume one turn and remain in its ordered transcript", async () => {
  const desktop = service();
  const thread = await desktop.createThread();
  const started = await desktop.startTurn({ text: "ask", threadId: thread.id });
  await vi.waitFor(() =>
    assert.equal(
      desktop.getTurn(thread.id, started.turnId).state,
      "waiting_for_user"
    )
  );
  const question = desktop.getTurn(thread.id, started.turnId).pendingQuestion;
  assert.ok(question);
  const answer = {
    questionId: question.id,
    text: "Pune",
    threadId: thread.id,
    turnId: started.turnId,
  };
  await assert.rejects(
    desktop.answerQuestion({ ...answer, threadId: crypto.randomUUID() }),
    /stale/
  );
  await desktop.answerQuestion(answer);
  await settled(desktop);
  assert.equal(desktop.getThread(thread.id).turns.length, 1);
  const turn = desktop.getTurn(thread.id, started.turnId);
  assert.equal(turn.result, "Using Pune.");
  assert.deepEqual(
    turn.messages.map((message) => message.kind),
    ["input", "question", "answer", "result"]
  );
  await assert.rejects(desktop.answerQuestion(answer), /stale/);
  await desktop.close();
});

test("typed and voice follow-ups reuse model context while another thread stays isolated", async () => {
  const desktop = service();
  const execute = vi.spyOn(desktop.agent, "execute");
  const thread = await desktop.createThread();
  await desktop.startTurn({ text: "Remember Pune", threadId: thread.id });
  await settled(desktop);
  const voice = desktop.startVoiceSession({
    purpose: "command",
    threadId: thread.id,
  });
  await desktop.commitVoiceTranslation(voice.sessionId, "What city?", "hi-IN");
  await desktop.commitVoiceTranslation(voice.sessionId, "Duplicate", "hi-IN");
  await settled(desktop);
  assert.equal(desktop.getThread(thread.id).turns.length, 2);
  assert.equal(desktop.getThread(thread.id).turns[1].inputMode, "voice");
  assert.equal(desktop.getThread(thread.id).turns[1].languageCode, "hi-IN");
  assert.equal(execute.mock.calls[0][3], execute.mock.calls[1][3]);
  const other = await desktop.createThread();
  await desktop.startTurn({ text: "Separate", threadId: other.id });
  await settled(desktop);
  assert.notEqual(execute.mock.calls[0][3], execute.mock.calls[2][3]);
  assert.doesNotMatch(
    JSON.stringify(await execute.mock.calls[2][3].getItems()),
    /Pune/
  );
  assert.throws(
    () => desktop.getTurn(other.id, desktop.getThread(thread.id).turns[0].id),
    /belong/
  );
  await desktop.close();
});

test("cancelling a capture prevents late translation from creating a turn", async () => {
  const desktop = service();
  const thread = await desktop.createThread();
  const voice = desktop.startVoiceSession({
    purpose: "command",
    threadId: thread.id,
  });
  desktop.cancelVoiceSession(voice.sessionId);
  await desktop.commitVoiceTranslation(voice.sessionId, "Late input", "en-IN");
  assert.equal(desktop.getThread(thread.id).turns.length, 0);
  await desktop.close();
});

test("only one input can reserve the application execution slot", async () => {
  const desktop = service();
  const thread = await desktop.createThread();
  const other = await desktop.createThread();
  const first = desktop.startTurn({ text: "ask", threadId: thread.id });
  await assert.rejects(
    desktop.startTurn({ text: "Race", threadId: other.id }),
    /already running/
  );
  const started = await first;
  await desktop.cancelTurn(thread.id, started.turnId);
  await desktop.startTurn({ text: "Next", threadId: other.id });
  await settled(desktop);
  assert.equal(desktop.getTurn(thread.id, started.turnId).state, "cancelled");
  await desktop.close();
});

test("cancel waits for tool cleanup and ignores late streaming or completion", async () => {
  const desktop = service();
  const events: ThreadEvent[] = [];
  desktop.on("thread-event", (event) => events.push(event));
  let finish: (result: string) => void = () => undefined;
  let delta: (text: string) => void = () => undefined;
  vi.spyOn(desktop.agent, "execute").mockImplementation(
    (_turn, _ask, onText) => {
      delta = onText;
      return new Promise((resolve) => {
        finish = resolve;
      });
    }
  );
  const thread = await desktop.createThread();
  const started = await desktop.startTurn({
    text: "Long task",
    threadId: thread.id,
  });
  await vi.waitFor(() =>
    assert.equal(vi.mocked(desktop.agent.execute).mock.calls.length, 1)
  );
  const cancelling = desktop.cancelTurn(thread.id, started.turnId);
  const [stopping] = desktop.listThreads();
  assert.equal(stopping.activeTurnId, started.turnId);
  assert.equal(stopping.activeTurnState, "stopping");
  assert.equal(events.at(-1)?.thread.turns.at(-1)?.state, "running");
  await assert.rejects(
    desktop.startTurn({ text: "Too soon", threadId: thread.id }),
    /stopping/
  );
  delta("Late text");
  finish("Late result");
  await cancelling;
  const turn = desktop.getTurn(thread.id, started.turnId);
  assert.equal(turn.state, "cancelled");
  assert.equal(turn.response, "");
  assert.equal(turn.result, null);
  assert.equal(turn.pendingQuestion, null);
  assert.equal(desktop.listThreads()[0].activeTurnId, null);
  assert.equal(events.at(-1)?.thread.turns.at(-1)?.state, "cancelled");
  assert.ok((events.at(-1)?.revision ?? 0) > stopping.revision);
  await desktop.close();
});

test("new conversation preserves a background question and accepts work only after it ends", async () => {
  const desktop = service();
  const original = await desktop.restoreThread();
  const started = await desktop.startTurn({
    text: "ask",
    threadId: original.id,
  });
  await vi.waitFor(() =>
    assert.equal(
      desktop.getTurn(original.id, started.turnId).state,
      "waiting_for_user"
    )
  );
  const question = desktop.getTurn(original.id, started.turnId).pendingQuestion;
  assert.ok(question);

  const fresh = await desktop.createThread();
  assert.equal(fresh.turns.length, 0);
  assert.equal((await desktop.restoreThread()).id, fresh.id);
  assert.equal(
    desktop.listThreads().find((thread) => thread.id === original.id)
      ?.activeTurnState,
    "waiting_for_user"
  );
  await assert.rejects(
    desktop.startTurn({ text: "Draft", threadId: fresh.id }),
    /already running/
  );
  assert.throws(
    () => desktop.startVoiceSession({ purpose: "command", threadId: fresh.id }),
    /already running/
  );
  assert.equal(desktop.getThread(fresh.id).turns.length, 0);

  await desktop.selectThread(original.id);
  assert.equal((await desktop.restoreThread()).id, original.id);
  assert.equal(
    desktop.getTurn(original.id, started.turnId).pendingQuestion?.id,
    question.id
  );
  await desktop.answerQuestion({
    questionId: question.id,
    text: "Pune",
    threadId: original.id,
    turnId: started.turnId,
  });
  await settled(desktop);
  assert.equal(
    desktop.getTurn(original.id, started.turnId).result,
    "Using Pune."
  );
  assert.equal(desktop.getThread(fresh.id).turns.length, 0);
  await desktop.selectThread(fresh.id);
  await desktop.startTurn({ text: "New request", threadId: fresh.id });
  await settled(desktop);
  assert.equal(desktop.getThread(fresh.id).turns.length, 1);
  assert.doesNotMatch(
    JSON.stringify(desktop.threads.repository.getContext(fresh.id)),
    /Pune/
  );
  await desktop.close();
});

test("terminal events release input only after model history cleanup", async () => {
  const desktop = service();
  const thread = await desktop.createThread();
  const session = desktop.turns.sessions.get(thread.id);
  let finishCleanup: () => void = () => undefined;
  const cleanup = vi
    .spyOn(session.modelHistory, "flush")
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishCleanup = resolve;
        })
    );
  const events: ThreadEvent[] = [];
  desktop.on("thread-event", (event) => events.push(event));
  await desktop.startTurn({ text: "Hello", threadId: thread.id });
  await vi.waitFor(() => assert.equal(cleanup.mock.calls.length, 1));
  assert.equal(desktop.listThreads()[0].activeTurnState, "stopping");
  assert.equal(events.at(-1)?.thread.turns.at(-1)?.state, "running");
  await assert.rejects(
    desktop.startTurn({ text: "Too soon", threadId: thread.id }),
    /stopping/
  );
  finishCleanup();
  await settled(desktop);
  assert.equal(events.at(-1)?.thread.turns.at(-1)?.state, "completed");
  assert.equal(desktop.listThreads()[0].activeTurnId, null);
  await desktop.close();
});

test("answers cancelled while translating cannot resume a turn", async () => {
  let translate: (value: { text: string }) => void = () => undefined;
  const desktop = service({
    synthesize: async () => Buffer.from(""),
    translateText: async (text, options) => {
      if (options?.sourceLanguageCode === "hi-IN") {
        return await new Promise((resolve) => {
          translate = resolve;
        });
      }
      return { text };
    },
  });
  const thread = await desktop.createThread();
  const voice = desktop.startVoiceSession({
    purpose: "command",
    threadId: thread.id,
  });
  await desktop.commitVoiceTranslation(voice.sessionId, "ask", "hi-IN");
  await vi.waitFor(() =>
    assert.equal(
      desktop.getThread(thread.id).turns[0].state,
      "waiting_for_user"
    )
  );
  const [turn] = desktop.getThread(thread.id).turns;
  assert.ok(turn.pendingQuestion);
  const answer = desktop.answerQuestion({
    questionId: turn.pendingQuestion.id,
    text: "Pune",
    threadId: thread.id,
    turnId: turn.id,
  });
  const rejected = assert.rejects(answer, /stale/);
  await desktop.cancelTurn(thread.id, turn.id);
  translate({ text: "Pune" });
  await rejected;
  assert.equal(desktop.getTurn(thread.id, turn.id).state, "cancelled");
  await desktop.close();
});

test("thread events carry increasing revisions and no runtime handles", async () => {
  const desktop = service();
  const events: ThreadEvent[] = [];
  desktop.on("thread-event", (event) => events.push(event));
  const thread = await desktop.createThread();
  await desktop.startTurn({ text: "Hello", threadId: thread.id });
  await settled(desktop);
  assert.ok(events.length >= 2);
  assert.ok(
    events.every(
      (event, index) =>
        event.threadId === thread.id &&
        event.revision > (events[index - 1]?.revision ?? -1)
    )
  );
  assert.doesNotMatch(
    JSON.stringify(events),
    /abortController|pendingAnswer|modelHistory|notify/
  );
  await desktop.close();
});

test("voice answers target the existing question and retain localization", async () => {
  const desktop = service({
    synthesize: async () => Buffer.from("audio"),
    translateText: async (text) => ({ text: `localized:${text}` }),
  });
  const thread = await desktop.createThread();
  const command = desktop.startVoiceSession({
    purpose: "command",
    threadId: thread.id,
  });
  await desktop.commitVoiceTranslation(command.sessionId, "ask", "hi-IN");
  await vi.waitFor(() =>
    assert.equal(
      desktop.getThread(thread.id).turns[0].state,
      "waiting_for_user"
    )
  );
  const [turn] = desktop.getThread(thread.id).turns;
  assert.ok(turn.pendingQuestion);
  assert.equal(turn.pendingQuestion.prompt, "localized:Which city?");
  const voice = desktop.startVoiceSession({
    purpose: "answer",
    questionId: turn.pendingQuestion.id,
    threadId: thread.id,
    turnId: turn.id,
  });
  await desktop.commitVoiceTranslation(voice.sessionId, "Pune", "hi-IN");
  await settled(desktop);
  assert.equal(desktop.getThread(thread.id).turns.length, 1);
  assert.equal(
    desktop.getTurn(thread.id, turn.id).result,
    "localized:Using Pune."
  );
  await desktop.close();
});

test("a final persistence failure is visible even when the agent completed its work", async () => {
  const desktop = service();
  const thread = await desktop.createThread();
  vi.spyOn(desktop.threads.repository, "flush").mockImplementation(async () => {
    await Promise.resolve();
    if (desktop.getThread(thread.id).turns.at(-1)?.state === "completed") {
      throw new Error("Disk is full");
    }
  });
  const started = await desktop.startTurn({
    text: "Finish work",
    threadId: thread.id,
  });
  await settled(desktop);
  const turn = desktop.getTurn(thread.id, started.turnId);
  assert.equal(turn.state, "failed");
  assert.equal(turn.result, "Completed: Finish work");
  assert.match(
    turn.error ?? "",
    /Could not save conversation history: Disk is full/
  );
  await desktop.close();
});

test("shutdown rejects an outstanding question and drains the active session", async () => {
  const desktop = service();
  const thread = await desktop.createThread();
  const started = await desktop.startTurn({ text: "ask", threadId: thread.id });
  await vi.waitFor(() =>
    assert.equal(
      desktop.getTurn(thread.id, started.turnId).state,
      "waiting_for_user"
    )
  );
  await desktop.close();
  const turn = desktop.getTurn(thread.id, started.turnId);
  assert.equal(turn.state, "cancelled");
  assert.equal(turn.pendingQuestion, null);
  assert.equal(desktop.turns.sessions.active(), undefined);
  await assert.rejects(
    desktop.startTurn({ text: "After close", threadId: thread.id }),
    /shutting down/
  );
});
