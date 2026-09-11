import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { type Model, type ModelRequest, Runner, Usage } from "@openai/agents";
import { test, vi } from "vitest";
import { AgentService } from "../src/main/agent/agent-service.ts";
import type { TurnExecution } from "../src/main/agent/turn-execution.ts";
import { ModelHistorySession } from "../src/main/state/model-history-session.ts";
import { ThreadRepository } from "../src/main/state/thread-repository.ts";
import { createTurnRecord } from "../src/shared/threads.ts";

function run(input: string): TurnExecution {
  return {
    ...createTurnRecord(crypto.randomUUID(), input),
    abortController: new AbortController(),
    notify: () => undefined,
  };
}

async function restoreSession(id: string, directory: string) {
  const repository = new ThreadRepository(directory);
  await repository.load();
  if (!repository.has(id)) {
    repository.create("Test", id);
  }
  await repository.flush();
  return new ModelHistorySession(id, repository);
}

test("the planning model receives prior turns after reopening a conversation", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "bolo-conversation-"));
  const id = crypto.randomUUID();
  const requests: ModelRequest[] = [];
  const model: Model = {
    getResponse() {
      throw new Error("Expected streaming");
    },
    async *getStreamedResponse(request) {
      requests.push(request);
      await Promise.resolve();
      yield {
        response: {
          id: `response-${requests.length}`,
          output: [
            {
              content: [{ text: "I will use Pune.", type: "output_text" }],
              role: "assistant",
              status: "completed",
              type: "message",
            },
          ],
          usage: new Usage(),
        },
        type: "response_done",
      };
    },
  };
  const agent = new AgentService({
    browserProfileDirectory: directory,
    workspaceDirectory: directory,
  });
  agent.runner = new Runner({
    modelProvider: { getModel: () => model },
    tracingDisabled: true,
  });
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  try {
    await agent.execute(
      run("Use Pune for this task."),
      async () => "yes",
      () => undefined,
      await restoreSession(id, directory)
    );
    await agent.execute(
      run("Which city did I tell you?"),
      async () => "yes",
      () => undefined,
      await restoreSession(id, directory)
    );
    const followup = JSON.stringify(requests[1].input);
    assert.match(followup, /Use Pune for this task/);
    assert.match(followup, /I will use Pune/);
    assert.match(followup, /Which city did I tell you/);
    assert.equal((followup.match(/Use Pune for this task/g) || []).length, 1);
    await agent.execute(
      run("A separate task"),
      async () => "yes",
      () => undefined,
      await restoreSession(crypto.randomUUID(), directory)
    );
    assert.doesNotMatch(JSON.stringify(requests[2].input), /Pune/);
    assert.equal(
      (await stat(path.join(directory, "threads", `${id}.json`))).mode % 0o1000,
      0o600
    );
  } finally {
    vi.unstubAllEnvs();
    await agent.close();
    await rm(directory, { force: true, recursive: true });
  }
});

test("tool calls and clarification answers survive persistence and history edits", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "bolo-conversation-tools-")
  );
  const id = crypto.randomUUID();
  try {
    const session = await restoreSession(id, directory);
    await session.addItems([
      { content: "Book for the city I choose", role: "user" },
      {
        arguments: '{"prompt":"Which city?"}',
        callId: "question-1",
        name: "ask_user_question",
        type: "function_call",
      },
      {
        callId: "question-1",
        name: "ask_user_question",
        output: "Pune",
        status: "completed",
        type: "function_call_result",
      },
    ]);
    const restored = await restoreSession(id, directory);
    assert.deepEqual(await restored.getItems(), await session.getItems());
    const answer = await restored.popItem();
    assert.equal(answer?.type, "function_call_result");
    assert.equal(
      (await (await restoreSession(id, directory)).getItems()).length,
      2
    );
    await restored.clearSession();
    assert.deepEqual(
      await (await restoreSession(id, directory)).getItems(),
      []
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("overlapping history writes preserve every message in order", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "bolo-conversation-writes-")
  );
  const id = crypto.randomUUID();
  try {
    const session = await restoreSession(id, directory);
    await Promise.all([
      session.addItems([{ content: "First", role: "user" }]),
      session.addItems([{ content: "Second", role: "user" }]),
      session.addItems([{ content: "Third", role: "user" }]),
    ]);
    assert.deepEqual(await (await restoreSession(id, directory)).getItems(), [
      { content: "First", role: "user" },
      { content: "Second", role: "user" },
      { content: "Third", role: "user" },
    ]);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
