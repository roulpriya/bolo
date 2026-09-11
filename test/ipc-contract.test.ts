import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "vitest";
import { ipcArgs } from "../src/shared/ipc.ts";

test("preload exposes the thread, turn, and voice contract with removable subscriptions", async () => {
  const source = await readFile(
    path.join(process.cwd(), "src/preload/index.cts"),
    "utf8"
  );
  for (const method of [
    "createThread",
    "listThreads",
    "getThread",
    "restoreThread",
    "selectThread",
    "startTurn",
    "answerQuestion",
    "cancelTurn",
    "getTurn",
    "onThreadEvent",
    "startVoiceSession",
    "cancelVoiceSession",
    "sendVoiceChunk",
    "onVoiceEvent",
  ]) {
    assert.match(source, new RegExp(`\\b${method}\\b`));
  }
  assert.doesNotMatch(source, /exposeInMainWorld\([^)]*ipcRenderer/s);
  assert.doesNotMatch(
    source,
    /\b(startAgent|answerRun|getRun|stopRun|onAgentText)\b/
  );
  assert.match(source, /removeListener\(IPC\.threadEvent/);
  assert.match(source, /removeListener\(IPC\.voiceEvent/);
});

test("thread selection is explicit and restoration cannot accept a saved selection", () => {
  const id = crypto.randomUUID();
  assert.equal(ipcArgs.selectThread.safeParse([id]).success, true);
  assert.equal(
    ipcArgs.selectThread.safeParse(["../../outside"]).success,
    false
  );
  assert.equal(ipcArgs.restoreThread.safeParse([{}]).success, true);
  assert.equal(
    ipcArgs.restoreThread.safeParse([{ threadId: id }]).success,
    false
  );
});

test("main-process IPC handlers validate the sender and payload", async () => {
  const source = await readFile(
    path.join(process.cwd(), "src/main/index.ts"),
    "utf8"
  );
  assert.match(source, /if \(!isMainRenderer\(event\)\)/);
  assert.match(source, /event\.sender === mainWindow\.webContents/);
  assert.match(source, /argsSchema\.parse\(args\)/);
});

test("turn inputs and answers require explicit UUID ownership", () => {
  const threadId = crypto.randomUUID();
  const turnId = crypto.randomUUID();
  const questionId = crypto.randomUUID();
  assert.equal(
    ipcArgs.startTurn.safeParse([{ text: "Follow up", threadId }]).success,
    true
  );
  assert.equal(
    ipcArgs.startTurn.safeParse([{ text: "Missing thread" }]).success,
    false
  );
  assert.equal(
    ipcArgs.startTurn.safeParse([{ text: "Bad", threadId: "../../outside" }])
      .success,
    false
  );
  assert.equal(
    ipcArgs.answerQuestion.safeParse([
      { questionId, text: "Pune", threadId, turnId },
    ]).success,
    true
  );
  assert.equal(
    ipcArgs.answerQuestion.safeParse([{ questionId, text: "Pune", turnId }])
      .success,
    false
  );
  assert.equal(ipcArgs.cancelTurn.safeParse([threadId, turnId]).success, true);
  assert.equal(ipcArgs.cancelTurn.safeParse([turnId]).success, false);
});

test("voice commands and answers have distinct validated targets", () => {
  const threadId = crypto.randomUUID();
  const turnId = crypto.randomUUID();
  const questionId = crypto.randomUUID();
  assert.equal(
    ipcArgs.startVoiceSession.safeParse([{ purpose: "command", threadId }])
      .success,
    true
  );
  assert.equal(
    ipcArgs.startVoiceSession.safeParse([
      { purpose: "answer", questionId, threadId, turnId },
    ]).success,
    true
  );
  assert.equal(
    ipcArgs.startVoiceSession.safeParse([{ purpose: "answer", threadId }])
      .success,
    false
  );
  assert.equal(
    ipcArgs.startVoiceSession.safeParse([
      { purpose: "command", questionId, threadId, turnId },
    ]).success,
    false
  );
});
