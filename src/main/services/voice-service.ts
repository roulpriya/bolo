import crypto from "node:crypto";
import type { EventEmitter } from "node:events";
import WebSocket from "ws";
import type { VoiceStartOptions } from "../../shared/ipc.ts";
import type { VoiceEvent } from "../../shared/sessions.ts";

interface SocketLike extends EventEmitter {
  close: (code?: number, reason?: string) => void;
  readyState: number;
  send: (data: string) => void;
  terminate?: () => void;
}

// `ws`'s real constructor options type is stricter than what tests need to
// pass a fake socket implementation, and the options are only ever forwarded
// opaquely, never read here.
type SocketImplCtor = {
  // biome-ignore lint/suspicious/noExplicitAny: see comment above
  new (url: string, options?: any): SocketLike;
} & {
  OPEN: number;
};

type VoiceSession = VoiceStartOptions & {
  audioBytes: number;
  closed: boolean;
  commitTimer: NodeJS.Timeout | null;
  committed: boolean;
  heardSpeech: boolean;
  id: string;
  inSpeech: boolean;
  languageCode: string;
  pendingChunks: Buffer[];
  socket: SocketLike | null;
  timers: Set<NodeJS.Timeout>;
  transcripts: string[];
};

const SARVAM_STREAM_URL = "wss://api.sarvam.ai/speech-to-text/ws";
const START_SPEECH_TIMEOUT_MS = 15_000;
const MAX_TURN_MS = 60_000;
const MAX_SESSION_AUDIO_BYTES = 4 * 1024 * 1024;
const TURN_COMMIT_DELAY_MS = 700;
const noop = () => undefined;

function apiKey() {
  if (!process.env.SARVAM_API_KEY) {
    throw new Error("SARVAM_API_KEY is not configured.");
  }
  return process.env.SARVAM_API_KEY;
}

function streamUrl() {
  const url = new URL(SARVAM_STREAM_URL);
  url.searchParams.set("model", "saaras:v3");
  url.searchParams.set("mode", "translate");
  url.searchParams.set("sample_rate", "16000");
  url.searchParams.set("input_audio_codec", "pcm_s16le");
  // The high-sensitivity preset finalizes after roughly 64 ms of silence,
  // which splits ordinary pauses inside a sentence. The normal preset waits
  // roughly one second; an additional local grace period below lets the user
  // resume after a natural pause without starting the agent.
  url.searchParams.set("high_vad_sensitivity", "false");
  url.searchParams.set("vad_signals", "true");
  return url.toString();
}

function messageKind(message) {
  const direct = String(message?.type || "").toLowerCase();
  const signal = String(message?.data?.signal_type || "").toLowerCase();
  if (direct === "speech_start" || signal === "start_speech") {
    return "speech-start";
  }
  if (direct === "speech_end" || signal === "end_speech") {
    return "speech-end";
  }
  if (
    direct === "data" ||
    direct === "translation" ||
    typeof message?.data?.transcript === "string" ||
    typeof message?.data?.translation === "string"
  ) {
    return "translation";
  }
  return null;
}

function translatedText(message) {
  return String(
    message?.data?.translation ||
      message?.data?.transcript ||
      message?.translation ||
      message?.transcript ||
      ""
  ).trim();
}

function detectedLanguage(message) {
  return String(
    message?.data?.language_code ||
      message?.data?.source_language_code ||
      message?.language_code ||
      message?.source_language_code ||
      ""
  ).trim();
}

export class VoiceService {
  WebSocketImpl: SocketImplCtor;
  onEvent: (event: VoiceEvent) => void;
  onTranslation: (
    session: VoiceSession,
    transcript: string,
    languageCode: string
  ) => void | Promise<void>;
  startSpeechTimeoutMs: number;
  maxTurnMs: number;
  turnCommitDelayMs: number;
  session: VoiceSession | null;

  constructor({
    WebSocketImpl = WebSocket as unknown as SocketImplCtor,
    onEvent = noop,
    onTranslation = noop,
    startSpeechTimeoutMs = START_SPEECH_TIMEOUT_MS,
    maxTurnMs = MAX_TURN_MS,
    turnCommitDelayMs = TURN_COMMIT_DELAY_MS,
  }: {
    WebSocketImpl?: SocketImplCtor;
    onEvent?: (event: VoiceEvent) => void;
    onTranslation?: (
      session: VoiceSession,
      transcript: string,
      languageCode: string
    ) => void | Promise<void>;
    startSpeechTimeoutMs?: number;
    maxTurnMs?: number;
    turnCommitDelayMs?: number;
  } = {}) {
    this.WebSocketImpl = WebSocketImpl;
    this.onEvent = onEvent;
    this.onTranslation = onTranslation;
    this.startSpeechTimeoutMs = startSpeechTimeoutMs;
    this.maxTurnMs = maxTurnMs;
    this.turnCommitDelayMs = turnCommitDelayMs;
    this.session = null;
  }

