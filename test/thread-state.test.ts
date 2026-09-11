import assert from "node:assert/strict";
import { test } from "vitest";
import { ThreadRepository } from "../src/main/state/thread-repository.ts";
import {
  applyThreadEvent,
  loadLegacyChat,
  mergeThreadSummaries,
} from "../src/renderer/app/thread-state.ts";
import {
  createTurnRecord,
  summarizeThread,
  type ThreadEvent,
} from "../src/shared/threads.ts";

test("renderer snapshots reject stale, duplicate, and mismatched events", () => {
  const repository = new ThreadRepository();
  const original = repository.create();
  const turn = createTurnRecord(original.id, "Hello");
  const updated = repository.saveTurn(turn);
  const event: ThreadEvent = {
    revision: updated.revision,
    thread: updated,
    threadId: original.id,
    turnId: turn.id,
    type: "thread.updated",
  };
  assert.deepEqual(applyThreadEvent(original, event), updated);
  assert.equal(applyThreadEvent(updated, event), updated);
  assert.equal(
    applyThreadEvent(original, { ...event, threadId: crypto.randomUUID() }),
    original
  );
  assert.equal(
    applyThreadEvent(original, { ...event, turnId: crypto.randomUUID() }),
    original
  );
  assert.equal(applyThreadEvent(updated, { ...event, revision: 0 }), updated);
});

test("renderer ignores saved selection and only reads legacy history for migration", () => {
  const legacyChat = {
    conversationId: crypto.randomUUID(),
    messages: [{ id: 1, kind: "user", text: "Old text" }],
    runId: "",
  };
  const entries = new Map<string, string>([
    ["bolo:selectedThread", crypto.randomUUID()],
  ]);
  const storage = {
    getItem: (key: string) => entries.get(key) ?? null,
  };
  assert.deepEqual(loadLegacyChat(storage), {});
  entries.set("bolo:activeChat", JSON.stringify(legacyChat));
  assert.deepEqual(loadLegacyChat(storage), { legacyChat });
  entries.set("bolo:activeChat", "invalid JSON");
  assert.deepEqual(loadLegacyChat(storage), {});
  assert.deepEqual(
    loadLegacyChat({
      getItem: () => {
        throw new Error("Blocked");
      },
    }),
    {}
  );
});

test("thread summaries distinguish pending questions and ignore older cleanup listings", () => {
  const repository = new ThreadRepository();
  const thread = repository.create();
  const turn = createTurnRecord(thread.id, "Ask me");
  turn.state = "waiting_for_user";
  const waiting = summarizeThread(repository.saveTurn(turn));
  assert.equal(waiting.activeTurnState, "waiting_for_user");
  assert.equal(waiting.activeTurnId, turn.id);
  turn.state = "completed";
  const terminal = summarizeThread(repository.saveTurn(turn));
  assert.equal(terminal.activeTurnState, null);
  assert.equal(terminal.activeTurnId, null);
  assert.deepEqual(mergeThreadSummaries([terminal], [waiting]), [terminal]);
});

test("a late thread listing cannot overwrite a newer active-turn summary", () => {
  const repository = new ThreadRepository();
  const thread = repository.create();
  const original = summarizeThread(thread);
  const turn = createTurnRecord(thread.id, "Hello");
  const updated = summarizeThread(repository.saveTurn(turn));
  const merged = mergeThreadSummaries([updated], [original]);
  assert.equal(merged[0].activeTurnId, turn.id);
  assert.equal(merged[0].revision, updated.revision);
});
