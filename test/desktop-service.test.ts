import assert from "node:assert/strict";
import test from "node:test";
import { DesktopService } from "../src/desktop-service.js";
import { RunHistory } from "../src/run-history.js";

class FakeAgent {
  async browserAvailable() {
    return true;
  }

  execute(run, askUser) {
    if (run.input === "ask") {
      return askUser("Which city?", "input").then(
        (answer) => `Using ${answer}.`,
      );
    }
    return Promise.resolve(`Completed: ${run.input}`);
  }

  async close() {}
}

class FakeVoice {
  start(options) {
    this.options = options;
    return { sessionId: "voice-1" };
  }

  sendChunk(id, bytes) {
    this.chunk = { id, bytes };
  }

  cancel() {}
  close() {}
}

function service({ sarvam } = {}) {
  return new DesktopService({
    agentService: new FakeAgent(),
    voiceService: new FakeVoice(),
    history: new RunHistory(),
    sarvam:
      sarvam ||
      {
        translateText: async (text) => ({ text }),
        synthesize: async () => Buffer.from("audio"),
      },
  });
}

test("starts a typed request immediately without a plan or approval token", async () => {
  const desktop = service();
  await desktop.initialize();
  const started = desktop.startAgent("Do the task");
  assert.ok(started.id);
  await new Promise((resolve) => setImmediate(resolve));
  const run = desktop.getRun(started.id);
  assert.equal(run.state, "completed");
  assert.equal(run.result, "Completed: Do the task");
  assert.equal("plan" in run, false);
  assert.equal("approvalToken" in run, false);
});

test("question tool pauses and resumes the same run", async () => {
  const desktop = service();
  const started = desktop.startAgent("ask");
  await new Promise((resolve) => setImmediate(resolve));
  let run = desktop.getRun(started.id);
  assert.equal(run.state, "waiting_for_user");
  assert.equal(run.pendingQuestion.prompt, "Which city?");

  await desktop.answerRun(started.id, run.pendingQuestion.id, "Pune");
  await new Promise((resolve) => setImmediate(resolve));
  run = desktop.getRun(started.id);
  assert.equal(run.state, "completed");
  assert.equal(run.result, "Using Pune.");
});

test("localizes follow-up questions, typed answers, and final results", async () => {
  const translations = [];
  const desktop = service({
    sarvam: {
      translateText: async (text, options) => {
        translations.push({ text, options });
        const outputs = {
          "Which city?": "कौन सा शहर?",
          Pune: "Pune",
          "Using Pune.": "पुणे का उपयोग कर रहा हूँ।",
        };
        return {
          text: outputs[text] || text,
          sourceLanguageCode: options.sourceLanguageCode,
        };
      },
      synthesize: async () => Buffer.from("audio"),
    },
  });
  const started = desktop.startAgent("ask", { languageCode: "hi-IN" });
  await new Promise((resolve) => setImmediate(resolve));
  let run = desktop.getRun(started.id);
  assert.equal(run.languageCode, "hi-IN");
  assert.equal(run.pendingQuestion.prompt, "कौन सा शहर?");

  await desktop.answerRun(started.id, run.pendingQuestion.id, "Pune");
  await new Promise((resolve) => setImmediate(resolve));
  run = desktop.getRun(started.id);
  assert.equal(run.state, "completed");
  assert.equal(run.result, "पुणे का उपयोग कर रहा हूँ।");
  assert.deepEqual(
    translations.map(({ options }) => [
      options.sourceLanguageCode,
      options.targetLanguageCode,
    ]),
    [
      ["en-IN", "hi-IN"],
      ["hi-IN", "en-IN"],
      ["en-IN", "hi-IN"],
    ],
  );
});

test("routes a translated voice command with its detected language", async () => {
  const desktop = service();
  let translatedEvent;
  desktop.on("voice-event", (event) => {
    if (event.type === "translated") translatedEvent = event;
  });
  await desktop.commitVoiceTranslation(
    { id: "voice-1", purpose: "command" },
    "Open Notes",
    "mr-IN",
  );
  const run = desktop.getRun(translatedEvent.runId);
  assert.equal(translatedEvent.languageCode, "mr-IN");
  assert.equal(run.languageCode, "mr-IN");
});

test("rejects stale answers and malformed voice requests", () => {
  const desktop = service();
  assert.throws(() => desktop.startVoice({ purpose: "unknown" }), /purpose/i);
  assert.throws(
    () =>
      desktop.startVoice({
        purpose: "answer",
        runId: "x",
        questionId: "y",
      }),
    /no longer waiting/i,
  );
  assert.throws(() => desktop.sendVoiceChunk("x", new Uint8Array()), /audio/i);
});
