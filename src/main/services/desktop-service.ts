import "../config.ts";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import { homedir } from "node:os";
import path from "node:path";
import {
  AgentService,
  failOpenToolCalls,
  recordToolEnd,
  recordToolStart,
} from "../agent/agent-service.ts";
import { reminderIntent } from "../intents/reminder-intent.ts";
import { permissionStatus } from "../platform/mac.ts";
import { RunHistory } from "../state/run-history.ts";
import { normalizeLanguageCode, synthesize, translateText } from "./sarvam.ts";
import { VoiceService } from "./voice-service.ts";

const MAX_INPUT_LENGTH = 4000;
const MAX_ANSWER_LENGTH = 2000;
const MAX_AUDIO_CHUNK_BYTES = 128 * 1024;
const TERMINAL_STATES = new Set(["completed", "failed", "cancelled"]);

function cleanText(value, maxLength, emptyMessage) {
  const text = String(value || "").trim();
  if (!text) {
    throw new Error(emptyMessage);
  }
  if (text.length > maxLength) {
    throw new Error("The supplied text is too long.");
  }
  return text;
}

function safeError(error) {
  const message = String(error?.message || error || "Something went wrong.");
  return message
    .replace(/(?:sk|key|token|secret)[-_][A-Za-z0-9_-]{12,}/gi, "[redacted]")
    .slice(0, 1000);
}

function publicRun(run) {
  return {
    createdAt: run.createdAt,
    currentTool: run.currentTool || null,
    error: run.error || null,
    finishedAt: run.finishedAt || null,
    id: run.id,
    input: run.input,
    languageCode: run.languageCode,
    pendingQuestion: run.pendingQuestion
      ? {
          id: run.pendingQuestion.id,
          kind: run.pendingQuestion.kind,
          prompt: run.pendingQuestion.prompt,
        }
      : null,
    progress: run.progress || "",
    result: run.result || null,
    state: run.state,
    toolActivity: [...run.toolActivity],
  };
}

/** Main-process boundary for all renderer requests and long-running resources. */
export class DesktopService extends EventEmitter {
  constructor({
    dataDirectory = path.resolve(".bolo"),
    workspaceDirectory = homedir(),
    agentService,
    voiceService,
    history,
    sarvam = { synthesize, translateText },
  } = {}) {
    super();
    this.dataDirectory = dataDirectory;
    this.workspaceDirectory = workspaceDirectory;
    this.runs = new Map();
    this.sarvam = sarvam;
    this.history =
      history ||
      new RunHistory({
        file:
          process.env.NODE_ENV === "test"
            ? null
            : path.join(dataDirectory, "runs.json"),
      });
    this.agent =
      agentService ||
      new AgentService({
        browserProfileDirectory: path.join(dataDirectory, "browser-profile"),
        workspaceDirectory,
      });
    this.voice =
      voiceService ||
      new VoiceService({
        onEvent: (event) => this.emit("voice-event", event),
        onTranslation: (session, transcript, languageCode) =>
          this.commitVoiceTranslation(session, transcript, languageCode),
      });
  }

  async initialize() {
    await this.history.load();
  }

  async health() {
    const localComputerConfigured = await permissionStatus()
      .then((status) => status.accessibilityTrusted === true)
      .catch(() => false);
    return {
      localBrowserConfigured: await this.agent.browserAvailable(),
      localComputerConfigured,
      ok: true,
      openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
      sarvamConfigured: Boolean(process.env.SARVAM_API_KEY),
    };
  }

  startVoice(options = {}) {
    const purpose = options?.purpose;
    if (!["command", "answer"].includes(purpose)) {
      throw new Error("Voice purpose must be command or answer.");
    }
    if (purpose === "answer") {
      const run = this.runs.get(String(options.runId || ""));
      if (
        run?.state !== "waiting_for_user" ||
        run.pendingQuestion?.id !== String(options.questionId || "")
      ) {
        throw new Error("That question is no longer waiting for an answer.");
      }
    } else if (this.activeRun()) {
      throw new Error("Stop the active task before starting another one.");
    }
    return this.voice.start({
      purpose,
      questionId: purpose === "answer" ? String(options.questionId) : null,
      runId: purpose === "answer" ? String(options.runId) : null,
    });
  }

