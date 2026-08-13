import "../config.ts";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import { homedir } from "node:os";
import path from "node:path";
import type { VoiceStartOptions } from "../../shared/ipc.ts";
import {
  AgentService,
  failOpenToolCalls,
  recordToolEnd,
  recordToolStart,
} from "../agent/agent-service.ts";
import type { PendingQuestion, Run } from "../agent/run.ts";
import { reminderIntent } from "../intents/reminder-intent.ts";
import { permissionStatus } from "../platform/mac.ts";
import { RunHistory } from "../state/run-history.ts";
import { McpOAuthService } from "./mcp-oauth.ts";
import type { McpServerInput } from "./mcp-settings.ts";
import { McpSettingsService } from "./mcp-settings.ts";
import { normalizeLanguageCode, synthesize, translateText } from "./sarvam.ts";
import { VoiceService } from "./voice-service.ts";

const MAX_INPUT_LENGTH = 4000;
const MAX_ANSWER_LENGTH = 2000;
const MAX_AUDIO_CHUNK_BYTES = 128 * 1024;
const TERMINAL_STATES: ReadonlySet<Run["state"]> = new Set([
  "completed",
  "failed",
  "cancelled",
]);

function cleanText(value: unknown, maxLength: number, emptyMessage: string) {
  const text = String(value || "").trim();
  if (!text) {
    throw new Error(emptyMessage);
  }
  if (text.length > maxLength) {
    throw new Error("The supplied text is too long.");
  }
  return text;
}

function safeError(error: unknown) {
  const message = String(
    (error instanceof Error ? error.message : error) || "Something went wrong."
  );
  return message
    .replace(/(?:sk|key|token|secret)[-_][A-Za-z0-9_-]{12,}/gi, "[redacted]")
    .slice(0, 1000);
}

// A plain function call, not an inline comparison: `run.state` can change
// concurrently (e.g. via stopRun) while an `await` above is pending, so this
// must be re-read rather than trusted from an earlier narrowing.
function isCancelled(run: Run) {
  return run.state === "cancelled";
}

