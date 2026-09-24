import assert from "node:assert/strict";
import type { Session } from "@openai/agents";
import { test, vi } from "vitest";
import type { TurnExecution } from "../src/main/agent/turn-execution.ts";
import { DesktopService } from "../src/main/services/desktop-service.ts";
import type {
  ContinuationDetector,
  RoutingDecision,
} from "../src/main/services/jev-routing.ts";
import { ThreadRepository } from "../src/main/state/thread-repository.ts";
import type { InputEvent } from "../src/shared/input-routing.ts";
import type { VoiceEvent } from "../src/shared/sessions.ts";

function service() {
  const contexts: unknown[] = [];
  const decide = vi
    .fn<ContinuationDetector["decide"]>()
    .mockResolvedValue({ choice: "continue" });
  const desktop = new DesktopService({
    agentService: {
      browserAvailable: () => true,
      close: async () => undefined,
      execute: async (
        turn: TurnExecution,
        ask: (prompt: string, kind: string) => Promise<string>,
        _delta: (text: string) => void,
        session: Session
      ) => {
        contexts.push(await session.getItems());
        await session.addItems([{ content: turn.input, role: "user" }]);
        return turn.input === "ask"
          ? await ask("Which city?", "input")
          : `Completed ${turn.input}`;
      },
    },
    continuationDetector: { decide },
    repository: new ThreadRepository(),
    sarvam: {
      synthesize: async () => Buffer.from("audio"),
      translateText: async (text) => ({ text }),
    },
    voiceService: {
      cancel: () => undefined,
      close: () => undefined,
      sendChunk: () => undefined,
      start: () => ({ sessionId: crypto.randomUUID() }),
    },
  });
  const events: InputEvent[] = [];
  desktop.on("input-event", (event) => events.push(event));
  return { contexts, decide, desktop, events };
}

async function settled(desktop: DesktopService) {
  await vi.waitUntil(() => desktop.turns.sessions.active() === undefined);
}

async function initial(desktop: DesktopService) {
  const thread = await desktop.createThread();
  await desktop.submitInput({ text: "Remember Pune", threadId: thread.id });
  await settled(desktop);
  return thread;
}

test("empty conversations skip Jev and clear the pending input after starting", async () => {
  const { desktop, decide, events } = service();
  const thread = await initial(desktop);
  assert.equal(decide.mock.calls.length, 0);
  assert.equal(desktop.getThread(thread.id).turns.length, 1);
  assert.equal(desktop.getPendingInput(thread.id), null);
  assert.equal(events.at(-1)?.started?.threadId, thread.id);
  await desktop.close();
});

test("typed and voice continuations reuse context; new topics create isolated history", async () => {
  const { desktop, decide, contexts, events } = service();
  const thread = await initial(desktop);
  await desktop.submitInput({ text: "Which city?", threadId: thread.id });
  await settled(desktop);
  assert.match(JSON.stringify(contexts[1]), /Remember Pune/);
  decide.mockResolvedValueOnce({ choice: "new" });
  const voiceEvents: VoiceEvent[] = [];
  desktop.on("voice-event", (event) => voiceEvents.push(event));
  const voice = desktop.startVoiceSession({
    purpose: "command",
    threadId: thread.id,
  });
  await desktop.commitVoiceTranslation(voice.sessionId, "Set a timer", "hi-IN");
  await desktop.commitVoiceTranslation(voice.sessionId, "Duplicate", "hi-IN");
  await settled(desktop);
  const started = events.at(-1)?.started;
  assert.ok(started);
  assert.notEqual(started.threadId, thread.id);
  assert.deepEqual(contexts[2], []);
  assert.equal(desktop.getThread(thread.id).turns.length, 2);
  const turn = desktop.getTurn(started.threadId, started.turnId);
  assert.equal(turn.inputMode, "voice");
  assert.equal(turn.languageCode, "hi-IN");
  assert.equal((await desktop.restoreThread()).id, started.threadId);
  assert.equal(voiceEvents.at(-1)?.threadId, started.threadId);
  assert.equal(voiceEvents.at(-1)?.turnId, started.turnId);
  assert.equal(decide.mock.calls.length, 2);
  await desktop.close();
});

test("uncertainty stores the request without executing and a choice can be consumed only once", async () => {
  const { desktop, decide, contexts } = service();
  const thread = await initial(desktop);
  decide.mockResolvedValue({ choice: "ask", reason: "uncertain" });
  await desktop.submitInput({ text: "Do that", threadId: thread.id });
  const pending = desktop.getPendingInput(thread.id);
  assert.ok(pending);
  assert.equal(pending.state, "choice");
  assert.equal(desktop.getThread(thread.id).turns.length, 1);
  assert.equal(contexts.length, 1);
  assert.equal((await desktop.restoreThread()).id, thread.id);
  await assert.rejects(
    desktop.submitInput({ text: "Duplicate", threadId: thread.id }),
    /pending request/
  );
  assert.throws(
    () =>
      desktop.startVoiceSession({ purpose: "command", threadId: thread.id }),
    /pending request/
  );
  await assert.rejects(
    desktop.resolveInput({ choice: "new", requestId: crypto.randomUUID() }),
    /stale/
  );
  const resolving = desktop.resolveInput({
    choice: "continue",
    requestId: pending.id,
  });
  await assert.rejects(
    desktop.resolveInput({ choice: "new", requestId: pending.id }),
    /stale/
  );
  await resolving;
  await settled(desktop);
  assert.equal(desktop.getThread(thread.id).turns.length, 2);
  assert.match(JSON.stringify(contexts[1]), /Remember Pune/);
  await desktop.close();
});