  sendVoiceChunk(sessionId, audio) {
    const bytes = Buffer.from(audio || []);
    if (!bytes.length || bytes.length > MAX_AUDIO_CHUNK_BYTES) {
      throw new Error("Invalid microphone audio chunk.");
    }
    this.voice.sendChunk(String(sessionId || ""), bytes);
  }

  cancelVoice(sessionId) {
    this.voice.cancel(String(sessionId || ""));
    return { ok: true };
  }

  async commitVoiceTranslation(session, transcript, detectedLanguageCode) {
    try {
      const languageCode = normalizeLanguageCode(detectedLanguageCode);
      if (session.purpose === "command") {
        const started = this.startAgent(transcript, { languageCode });
        this.emit("voice-event", {
          languageCode,
          runId: started.id,
          sessionId: session.id,
          transcript,
          type: "translated",
        });
      } else {
        await this.answerRun(session.runId, session.questionId, transcript, {
          alreadyTranslated: true,
        });
        this.emit("voice-event", {
          languageCode,
          questionId: session.questionId,
          runId: session.runId,
          sessionId: session.id,
          transcript,
          type: "translated",
        });
      }
    } catch (error) {
      this.emit("voice-event", {
        error: safeError(error),
        sessionId: session.id,
        type: "failed",
      });
    }
  }

  activeRun() {
    return [...this.runs.values()].find(
      (run) => !TERMINAL_STATES.has(run.state)
    );
  }

  startAgent(input, { languageCode = "en-IN" } = {}) {
    if (this.activeRun()) {
      throw new Error("A task is already running.");
    }
    const text = cleanText(
      input,
      MAX_INPUT_LENGTH,
      "Please say or type a task."
    );
    const run = {
      abortController: new AbortController(),
      createdAt: Date.now(),
      currentTool: null,
      error: null,
      finishedAt: null,
      id: crypto.randomUUID(),
      input: text,
      languageCode: normalizeLanguageCode(languageCode),
      pendingQuestion: null,
      progress: "Starting agent",
      result: null,
      state: "running",
      toolActivity: [],
    };
    this.runs.set(run.id, run);
    this.record(run);

    const reminder = reminderIntent(text);
    const work = reminder
      ? this.runReminder(run, reminder)
      : this.agent.execute(
          run,
          (prompt, kind) => this.askUser(run, prompt, kind),
          (delta) =>
            this.emit("agent-text", {
              delta: String(delta),
              runId: run.id,
            })
        );
    work
      .then(async (result) => {
        if (run.state === "cancelled") {
          return;
        }
        const response = String(result || "The task is complete.");
        run.progress =
          run.languageCode === "en-IN" ? "Complete" : "Translating response";
        run.result = await this.localize(response, run.languageCode);
        if (run.state === "cancelled") {
          return;
        }
        run.state = "completed";
        run.progress = "Complete";
        run.currentTool = null;
        run.finishedAt = Date.now();
        this.record(run);
      })
      .catch((error) => {
        if (run.state === "cancelled") {
          return;
        }
        failOpenToolCalls(run, error);
        run.state = error?.name === "AbortError" ? "cancelled" : "failed";
        run.error =
          error?.name === "AbortError"
            ? "Stopped by the user."
            : safeError(error);
        run.progress = run.state === "cancelled" ? "Stopped" : "Failed";
        run.currentTool = null;
        run.finishedAt = Date.now();
        this.rejectQuestion(run, error);
        this.record(run);
      });

    return { id: run.id };
  }

  async runReminder(run, reminder) {
    const title = await this.askUser(
      run,
      `What should I remind you about at ${reminder.timeLabel}?`,
      "input"
    );
    const details = {
      scheduledFor: reminder.scheduledFor,
      signal: run.abortController.signal,
      title: cleanText(title, 500, "A reminder title is required."),
    };
    const call = {
      arguments: JSON.stringify({
        scheduledFor: details.scheduledFor,
        title: details.title,
      }),
      callId: `reminder:${run.id}`,
      name: "create_reminder",
      type: "function_call",
    };
    recordToolStart(run, { name: "create_reminder" }, call);
    const created = await this.agent.createReminder(details);
    recordToolEnd(run, { name: "create_reminder" }, created, call);
    return `Reminder set for ${reminder.timeLabel}: ${created.title}.`;
  }

