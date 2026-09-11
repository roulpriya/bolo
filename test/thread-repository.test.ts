import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, vi } from "vitest";
import { ThreadService } from "../src/main/services/thread-service.ts";
import { ThreadRepository } from "../src/main/state/thread-repository.ts";
import { createTurnRecord } from "../src/shared/threads.ts";

async function withDirectory(work: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(path.join(tmpdir(), "bolo-threads-"));
  try {
    await work(directory);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

test("restores ordered turns and private model context from one atomic thread file", async () => {
  await withDirectory(async (directory) => {
    const repository = new ThreadRepository(directory);
    const thread = repository.create();
    const first = createTurnRecord(thread.id, "First");
    first.state = "completed";
    first.result = "Done";
    first.finishedAt = Date.now();
    repository.saveTurn(first);
    const second = createTurnRecord(thread.id, "Second");
    second.state = "completed";
    repository.saveTurn(second);
    await repository.setContext(thread.id, [
      { content: "Private context", role: "user" },
    ]);
    const restored = new ThreadRepository(directory);
    await restored.load();
    assert.deepEqual(
      restored.get(thread.id).turns.map((turn) => turn.input),
      ["First", "Second"]
    );
    assert.equal(restored.get(thread.id).title, "First");
    assert.deepEqual(restored.getContext(thread.id), [
      { content: "Private context", role: "user" },
    ]);
    assert.doesNotMatch(
      JSON.stringify(restored.get(thread.id)),
      /Private context/
    );
    const snapshot = restored.get(thread.id);
    snapshot.turns.length = 0;
    assert.equal(restored.get(thread.id).turns.length, 2);
  });
});

test("restart fails unfinished turns and questions without restarting execution", async () => {
  await withDirectory(async (directory) => {
    const repository = new ThreadRepository(directory);
    const thread = repository.create();
    const turn = createTurnRecord(thread.id, "Waiting task");
    turn.state = "waiting_for_user";
    turn.pendingQuestion = {
      id: crypto.randomUUID(),
      kind: "input",
      prompt: "Which city?",
    };
    turn.toolActivity.push({
      at: Date.now(),
      detail: "Waiting",
      id: "tool-1",
      input: "",
      kind: "tool_call",
      output: null,
      status: "running",
      tool: "ask_user_question",
    });
    repository.saveTurn(turn);
    await repository.flush();
    const restored = new ThreadRepository(directory);
    await restored.load();
    const saved = restored.getTurn(thread.id, turn.id);
    assert.equal(saved.state, "failed");
    assert.equal(saved.pendingQuestion, null);
    assert.match(saved.error ?? "", /restarted/);
    assert.equal(saved.toolActivity[0].status, "failed");
    assert.equal(restored.list()[0].activeTurnId, null);
    const again = new ThreadRepository(directory);
    await again.load();
    assert.equal(
      again.get(thread.id).revision,
      restored.get(thread.id).revision
    );
  });
});

test("migration preserves source files and never guesses links between legacy runs and conversations", async () => {
  await withDirectory(async (directory) => {
    const id = crypto.randomUUID();
    const conversationFile = path.join(
      directory,
      "conversations",
      `${id}.json`
    );
    const runsFile = path.join(directory, "runs.json");
    const context = JSON.stringify([
      { content: "Pune", role: "user" },
      {
        content: [{ text: "Remembered", type: "output_text" }],
        role: "assistant",
        status: "completed",
        type: "message",
      },
    ]);
    const runs = JSON.stringify([
      {
        id: "old-run",
        input: "Pune",
        result: "Remembered",
        state: "completed",
      },
    ]);
    await mkdir(path.dirname(conversationFile));
    await writeFile(conversationFile, context);
    await writeFile(runsFile, runs);
    const service = new ThreadService(new ThreadRepository(directory));
    await service.initialize();
    assert.equal(service.list().length, 2);
    assert.equal(service.get(id).turns[0].messages[0].text, "Pune");
    assert.equal(await readFile(conversationFile, "utf8"), context);
    assert.equal(await readFile(runsFile, "utf8"), runs);
    const restored = new ThreadService(new ThreadRepository(directory));
    await restored.initialize();
    assert.equal(restored.list().length, 2);
    assert.equal(restored.get(id).turns.length, 1);
    assert.deepEqual(restored.repository.getContext(id), JSON.parse(context));
  });
});

test("the old renderer transcript migrates once and cannot overwrite new turns", async () => {
  const service = new ThreadService(new ThreadRepository());
  const legacyChat = {
    conversationId: crypto.randomUUID(),
    messages: [
      { id: 1, kind: "user" as const, text: "Hello" },
      { id: 2, kind: "bot" as const, text: "नमस्ते" },
    ],
    runId: "",
  };
  const fresh = await service.restore({ legacyChat });
  assert.equal(fresh.turns.length, 0);
  assert.notEqual(fresh.id, legacyChat.conversationId);
  const restored = await service.select(legacyChat.conversationId);
  assert.deepEqual(
    restored.turns[0].messages.map((message) => message.text),
    ["Hello", "नमस्ते"]
  );
  service.repository.saveTurn(createTurnRecord(restored.id, "New turn"));
  const again = await service.restore({ legacyChat });
  assert.equal(again.turns.length, 2);
  assert.equal(again.turns[1].input, "New turn");
});

test("thread storage rejects path traversal and mismatched ownership", async () => {
  await withDirectory(async (directory) => {
    const repository = new ThreadRepository(directory);
    assert.throws(() => repository.create("Bad", "../../outside"));
    const thread = repository.create();
    repository.saveTurn(createTurnRecord(thread.id, "Hello"));
    await repository.flush();
    const file = path.join(directory, "threads", `${thread.id}.json`);
    const stored = JSON.parse(await readFile(file, "utf8"));
    stored.thread.turns[0].threadId = crypto.randomUUID();
    await writeFile(file, JSON.stringify(stored));
    await assert.rejects(new ThreadRepository(directory).load(), /ownership/);
  });
});

test("renderer migration retains the completed reply linked by its saved run ID", async () => {
  const repository = new ThreadRepository();
  const historical = repository.create("Recovered run");
  const runId = crypto.randomUUID();
  const turn = createTurnRecord(historical.id, "Hello");
  turn.state = "completed";
  turn.result = "नमस्ते";
  repository.saveTurn(turn);
  repository.markLegacySource(historical.id, `run:${runId}`);
  const service = new ThreadService(repository);
  const conversationId = crypto.randomUUID();
  await service.restore({
    legacyChat: {
      conversationId,
      messages: [{ id: 1, kind: "user", text: "Hello" }],
      runId,
    },
  });
  const restored = await service.select(conversationId);
  assert.deepEqual(
    restored.turns[0].messages.map((message) => message.text),
    ["Hello", "नमस्ते"]
  );
  assert.match(JSON.stringify(repository.getContext(restored.id)), /नमस्ते/);
  assert.equal(service.list().length, 3);
});

test("relaunch starts fresh while explicit selection restores saved text and context", async () => {
  await withDirectory(async (directory) => {
    const first = new ThreadService(new ThreadRepository(directory));
    await first.initialize();
    const previous = await first.restore();
    const turn = createTurnRecord(previous.id, "Remember Pune");
    turn.state = "completed";
    first.repository.saveTurn(turn);
    const context = [{ content: "Pune", role: "user" as const }];
    await first.repository.setContext(previous.id, context);
    assert.equal((await first.restore()).id, previous.id);

    const next = new ThreadService(new ThreadRepository(directory));
    await next.initialize();
    const fresh = await next.restore();
    assert.notEqual(fresh.id, previous.id);
    assert.equal(fresh.turns.length, 0);
    assert.deepEqual(next.repository.getContext(fresh.id), []);
    assert.equal(next.get(previous.id).turns[0].input, "Remember Pune");
    assert.equal((await next.restore()).id, fresh.id);
    assert.equal((await next.select(previous.id)).id, previous.id);
    assert.equal((await next.restore()).id, previous.id);
    assert.deepEqual(next.repository.getContext(previous.id), context);
  });
});

test("initialization and selection commands serialize without duplicate startup threads", async () => {
  const repository = new ThreadRepository();
  const history = repository.create("Saved history");
  let finishLoad: () => void = () => undefined;
  const load = vi.spyOn(repository, "load").mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finishLoad = resolve;
      })
  );
  const service = new ThreadService(repository);
  const initializing = service.initialize();
  assert.equal(service.initialize(), initializing);
  const firstRestore = service.restore();
  const secondRestore = service.restore();
  const selecting = service.select(history.id);
  const lastRestore = service.restore();
  await vi.waitFor(() => assert.equal(load.mock.calls.length, 1));
  assert.equal(repository.list().length, 1);
  finishLoad();
  const [first, second, selected, last] = await Promise.all([
    firstRestore,
    secondRestore,
    selecting,
    lastRestore,
  ]);
  assert.equal(first.id, second.id);
  assert.notEqual(first.id, history.id);
  assert.equal(selected.id, history.id);
  assert.equal(last.id, history.id);
  assert.equal(repository.list().length, 2);
  const created = await service.create();
  assert.equal((await service.restore()).id, created.id);
});

test("failed selection or creation preserves the current selection and later commands still work", async () => {
  const repository = new ThreadRepository();
  const service = new ThreadService(repository);
  const selected = await service.restore();
  await assert.rejects(service.select(crypto.randomUUID()), /not found/);
  const flush = vi
    .spyOn(repository, "flush")
    .mockRejectedValueOnce(new Error("Disk full"));
  await assert.rejects(service.create(), /Disk full/);
  assert.equal((await service.restore()).id, selected.id);
  flush.mockRestore();
  const created = await service.create();
  assert.equal((await service.restore()).id, created.id);
});
