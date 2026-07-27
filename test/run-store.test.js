import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { RunStore } from "../src/orchestration/run-store.js";

test("run store persists redacted serializable run state", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bolo-run-store-"));
  try {
    const file = path.join(directory, "runs.json");
    const store = await new RunStore({ file }).load();
    store.set("run-1", {
      id: "run-1",
      createdAt: 1,
      state: "completed",
      stage: "Complete",
      plan: { id: "plan-1" },
      steps: {},
      completion: "Done.",
      abortController: new AbortController(),
      internalStopReason: "must not persist",
    });
    await store.close();

    const persisted = JSON.parse(await readFile(file, "utf8"));
    assert.equal(persisted[0].completion, "Done.");
    assert.equal("abortController" in persisted[0], false);
    assert.equal("internalStopReason" in persisted[0], false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("run store marks an interrupted execution failed on restart", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bolo-run-store-"));
  try {
    const file = path.join(directory, "runs.json");
    const first = await new RunStore({ file }).load();
    first.set("run-1", {
      id: "run-1",
      createdAt: 1,
      state: "executing",
      stage: "Working",
      plan: { id: "plan-1" },
    });
    await first.close();

    const restored = await new RunStore({ file }).load();
    assert.equal(restored.get("run-1").state, "failed");
    assert.match(restored.get("run-1").error, /restarted/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