  start(options: VoiceStartOptions) {
    if (this.session) {
      throw new Error("A microphone session is already active.");
    }
    const session: VoiceSession = {
      id: crypto.randomUUID(),
      ...options,
      audioBytes: 0,
      closed: false,
      commitTimer: null,
      committed: false,
      heardSpeech: Boolean(false),
      inSpeech: false,
      languageCode: "",
      pendingChunks: [],
      socket: null,
      timers: new Set(),
      transcripts: [],
    };
    const socket = new this.WebSocketImpl(streamUrl(), {
      headers: { "Api-Subscription-Key": apiKey() },
    });
    this.session = session;
    session.socket = socket;
    socket.on("open", () => {
      if (!this.isActive(session.id)) {
        return;
      }
      for (const bytes of session.pendingChunks.splice(0)) {
        this.sendAudio(session, bytes);
      }
      this.emit(session, "ready");
      this.addTimer(session, this.startSpeechTimeoutMs, () => {
        if (!session.heardSpeech) {
          this.fail(session, "No speech was detected.");
        }
      });
    });
    socket.on("message", (raw) => this.receive(session, raw));
    socket.on("error", (error) => {
      this.fail(session, `Voice connection failed: ${error.message}`);
    });
    socket.on("close", () => this.finishClose(session));
    this.addTimer(session, this.maxTurnMs, () => {
      this.fail(session, "The voice turn was too long.");
    });
    return { sessionId: session.id };
  }

  addTimer(session: VoiceSession, delay: number, callback: () => void) {
    const timer = setTimeout(() => {
      session.timers.delete(timer);
      callback();
    }, delay);
    session.timers.add(timer);
    return timer;
  }

  clearCommitTimer(session: VoiceSession) {
    if (!session.commitTimer) {
      return;
    }
    clearTimeout(session.commitTimer);
    session.timers.delete(session.commitTimer);
    session.commitTimer = null;
  }

  scheduleCommit(session: VoiceSession) {
    if (
      session.inSpeech ||
      !session.transcripts.length ||
      session.committed ||
      session.closed
    ) {
      return;
    }
    this.clearCommitTimer(session);
    session.commitTimer = this.addTimer(session, this.turnCommitDelayMs, () => {
      session.commitTimer = null;
      this.commitTranslation(session);
    });
  }

  commitTranslation(session: VoiceSession) {
    if (
      !this.isActive(session.id) ||
      session.committed ||
      session.inSpeech ||
      !session.transcripts.length
    ) {
      return;
    }
    session.committed = true;
    const transcript = session.transcripts.join(" ").trim();
    Promise.resolve()
      .then(() => this.onTranslation(session, transcript, session.languageCode))
      .catch((error) => {
        this.emit(session, "failed", {
          error: String(error?.message || error).slice(0, 600),
        });
      })
      .finally(() => {
        this.closeSocket(session);
      });
  }

  isActive(id: string) {
    const { session } = this;
    return session?.id === id && !session.closed;
  }

  sendChunk(sessionId: string, bytes: Buffer) {
    const { session } = this;
    if (!session || session.id !== sessionId || session.closed) {
      throw new Error("Voice session not found.");
    }
    session.audioBytes += bytes.length;
    if (session.audioBytes > MAX_SESSION_AUDIO_BYTES) {
      this.fail(session, "The voice turn was too large.");
      return;
    }
    if (session.socket?.readyState !== this.WebSocketImpl.OPEN) {
      session.pendingChunks.push(Buffer.from(bytes));
      return;
    }
    this.sendAudio(session, bytes);
  }

  sendAudio(session: VoiceSession, bytes: Buffer) {
    session.socket?.send(
      JSON.stringify({
        audio: {
          data: bytes.toString("base64"),
          encoding: "audio/wav",
          sample_rate: "16000",
        },
      })
    );
  }

  receive(session: VoiceSession, raw: { toString: () => string }) {
    if (!this.isActive(session.id) || session.committed) {
      return;
    }
    let message: unknown = null;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }
    const kind = messageKind(message);
    if (kind === "speech-start") {
      session.heardSpeech = true;
      session.inSpeech = true;
      this.clearCommitTimer(session);
      this.emit(session, "speech-start");
      return;
    }
    if (kind === "speech-end") {
      session.inSpeech = false;
      this.emit(session, "speech-end");
      this.scheduleCommit(session);
      return;
    }
    if (kind !== "translation") {
      return;
    }
    const transcript = translatedText(message);
    if (!transcript) {
      return;
    }
    session.transcripts.push(transcript);
    session.languageCode = detectedLanguage(message) || session.languageCode;
    this.scheduleCommit(session);
  }

  emit(
    session: VoiceSession,
    type: VoiceEvent["type"],
    extra: Partial<VoiceEvent> = {}
  ) {
    this.onEvent({
      sessionId: session.id,
      threadId: session.threadId,
      type,
      ...extra,
    });
  }

  fail(session: VoiceSession, error: unknown) {
    if (!this.isActive(session.id) || session.committed) {
      return;
    }
    session.committed = true;
    this.clearCommitTimer(session);
    this.emit(session, "failed", { error: String(error).slice(0, 600) });
    this.closeSocket(session);
  }

  cancel(sessionId: string) {
    const { session } = this;
    if (!session || session.id !== sessionId) {
      throw new Error("Voice session not found.");
    }
    session.committed = true;
    this.clearCommitTimer(session);
    this.closeSocket(session);
  }

  closeSocket(session: VoiceSession) {
    const { socket } = session;
    if (socket?.readyState === this.WebSocketImpl.OPEN) {
      socket.close(1000, "complete");
    } else {
      socket?.terminate?.();
    }
    this.finishClose(session);
  }

  finishClose(session: VoiceSession) {
    if (session.closed) {
      return;
    }
    session.closed = true;
    for (const timer of session.timers) {
      clearTimeout(timer);
    }
    session.timers.clear();
    if (this.session?.id === session.id) {
      this.session = null;
    }
    this.emit(session, "closed");
  }

  close() {
    if (this.session) {
      this.session.committed = true;
      this.closeSocket(this.session);
    }
  }
}

export const voiceProtocol = {
  detectedLanguage,
  messageKind,
  streamUrl,
  translatedText,
};
