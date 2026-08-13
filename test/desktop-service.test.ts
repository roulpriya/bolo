import assert from "node:assert/strict";
import { homedir } from "node:os";
import { test } from "vitest";
import {
  DesktopService,
  type SarvamLike,
} from "../src/main/services/desktop-service.ts";
import { RunHistory } from "../src/main/state/run-history.ts";

class FakeAgent {
  browserAvailable() {
    return true;
  }

  createReminder({
    title,
    scheduledFor,
  }: {
    title: string;
    scheduledFor: string;
  }) {
    return { scheduledFor, title };
  }

  execute(
    run: { input: string },
    askUser: (prompt: string, kind: string) => Promise<string>
  ) {
    if (run.input === "ask") {
      return askUser("Which city?", "input").then(
        (answer) => `Using ${answer}.`
      );
    }
    return Promise.resolve(`Completed: ${run.input}`);
  }

  close() {
    return Promise.resolve();
  }
}

class FakeVoice {
  options: unknown;
  chunk: { bytes: Buffer; id: string } | undefined;

  start(options: unknown) {
    this.options = options;
    return { sessionId: "voice-1" };
  }

  sendChunk(id: string, bytes: Buffer) {
    this.chunk = { bytes, id };
  }

  cancel() {
    return Promise.resolve();
  }

  close() {
    return Promise.resolve();
  }
}

function service({ sarvam }: { sarvam?: SarvamLike } = {}) {
  return new DesktopService({
    agentService: new FakeAgent(),
    history: new RunHistory(),
    sarvam: sarvam || {
      synthesize: async () => Buffer.from("audio"),
      translateText: async (text) => ({ text }),
    },
    voiceService: new FakeVoice(),
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

test("uses the user home directory as the default workspace", () => {
  const desktop = new DesktopService({
    agentService: new FakeAgent(),
    history: new RunHistory(),
    voiceService: new FakeVoice(),
  });
  assert.equal(desktop.workspaceDirectory, homedir());
});

test("question tool pauses and resumes the same run", async () => {
  const desktop = service();
  const started = desktop.startAgent("ask");
  await new Promise((resolve) => setImmediate(resolve));
  let run = desktop.getRun(started.id);
  assert.equal(run.state, "waiting_for_user");
  assert.ok(run.pendingQuestion);
  assert.equal(run.pendingQuestion.prompt, "Which city?");

  await desktop.answerRun(started.id, run.pendingQuestion.id, "Pune");
  await new Promise((resolve) => setImmediate(resolve));
  run = desktop.getRun(started.id);
  assert.equal(run.state, "completed");
  assert.equal(run.result, "Using Pune.");
});

test("asks for a reminder title without waiting for the planning model", async () => {
  const desktop = service();
  const started = desktop.startAgent("Set a reminder for 9 PM.");
  await new Promise((resolve) => setImmediate(resolve));
  let run = desktop.getRun(started.id);
  assert.equal(run.state, "waiting_for_user");
  assert.ok(run.pendingQuestion);
  assert.match(
    run.pendingQuestion.prompt,
    /What should I remind you about at 9:00 PM\?/
  );

  await desktop.answerRun(started.id, run.pendingQuestion.id, "Call Maya");
  await new Promise((resolve) => setImmediate(resolve));
  run = desktop.getRun(started.id);
  assert.equal(run.state, "completed");
  assert.match(String(run.result), /Reminder set for 9:00 PM: Call Maya/);
  assert.equal(
    run.toolActivity.find((item) => item.tool === "create_reminder")?.status,
    "completed"
  );
});

test("localizes follow-up questions, typed answers, and final results", async () => {
  const translations: unknown[] = [];
  const desktop = service({
    sarvam: {
      synthesize: async () => Buffer.from("audio"),
      translateText: (text, options) => {
        translations.push({ options, text });
        const outputs = {
          Pune: "Pune",
          "Using Pune.": "पुणे का उपयोग कर रहा हूँ।",
          "Which city?": "कौन सा शहर?",
        };
        return {
          sourceLanguageCode: String(options?.sourceLanguageCode),
          text: outputs[text] || text,
        };
      },
    },
  });
  const started = desktop.startAgent("ask", { languageCode: "hi-IN" });
  await new Promise((resolve) => setImmediate(resolve));
  let run = desktop.getRun(started.id);
  assert.equal(run.languageCode, "hi-IN");
  assert.ok(run.pendingQuestion);
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
    ]
  );
});

test("routes a translated voice command with its detected language", async () => {
  const desktop = service();
  const translatedEvents: Record<string, string>[] = [];
  desktop.on("voice-event", (event) => {
    if (event.type === "translated") {
      translatedEvents.push(event);
    }
  });
  await desktop.commitVoiceTranslation(
    { id: "voice-1", purpose: "command" },
    "Open Notes",
    "mr-IN"
  );
  const translatedEvent = translatedEvents.at(-1);
  assert.ok(translatedEvent);
  const run = desktop.getRun(translatedEvent.runId);
  assert.equal(translatedEvent.languageCode, "mr-IN");
  assert.equal(run.languageCode, "mr-IN");
});

test("rejects stale answers and malformed voice requests", () => {
  const desktop = service();
  assert.throws(
    () => desktop.startVoice({ purpose: "unknown" as any }),
    /purpose/i
  );
  assert.throws(
    () =>
      desktop.startVoice({
        purpose: "answer",
        questionId: "y",
        runId: "x",
      }),
    /no longer waiting/i
  );
  assert.throws(
    () => desktop.sendVoiceChunk("x", new ArrayBuffer(0)),
    /audio/i
  );
});
