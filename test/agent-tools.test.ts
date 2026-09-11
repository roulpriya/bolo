import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { RunContext } from "@openai/agents";
import { test, vi } from "vitest";
import {
  AgentService,
  buildBoloInstructions,
  failOpenToolCalls,
  recordToolEnd,
  recordToolStart,
} from "../src/main/agent/agent-service.ts";
import { LocalShell } from "../src/main/agent/local-shell.ts";
import type { TurnExecution } from "../src/main/agent/turn-execution.ts";
import {
  createTurnRecord,
  type ToolActivityEntry,
} from "../src/shared/threads.ts";

function fakeRun(overrides: Partial<TurnExecution> = {}): TurnExecution {
  return {
    ...createTurnRecord(crypto.randomUUID(), "Test input"),
    abortController: new AbortController(),
    notify: () => undefined,
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
    assert.ok(names.includes("computer_use"));
    assert.ok(names.includes("browser_use"));
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

test("bash accepts seconds and legacy millisecond timeouts through SDK validation", async () => {
  const service = new AgentService({
    browserProfileDirectory: process.cwd(),
    workspaceDirectory: process.cwd(),
  });
  const command = vi.spyOn(LocalShell.prototype, "run").mockResolvedValue({
    maxOutputLength: 100,
    output: [
      { outcome: { exitCode: 0, type: "exit" }, stderr: "", stdout: "ok" },
    ],
  });
  try {
    const bash = service
      .createTools(fakeRun(), async () => "no")
      .find((tool) => tool.name === "bash");
    assert.ok(bash?.type === "function");
    await bash.invoke(
      new RunContext(),
      JSON.stringify({ command: "vm_stat", timeout: 120_000 })
    );
    assert.deepEqual(command.mock.calls[0][0], {
      commands: ["vm_stat"],
      timeoutMs: 120_000,
    });
    await bash.invoke(
      new RunContext(),
      JSON.stringify({ command: "vm_stat", timeout: 120 })
    );
    assert.equal(command.mock.calls[1][0].timeoutMs, 120_000);
    await bash.invoke(
      new RunContext(),
      JSON.stringify({ command: "vm_stat", timeout: 30 })
    );
    assert.equal(command.mock.calls[2][0].timeoutMs, 30_000);
    await bash.invoke(new RunContext(), JSON.stringify({ command: "vm_stat" }));
    assert.equal(command.mock.calls[3][0].timeoutMs, undefined);
    const invalid = await bash.invoke(
      new RunContext(),
      JSON.stringify({ command: "vm_stat", timeout: 120_001 })
    );
    assert.match(String(invalid), /InvalidToolInputError/);
    assert.equal(command.mock.calls.length, 4);
  } finally {
    command.mockRestore();
    await service.close();
  }
});
