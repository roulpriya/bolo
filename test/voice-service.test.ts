import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "vitest";
import {
  VoiceService,
  voiceProtocol,
} from "../src/main/services/voice-service.ts";

class FakeSocket extends EventEmitter {
  static OPEN = 1;
  static instance: FakeSocket;

  readyState = 0;
  sent: any[] = [];
  url: string;
  options: unknown;

  constructor(url: string, options: unknown) {
    super();
    FakeSocket.instance = this;
    this.url = url;
    this.options = options;
  }

  open() {
    this.readyState = 1;
    this.emit("open");
  }

  send(value: string) {
    this.sent.push(JSON.parse(value));
  }

  close() {
    this.readyState = 3;
    this.emit("close");
  }

  terminate() {
    this.close();
  }
}

test("uses the normal Sarvam VAD boundary for natural speaking pauses", () => {
  const url = new URL(voiceProtocol.streamUrl());
  assert.equal(url.protocol, "wss:");
  assert.equal(url.searchParams.get("model"), "saaras:v3");
  assert.equal(url.searchParams.get("mode"), "translate");
  assert.equal(url.searchParams.get("input_audio_codec"), "pcm_s16le");
  assert.equal(url.searchParams.get("high_vad_sensitivity"), "false");
  assert.equal(url.searchParams.get("vad_signals"), "true");
});

test("accumulates speech across a brief pause and commits exactly once", async () => {
  process.env.SARVAM_API_KEY = "sarvam_test";
  const events: string[] = [];
  const translations: Array<{ languageCode: string; transcript: string }> = [];
  const voice = new VoiceService({
    maxTurnMs: 10_000,
    onEvent: (event) => events.push(event.type),
    onTranslation: (_session, transcript, languageCode) => {
      translations.push({ languageCode, transcript });
    },
    startSpeechTimeoutMs: 10_000,
    turnCommitDelayMs: 20,
    WebSocketImpl: FakeSocket,
  });
  const { sessionId } = voice.start({ purpose: "command" });
  voice.sendChunk(sessionId, Buffer.from([1, 2]));
  assert.equal(FakeSocket.instance.sent.length, 0);
  FakeSocket.instance.open();
  assert.equal(FakeSocket.instance.sent[0].audio.sample_rate, "16000");
  assert.equal(FakeSocket.instance.sent[0].audio.data, "AQI=");

  FakeSocket.instance.emit(
    "message",
    JSON.stringify({
      data: { signal_type: "START_SPEECH" },
      type: "events",
    })
  );
  FakeSocket.instance.emit(
    "message",
    JSON.stringify({
      data: { signal_type: "END_SPEECH" },
      type: "events",
    })
  );
  FakeSocket.instance.emit(
    "message",
    JSON.stringify({
      data: { language_code: "hi-IN", transcript: "Open" },
      type: "data",
    })
  );
  FakeSocket.instance.emit(
    "message",
    JSON.stringify({
      data: { signal_type: "START_SPEECH" },
      type: "events",
    })
  );
  FakeSocket.instance.emit(
    "message",
    JSON.stringify({
      data: { signal_type: "END_SPEECH" },
      type: "events",
    })
  );
  FakeSocket.instance.emit(
    "message",
    JSON.stringify({
      data: { language_code: "hi-IN", transcript: "Notes" },
      type: "data",
    })
  );
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(translations, [
    { languageCode: "hi-IN", transcript: "Open Notes" },
  ]);
  assert.ok(events.includes("speech-start"));
  assert.ok(events.includes("closed"));
});

test("recognizes all supported Sarvam event shapes", () => {
  assert.equal(
    voiceProtocol.messageKind({
      data: { signal_type: "END_SPEECH" },
      type: "events",
    }),
    "speech-end"
  );
  assert.equal(
    voiceProtocol.translatedText({
      data: { translation: "hello" },
      type: "translation",
    }),
    "hello"
  );
  assert.equal(
    voiceProtocol.detectedLanguage({
      data: { language_code: "ta-IN", transcript: "hello" },
      type: "data",
    }),
    "ta-IN"
  );
});
