import "../config.ts";
import { EventEmitter } from "node:events";
import { homedir } from "node:os";
import path from "node:path";
import {
  type AnswerQuestionInput,
  ipcArgs,
  type StartTurnInput,
  type VoiceStartOptions,
} from "../../shared/ipc.ts";
import type { VoiceEvent } from "../../shared/sessions.ts";
import { isTerminalTurn, type LegacyChat } from "../../shared/threads.ts";
import { AgentService } from "../agent/agent-service.ts";
import { ThreadRepository } from "../state/thread-repository.ts";
import { McpOAuthService } from "./mcp-oauth.ts";
import { type McpServerInput, McpSettingsService } from "./mcp-settings.ts";
import { normalizeLanguageCode } from "./sarvam.ts";
import { safeError } from "./service-errors.ts";
import { type SarvamLike, SpeechService } from "./speech-service.ts";
import { ThreadService } from "./thread-service.ts";
import { type AgentExecutor, TurnCoordinator } from "./turn-coordinator.ts";
import { VoiceService } from "./voice-service.ts";

const MAX_AUDIO_CHUNK_BYTES = 128 * 1024;

export interface VoiceLike {
  cancel: (sessionId: string) => void;
  close: () => void;
  sendChunk: (sessionId: string, bytes: Buffer) => void;
  start: (options: VoiceStartOptions) => { sessionId: string };
}

/** Electron facade. Conversation ownership lives in the thread and turn services. */
export class DesktopService extends EventEmitter {
  readonly dataDirectory: string;
  readonly workspaceDirectory: string;
  readonly mcpSettings: McpSettingsService;
  readonly mcpOAuth: McpOAuthService;
  readonly agent: AgentExecutor;
  readonly voice: VoiceLike;
  readonly threads: ThreadService;
  readonly turns: TurnCoordinator;
  readonly speechService: SpeechService;
  private activeVoice: {
    id: string;
    options: VoiceStartOptions;
    committed: boolean;
  } | null = null;