function publicRun(run: Run) {
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

type PublicRun = ReturnType<typeof publicRun>;

type MaybePromise<T> = Promise<T> | T;

export interface AgentLike {
  browserAvailable: () => boolean;
  close: () => Promise<void>;
  createReminder: (details: {
    title: string;
    scheduledFor: string;
    signal?: AbortSignal;
  }) => MaybePromise<{ title: string }>;
  execute: (
    run: Run,
    askUser: (prompt: string, kind: string) => Promise<string>,
    onTextDelta?: (delta: string) => void
  ) => Promise<unknown>;
}

export interface VoiceLike {
  cancel: (sessionId: string) => void;
  close: () => void;
  sendChunk: (sessionId: string, bytes: Buffer) => void;
  start: (options: VoiceStartOptions) => { sessionId: string };
}

export interface SarvamLike {
  synthesize: (
    text: string,
    options?: Record<string, unknown>
  ) => MaybePromise<Buffer>;
  translateText: (
    text: string,
    options?: Record<string, unknown>
  ) => MaybePromise<{ sourceLanguageCode?: string; text: string }>;
}

/** Main-process boundary for all renderer requests and long-running resources. */
export class DesktopService extends EventEmitter {
  dataDirectory: string;
  workspaceDirectory: string;
  mcpSettings: McpSettingsService;
  mcpOAuth: McpOAuthService;
  runs: Map<string, Run>;
  sarvam: SarvamLike;
  history: RunHistory<PublicRun>;
  agent: AgentLike;
  voice: VoiceLike;

  constructor({
    dataDirectory = path.resolve(".bolo"),
    workspaceDirectory = homedir(),
    agentService,
    voiceService,
    history,
    sarvam = { synthesize, translateText },
  }: {
    dataDirectory?: string;
    workspaceDirectory?: string;
    agentService?: AgentLike;
    voiceService?: VoiceLike;
    history?: RunHistory<PublicRun>;
    sarvam?: SarvamLike;
  } = {}) {
    super();
    this.dataDirectory = dataDirectory;
    this.workspaceDirectory = workspaceDirectory;
    this.mcpSettings = new McpSettingsService(dataDirectory);
    this.mcpOAuth = new McpOAuthService({
      dataDirectory,
      openExternal: async (url) => {
        const { shell } = await import("electron");
        await shell.openExternal(url);
      },
    });
    this.runs = new Map();
    this.sarvam = sarvam;
    this.history =
      history ||
      new RunHistory<PublicRun>({
        file:
          process.env.NODE_ENV === "test"
            ? null
            : path.join(dataDirectory, "runs.json"),
      });
    this.agent =
      agentService ||
      new AgentService({
        browserProfileDirectory: path.join(dataDirectory, "browser-profile"),
        mcpConnectionIssueProvider: (server) =>
          this.mcpOAuth.connectionIssue(server),
        mcpOAuthProvider: (server) => this.mcpOAuth.provider(server),
        mcpServersProvider: () => this.mcpSettings.list(),
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
    await this.mcpSettings.ensureDeepWiki();
    await this.mcpOAuth.initialize();
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

  getMcpServers() {
    return this.mcpSettings.list();
  }

  saveMcpServers(servers: McpServerInput[]) {
    return this.mcpSettings.save(servers);
  }

  async startMcpOAuth(id: string) {
    const server = (await this.mcpSettings.list()).find(
      (item) => item.id === id
    );
    if (!server || server.transport === "stdio") {
      throw new Error("Choose a remote MCP server before connecting OAuth.");
    }
    try {
      const result = await this.mcpOAuth.start(server);
      return { status: result === "AUTHORIZED" ? "connected" : "pending" };
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("does not support dynamic client registration")
      ) {
        throw new Error(
          "This MCP server requires a pre-registered OAuth client. Add its OAuth client ID and secret, save the settings, and try again.",
          { cause: error }
        );
      }
      throw error;
    }
  }

  completeMcpOAuth(callbackUrl: string) {
    return this.mcpOAuth.complete(callbackUrl);
  }

  startVoice(options: Partial<VoiceStartOptions> = {}) {
    const { purpose } = options;
    if (purpose !== "command" && purpose !== "answer") {
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
      questionId: purpose === "answer" ? String(options.questionId) : undefined,
      runId: purpose === "answer" ? String(options.runId) : undefined,
    });
  }

  sendVoiceChunk(sessionId: string, audio: ArrayBuffer) {
    const bytes = Buffer.from(audio ?? new ArrayBuffer(0));
    if (!bytes.length || bytes.length > MAX_AUDIO_CHUNK_BYTES) {
      throw new Error("Invalid microphone audio chunk.");
    }
    this.voice.sendChunk(String(sessionId || ""), bytes);
  }

  cancelVoice(sessionId: string) {
    this.voice.cancel(String(sessionId || ""));
    return { ok: true };
  }

  async commitVoiceTranslation(
    session: {
      purpose?: string;
      id: string;
      runId?: string;
      questionId?: string;
    },
    transcript: string,
    detectedLanguageCode: string
  ) {
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
        await this.answerRun(
          String(session.runId),
          String(session.questionId),
          transcript,
          { alreadyTranslated: true }
        );
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

  startAgent(
    input: string,
    { languageCode = "en-IN" }: { languageCode?: string } = {}
  ) {
    if (this.activeRun()) {
      throw new Error("A task is already running.");
    }
    const text = cleanText(
      input,
      MAX_INPUT_LENGTH,
      "Please say or type a task."
    );
    const run: Run = {
      abortController: new AbortController(),
      createdAt: Date.now(),
      currentTool: null,
      error: null,
      finishedAt: null,
      id: crypto.randomUUID(),
      input: text,
      languageCode: normalizeLanguageCode(languageCode),
      pendingQuestion: null,
      progress: "Working",
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
        if (isCancelled(run)) {
          return;
        }
        const response = String(result || "The task is complete.");
        run.progress =
          run.languageCode === "en-IN" ? "Complete" : "Translating response";
        run.result = await this.localize(response, run.languageCode);
        if (isCancelled(run)) {
          return;
        }
        run.state = "completed";
        run.progress = "Complete";
        run.currentTool = null;
        run.finishedAt = Date.now();
        this.record(run);
      })
      .catch((error) => {
        if (isCancelled(run)) {
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

  async runReminder(
    run: Run,
    reminder: { scheduledFor: string; timeLabel: string; title: string | null }
  ) {
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

  async askUser(run: Run, prompt: string, kind = "input") {
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
    const question: PendingQuestion = {
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

    return new Promise<string>((resolve, reject) => {
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
    runId: string,
    questionId: string,
    answer: string,
    { alreadyTranslated = false }: { alreadyTranslated?: boolean } = {}
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
    question.resolve?.(text);
    return { ok: true };
  }

  getRun(id: string) {
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

  stopRun(id: string) {
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

  rejectQuestion(run: Run, error: unknown) {
    if (!run.pendingQuestion) {
      return;
    }
    const question = run.pendingQuestion;
    run.pendingQuestion = null;
    question.reject?.(error);
  }

  async speech(text: string, languageCode = "en-IN") {
    const value = cleanText(text, 600, "No response text supplied.");
    return new Uint8Array(
      await this.sarvam.synthesize(value, {
        targetLanguageCode: normalizeLanguageCode(languageCode),
      })
    );
  }

  async localize(text: string, languageCode: string) {
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

  record(run: Run) {
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
