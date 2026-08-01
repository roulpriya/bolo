import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";

test("preload exposes only the direct agent and voice contract", async () => {
  const source = await readFile(
    path.join(process.cwd(), "electron", "preload.cjs"),
    "utf8",
  );
  for (const method of [
    "startVoice",
    "sendVoiceChunk",
    "cancelVoice",
    "onVoiceEvent",
    "startAgent",
    "answerRun",
    "getRun",
    "stopRun",
    "speech",
    "health",
  ]) {
    assert.match(source, new RegExp(`\\b${method}\\b`));
  }
  for (const removed of [
    "capabilities:",
    "transcribe:",
    "plan:",
    "clarify:",
    "startRun:",
  ]) {
    assert.doesNotMatch(source, new RegExp(removed));
  }
  assert.doesNotMatch(source, /exposeInMainWorld\([^)]*ipcRenderer/s);
  assert.match(source, /removeListener\("bolo:voice-event"/);
});

test("main-process IPC handlers validate the sender", async () => {
  const source = await readFile(
    path.join(process.cwd(), "electron", "main.ts"),
    "utf8",
  );
  assert.match(source, /if \(!isMainRenderer\(event\)\)/);
  assert.match(source, /event\.sender === mainWindow\.webContents/);
});