  constructor({
    dataDirectory = path.resolve(".bolo"),
    workspaceDirectory = homedir(),
    agentService,
    voiceService,
    repository,
    sarvam,
  }: {
    dataDirectory?: string;
    workspaceDirectory?: string;
    agentService?: AgentExecutor;
    voiceService?: VoiceLike;
    repository?: ThreadRepository;
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
    this.agent =
      agentService ??
      new AgentService({
        browserProfileDirectory: path.join(dataDirectory, "browser-profile"),
        mcpConnectionIssueProvider: (server) =>
          this.mcpOAuth.connectionIssue(server),
        mcpOAuthProvider: (server) => this.mcpOAuth.provider(server),
        mcpServersProvider: () => this.mcpSettings.list(),
        workspaceDirectory,
      });
    this.threads = new ThreadService(
      repository ??
        new ThreadRepository(
          process.env.NODE_ENV === "test" ? null : dataDirectory
        )
    );
    this.speechService = new SpeechService(sarvam);
    this.turns = new TurnCoordinator(
      this.threads.repository,
      this.agent,
      this.speechService,
      (event) => this.emit("thread-event", event)
    );
    this.voice =
      voiceService ??
      new VoiceService({
        onEvent: (event) => this.handleVoiceEvent(event),
        onTranslation: (session, transcript, languageCode) =>
          this.commitVoiceTranslation(session.id, transcript, languageCode),
      });
  }

  async initialize() {
    await this.threads.initialize();
    await this.mcpSettings.ensureDeepWiki();
    await this.mcpOAuth.initialize();
  }

  async health() {
    return {
      localBrowserConfigured: await this.agent.browserAvailable(),
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
  createThread() {
    return this.threads.create();
  }
  listThreads() {
    const threads = this.threads.list();
    const session = this.turns.sessions.active();
    const thread = threads.find((item) => item.id === session?.threadId);
    if (thread && session?.execution) {
      thread.activeTurnId = session.execution.id;
      thread.activeTurnState = "running";
      if (session.execution.state === "waiting_for_user") {
        thread.activeTurnState = "waiting_for_user";
      } else if (isTerminalTurn(session.execution.state)) {
        thread.activeTurnState = "stopping";
      }
    }
    return threads;
  }
  getThread(id: string) {
    return this.threads.get(id);
  }
  selectThread(id: string) {
    return this.threads.select(id);
  }
  restoreThread(options?: { legacyChat?: LegacyChat }) {
    return this.threads.restore(options);
  }

  startTurn(input: StartTurnInput) {
    if (this.activeVoice) {
      throw new Error("Finish or cancel the microphone session first.");
    }
    return this.turns.start(input);
  }

  answerQuestion(input: AnswerQuestionInput) {
    if (this.activeVoice) {
      this.cancelVoiceSession(this.activeVoice.id);
    }
    return this.turns.answer(input);
  }

  getTurn(threadId: string, turnId: string) {
    return this.turns.get(threadId, turnId);
  }

  async cancelTurn(threadId: string, turnId: string) {
    const voice = this.activeVoice;
    if (voice?.options.threadId === threadId) {
      this.cancelVoiceSession(voice.id);
    }
    return await this.turns.cancel(threadId, turnId);
  }

  startVoiceSession(value: VoiceStartOptions) {
    const [options] = ipcArgs.startVoiceSession.parse([value]);
    if (this.activeVoice) {
      throw new Error("A microphone session is already active.");
    }
    this.threads.get(options.threadId);
    if (options.purpose === "answer") {
      this.turns.waiting(options.threadId, options.turnId, options.questionId);
    } else {
      this.turns.assertAvailable();
    }
    const started = this.voice.start(options);
    this.activeVoice = { committed: false, id: started.sessionId, options };
    return started;
  }

  sendVoiceChunk(sessionId: string, audio: ArrayBuffer) {
    if (this.activeVoice?.id !== sessionId) {
      throw new Error("Voice session not found.");
    }
    const bytes = Buffer.from(audio);
    if (!bytes.length || bytes.length > MAX_AUDIO_CHUNK_BYTES) {
      throw new Error("Invalid microphone audio chunk.");
    }
    this.voice.sendChunk(sessionId, bytes);
  }

  cancelVoiceSession(sessionId: string) {
    if (this.activeVoice?.id === sessionId) {
      this.activeVoice = null;
      this.voice.cancel(sessionId);
    }
    return { ok: true as const };
  }

  private handleVoiceEvent(event: VoiceEvent) {
    if (this.activeVoice?.id !== event.sessionId) {
      return;
    }
    if (event.type === "closed" || event.type === "failed") {
      this.activeVoice = null;
    }
    this.emit("voice-event", event);
  }

  async commitVoiceTranslation(
    sessionId: string,
    transcript: string,
    detectedLanguageCode: string
  ) {
    const active = this.activeVoice;
    if (active?.id !== sessionId || active.committed) {
      return;
    }
    active.committed = true;
    const { options } = active;
    try {
      const languageCode = normalizeLanguageCode(detectedLanguageCode);
      let turnId: string;
      if (options.purpose === "command") {
        const started = await this.turns.start(
          { text: transcript, threadId: options.threadId },
          { inputMode: "voice", languageCode }
        );
        ({ turnId } = started);
      } else {
        await this.turns.answer(
          {
            questionId: options.questionId,
            text: transcript,
            threadId: options.threadId,
            turnId: options.turnId,
          },
          true
        );
        ({ turnId } = options);
      }
      if (this.activeVoice !== active) {
        return;
      }
      this.emit("voice-event", {
        languageCode,
        sessionId,
        threadId: options.threadId,
        transcript,
        turnId,
        type: "translated",
      } satisfies VoiceEvent);
    } catch (error) {
      if (this.activeVoice === active) {
        this.emit("voice-event", {
          error: safeError(error),
          sessionId,
          threadId: options.threadId,
          type: "failed",
        } satisfies VoiceEvent);
      }
    } finally {
      if (this.activeVoice === active) {
        this.activeVoice = null;
      }
    }
  }

  speech(text: string, languageCode?: string) {
    return this.speechService.synthesize(text, languageCode);
  }

  async close() {
    this.activeVoice = null;
    this.voice.close();
    await this.turns.close();
    await this.agent.close();
  }
}