  async askUser(run, prompt, kind = "input") {
    if (run.abortController.signal.aborted) {
      return Promise.reject(new DOMException("Aborted", "AbortError"));
    }
    if (run.pendingQuestion) {
      return Promise.reject(
        new Error("The agent already has a pending question.")
      );
    }
    const englishPrompt = cleanText(
      prompt,
      600,
      "The agent asked an empty question."
    );
    run.progress =
      run.languageCode === "en-IN"
        ? "Preparing a question"
        : "Translating question";
    const localizedPrompt = await this.localize(
      englishPrompt,
      run.languageCode
    );
    if (run.abortController.signal.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    const question = {
      id: crypto.randomUUID(),
      kind: kind === "confirmation" ? "confirmation" : "input",
      prompt: localizedPrompt,
      reject: null,
      resolve: null,
    };
    run.state = "waiting_for_user";
    run.progress = "Waiting for your answer";
    run.pendingQuestion = question;
    this.record(run);

    return new Promise((resolve, reject) => {
      question.resolve = resolve;
      question.reject = reject;
      run.abortController.signal.addEventListener(
        "abort",
        () => reject(new DOMException("Aborted", "AbortError")),
        { once: true }
      );
    });
  }

  async answerRun(
    runId,
    questionId,
    answer,
    { alreadyTranslated = false } = {}
  ) {
    const run = this.runs.get(String(runId || ""));
    if (run?.state !== "waiting_for_user" || !run.pendingQuestion) {
      throw new Error("That run is not waiting for an answer.");
    }
    if (run.pendingQuestion.id !== String(questionId || "")) {
      throw new Error("That question is stale or does not belong to this run.");
    }
    let text = cleanText(
      answer,
      MAX_ANSWER_LENGTH,
      "Please answer the question."
    );
    if (!alreadyTranslated && run.languageCode !== "en-IN") {
      const translated = await this.sarvam.translateText(text, {
        sourceLanguageCode: run.languageCode,
        targetLanguageCode: "en-IN",
      });
      ({ text } = translated);
    }
    if (
      run.state !== "waiting_for_user" ||
      run.pendingQuestion?.id !== String(questionId || "")
    ) {
      throw new Error(
        "That question was answered or cancelled while translating."
      );
    }
    const question = run.pendingQuestion;
    run.pendingQuestion = null;
    run.state = "running";
    run.progress = "Continuing";
    this.record(run);
    question.resolve(text);
    return { ok: true };
  }

  getRun(id) {
    const run = this.runs.get(String(id || ""));
    if (!run) {
      const historical = this.history.get(String(id || ""));
      if (historical) {
        return historical;
      }
      throw new Error("Run not found.");
    }
    return publicRun(run);
  }

  stopRun(id) {
    const run = this.runs.get(String(id || ""));
    if (!run) {
      throw new Error("Run not found.");
    }
    if (TERMINAL_STATES.has(run.state)) {
      return { ok: true };
    }
    run.state = "cancelled";
    run.progress = "Stopped";
    run.error = "Stopped by the user.";
    run.finishedAt = Date.now();
    run.abortController.abort();
    this.rejectQuestion(run, new DOMException("Aborted", "AbortError"));
    this.record(run);
    return { ok: true };
  }

  rejectQuestion(run, error) {
    if (!run.pendingQuestion) {
      return;
    }
    const question = run.pendingQuestion;
    run.pendingQuestion = null;
    question.reject?.(error);
  }

  async speech(text, languageCode = "en-IN") {
    const value = cleanText(text, 600, "No response text supplied.");
    return new Uint8Array(
      await this.sarvam.synthesize(value, {
        targetLanguageCode: normalizeLanguageCode(languageCode),
      })
    );
  }

  async localize(text, languageCode) {
    const target = normalizeLanguageCode(languageCode);
    if (target === "en-IN") {
      return text;
    }
    const translated = await this.sarvam.translateText(text, {
      sourceLanguageCode: "en-IN",
      targetLanguageCode: target,
    });
    return translated.text;
  }

  record(run) {
    this.history.set(publicRun(run));
  }

  async close() {
    this.voice.close();
    for (const run of this.runs.values()) {
      if (!TERMINAL_STATES.has(run.state)) {
        this.stopRun(run.id);
      }
    }
    await this.agent.close();
    await this.history.close();
  }
}
