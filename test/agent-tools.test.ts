import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "vitest";
import {
  AgentService,
  buildBoloInstructions,
  failOpenToolCalls,
  recordToolEnd,
  recordToolStart,
} from "../src/main/agent/agent-service.ts";
import type { Run, ToolActivityEntry } from "../src/main/agent/run.ts";

function fakeRun(overrides: Partial<Run> = {}): Run {
  return {
    abortController: new AbortController(),
    createdAt: Date.now(),
    currentTool: null,
    error: null,
    finishedAt: null,
    id: "test",
    input: "",
    languageCode: "en-IN",
    pendingQuestion: null,
    progress: "",
    result: null,
    state: "running",
    toolActivity: [],
    ...overrides,
  };
}

test("exposes Pi-style read, write, edit, and bash tools", async () => {
  const profileDirectory = await mkdtemp(
    path.join(tmpdir(), "bolo-agent-tools-")
  );
  const service = new AgentService({
    browserProfileDirectory: profileDirectory,
    workspaceDirectory: process.cwd(),
  });
  try {
    const tools = service.createTools(fakeRun(), async () => "no");
    const names = tools.map((item) => item.name);
    for (const name of ["read", "write", "edit", "bash"]) {
      assert.ok(names.includes(name), `${name} should be available`);
    }
    assert.ok(!names.includes("shell"));
  } finally {
    await service.close();
    await rm(profileDirectory, { force: true, recursive: true });
  }
});

test("uses a concise Pi-style tool prompt with system date and time", () => {
  const prompt = buildBoloInstructions(
    "/workspace",
    new Date("2026-08-11T10:30:00Z")
  );
  assert.match(prompt, /expert coding assistant operating inside Bolo/i);
  assert.match(prompt, /Available tools:/);
  assert.match(prompt, /- read:/);
  assert.match(prompt, /Use tools to do the work/);
  assert.match(prompt, /Be concise in your responses/);
  assert.match(
    prompt,
    /Avoid Markdown unless it makes the response materially clearer/
  );
  assert.match(prompt, /Current working directory: \/workspace/);
  assert.match(prompt, /System date:/);
  assert.match(prompt, /System time:/);
});

test("records expandable tool inputs and redacted outputs", () => {
  const run: {
    currentTool: string | null;
    progress: string;
    toolActivity: ToolActivityEntry[];
  } = { currentTool: null, progress: "", toolActivity: [] };
  const call = {
    arguments: '{"command":"printf hello","api_key":"should-not-appear"}',
    callId: "call-1",
    name: "bash",
    type: "function_call",
  };
  recordToolStart(run, { name: "bash" }, call);
  recordToolEnd(run, { name: "bash" }, '{"stdout":"hello"}', call);
  assert.equal(run.toolActivity.length, 1);
  assert.equal(run.toolActivity[0].status, "completed");
  assert.match(run.toolActivity[0].input, /\[redacted\]/);
  assert.match(String(run.toolActivity[0].output), /hello/);

  recordToolStart(
    run,
    { name: "read" },
    { ...call, callId: "call-2", name: "read" }
  );
  failOpenToolCalls(run, new Error("tool failed"));
  assert.equal(run.toolActivity[1].status, "failed");
  assert.match(String(run.toolActivity[1].output), /tool failed/);
});

test("does not expose answers returned from the question tool", () => {
  const run: {
    currentTool: string | null;
    progress: string;
    toolActivity: ToolActivityEntry[];
  } = { currentTool: null, progress: "", toolActivity: [] };
  const call = {
    arguments: '{"prompt":"Confirm?"}',
    callId: "question-1",
    name: "ask_user_question",
    type: "function_call",
  };
  recordToolStart(run, { name: "ask_user_question" }, call);
  recordToolEnd(run, { name: "ask_user_question" }, "a private answer", call);
  assert.equal(run.toolActivity[0].output, "Response received.");
});