test("manual new chat preserves a deferred voice transcript and language", async () => {
  const { desktop, decide, events } = service();
  const thread = await initial(desktop);
  decide.mockResolvedValue({ choice: "ask", reason: "unavailable" });
  const voice = desktop.startVoiceSession({
    purpose: "command",
    threadId: thread.id,
  });
  await desktop.commitVoiceTranslation(voice.sessionId, "Set a timer", "hi-IN");
  const pending = desktop.getPendingInput(thread.id);
  assert.ok(pending);
  await desktop.resolveInput({ choice: "new", requestId: pending.id });
  await settled(desktop);
  const started = events.at(-1)?.started;
  assert.ok(started);
  const turn = desktop.getTurn(started.threadId, started.turnId);
  assert.equal(turn.input, "Set a timer");
  assert.equal(turn.inputMode, "voice");
  assert.equal(turn.languageCode, "hi-IN");
  assert.equal(desktop.getThread(thread.id).turns.length, 1);
  await desktop.close();
});

test("switching conversations cancels a pending decision and ignores a late answer", async () => {
  const { desktop, decide, contexts } = service();
  const thread = await initial(desktop);
  let finish: (value: RoutingDecision) => void = () => undefined;
  decide.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const checking = desktop.submitInput({
    text: "Late request",
    threadId: thread.id,
  });
  const pending = desktop.getPendingInput(thread.id);
  assert.equal(pending?.state, "checking");
  await assert.rejects(
    desktop.submitInput({ text: "Race", threadId: thread.id }),
    /pending request/
  );
  const other = await desktop.createThread();
  assert.equal(decide.mock.calls[0][2].aborted, true);
  finish({ choice: "new" });
  await checking;
  assert.equal(contexts.length, 1);
  assert.equal(desktop.listThreads().length, 2);
  assert.equal((await desktop.restoreThread()).id, other.id);
  await desktop.close();
});

test("cancelling voice during Jev detection prevents execution", async () => {
  const { desktop, decide, contexts } = service();
  const thread = await initial(desktop);
  let finish: (value: RoutingDecision) => void = () => undefined;
  decide.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const voice = desktop.startVoiceSession({
    purpose: "command",
    threadId: thread.id,
  });
  const checking = desktop.commitVoiceTranslation(
    voice.sessionId,
    "Late voice",
    "hi-IN"
  );
  desktop.cancelVoiceSession(voice.sessionId);
  finish({ choice: "continue" });
  await checking;
  assert.equal(contexts.length, 1);
  assert.equal(desktop.getPendingInput(thread.id), null);
  await desktop.close();
});

test("cancelled choices cannot be resolved and a fresh request can proceed", async () => {
  const { desktop, decide } = service();
  const thread = await initial(desktop);
  decide.mockResolvedValueOnce({ choice: "ask", reason: "uncertain" });
  await desktop.submitInput({ text: "Do that", threadId: thread.id });
  const pending = desktop.getPendingInput(thread.id);
  assert.ok(pending);
  desktop.cancelInput(thread.id);
  await assert.rejects(
    desktop.resolveInput({ choice: "continue", requestId: pending.id }),
    /stale/
  );
  await desktop.submitInput({ text: "Try again", threadId: thread.id });
  await settled(desktop);
  assert.equal(desktop.getThread(thread.id).turns.length, 2);
  await desktop.close();
});

test("answers to an agent question bypass Jev for text and voice", async () => {
  const { desktop, decide } = service();
  const thread = await desktop.createThread();
  for (const mode of ["typed", "voice"]) {
    await desktop.startTurn({ text: "ask", threadId: thread.id });
    await vi.waitUntil(
      () =>
        desktop.getThread(thread.id).turns.at(-1)?.state === "waiting_for_user"
    );
    const turn = desktop.getThread(thread.id).turns.at(-1);
    assert.ok(turn?.pendingQuestion);
    const target = {
      questionId: turn.pendingQuestion.id,
      threadId: thread.id,
      turnId: turn.id,
    };
    if (mode === "typed") {
      await desktop.answerQuestion({ ...target, text: "Pune" });
    } else {
      const voice = desktop.startVoiceSession({ ...target, purpose: "answer" });
      await desktop.commitVoiceTranslation(voice.sessionId, "Pune", "hi-IN");
    }
    await settled(desktop);
    assert.equal(desktop.getTurn(thread.id, turn.id).result, "Pune");
  }
  assert.equal(decide.mock.calls.length, 0);
  assert.equal(desktop.getThread(thread.id).turns.length, 2);
  await desktop.close();
});
