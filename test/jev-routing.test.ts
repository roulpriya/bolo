import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { JevRouting } from "../src/main/services/jev-routing.ts";
import { ThreadRepository } from "../src/main/state/thread-repository.ts";
import { createTurnRecord } from "../src/shared/threads.ts";

function thread() {
  const repository = new ThreadRepository();
  const created = repository.create();
  const turn = createTurnRecord(created.id, "Plan a trip to Pune");
  turn.state = "completed";
  turn.messages.push({
    id: crypto.randomUUID(),
    kind: "result",
    role: "assistant",
    text: "Visit Shaniwar Wada.",
  });
  repository.saveTurn(turn);
  return repository.get(created.id);
}

function answer(
  choice = "continue",
  probabilities = { continue: 0.9, new: 0.06, uncertain: 0.04 }
) {
  return {
    answers: {
      continuation: { choice, confidence: 0.8, probabilities, type: "choice" },
    },
  };
}

function detector(body: unknown, status = 200) {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(JSON.stringify(body), { status }));
  return {
    fetcher,
    routing: new JevRouting({ apiKey: () => "test-key", fetcher }),
  };
}

test("Jev uses the documented Choice contract with only bounded conversation context", async () => {
  const { fetcher, routing } = detector(answer());
  const snapshot = thread();
  snapshot.turns[0].toolActivity.push({
    at: 0,
    detail: "private tool output",
    id: "tool",
    input: "secret tool input",
    kind: "tool_call",
    output: "secret result",
    status: "completed",
    tool: "files",
  });
  const result = await routing.decide(
    snapshot,
    "What about tomorrow?",
    new AbortController().signal
  );
  assert.deepEqual(result, { choice: "continue" });
  const [url, options] = fetcher.mock.calls[0];
  assert.equal(url, "https://api.typesafe.ai/v1/systemone");
  assert.equal(options?.method, "POST");
  assert.equal(
    new Headers(options?.headers).get("Authorization"),
    "Bearer test-key"
  );
  const payload = JSON.parse(String(options?.body));
  assert.equal(payload.questions.continuation.type, "choice");
  assert.deepEqual(Object.keys(payload.questions.continuation.criteria), [
    "continue",
    "new",
    "uncertain",
  ]);
  assert.equal(payload.state.message, "What about tomorrow?");
  assert.match(JSON.stringify(payload.state), /Shaniwar Wada/);
  assert.doesNotMatch(JSON.stringify(payload.state), /secret|private tool/);
});

test("only high probability decisions route automatically, including the threshold boundary", async () => {
  for (const [probability, expected] of [
    [0.85, "new"],
    [0.849, "ask"],
  ] as const) {
    const { routing } = detector(
      answer("new", {
        continue: 1 - probability,
        new: probability,
        uncertain: 0,
      })
    );
    const result = await routing.decide(
      thread(),
      "Set a timer",
      new AbortController().signal
    );
    assert.equal(result.choice, expected);
  }
  const { routing } = detector(
    answer("uncertain", { continue: 0.02, new: 0.01, uncertain: 0.97 })
  );
  assert.deepEqual(
    await routing.decide(thread(), "That one", new AbortController().signal),
    { choice: "ask", reason: "uncertain" }
  );
});

test("missing credentials do not make a request or guess a route", async () => {
  const fetcher = vi.fn<typeof fetch>();
  const routing = new JevRouting({ apiKey: () => "", fetcher });
  assert.deepEqual(
    await routing.decide(thread(), "Hello", new AbortController().signal),
    { choice: "ask", reason: "unconfigured" }
  );
  assert.equal(fetcher.mock.calls.length, 0);
});

test("HTTP errors, malformed answers, and inconsistent probabilities require a choice", async () => {
  const cases = [
    { body: { error: "rate limited" }, status: 429 },
    { body: answer("unrecognized"), status: 200 },
    {
      body: answer("continue", { continue: 0.9, new: 0.8, uncertain: 0 }),
      status: 200,
    },
    { body: answer("new"), status: 200 },
    { body: { answers: { continuation: { choice: "new" } } }, status: 200 },
  ];
  for (const { body, status } of cases) {
    const { routing } = detector(body, status);
    assert.deepEqual(
      await routing.decide(thread(), "Hello", new AbortController().signal),
      { choice: "ask", reason: "unavailable" }
    );
  }
});

test("timeouts offer a manual choice while cancellation aborts the decision", async () => {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(
    (_url, options) =>
      new Promise((_resolve, reject) => {
        const signal = options?.signal;
        assert.ok(signal);
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      })
  );
  const routing = new JevRouting({
    apiKey: () => "test-key",
    fetcher,
    timeoutMs: 10,
  });
  assert.deepEqual(
    await routing.decide(thread(), "Hello", new AbortController().signal),
    { choice: "ask", reason: "unavailable" }
  );
  const abort = new AbortController();
  const pending = routing.decide(thread(), "Hello", abort.signal);
  abort.abort(new Error("Cancelled by user"));
  await assert.rejects(pending, /Cancelled by user/);
});

test("long histories are bounded and include the newest exchange", async () => {
  const snapshot = thread();
  for (let index = 0; index < 10; index += 1) {
    snapshot.turns.push({
      ...snapshot.turns[0],
      id: crypto.randomUUID(),
      input: `${index}: ${"x".repeat(20_000)}`,
    });
  }
  const { fetcher, routing } = detector(answer());
  await routing.decide(snapshot, "Continue", new AbortController().signal);
  const payload = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
  assert.equal(payload.state.recent_turns.length, 4);
  assert.match(payload.state.recent_turns.at(-1).input, /^9:/);
  assert.equal(payload.state.recent_turns.at(-1).input.length, 1500);
});
