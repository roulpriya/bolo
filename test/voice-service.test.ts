import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { voiceProtocol, VoiceService } from "../src/voice-service.js";

class FakeSocket extends EventEmitter {
  static OPEN = 1;
  readyState = 0;
  sent = [];

  constructor(url, options) {
    super();
    FakeSocket.instance = this;
    this.url = url;
    this.options = options;
  }

  open() {
    this.readyState = 1;
    this.emit("open");
  }

  send(value) {
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
  const events = [];
  const translations = [];
  const voice = new VoiceService({
    WebSocketImpl: FakeSocket,
    onEvent: (event) => events.push(event.type),
    onTranslation: (_session, transcript, languageCode) =>
      translations.push({ transcript, languageCode }),
    startSpeechTimeoutMs: 10_000,
    maxTurnMs: 10_000,
    turnCommitDelayMs: 20,
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
      type: "events",
      data: { signal_type: "START_SPEECH" },
    }),
  );
  FakeSocket.instance.emit(
    "message",
    JSON.stringify({
      type: "events",
      data: { signal_type: "END_SPEECH" },
    }),
  );
  FakeSocket.instance.emit(
    "message",
    JSON.stringify({
      type: "data",
      data: { transcript: "Open", language_code: "hi-IN" },
    }),
  );
  FakeSocket.instance.emit(
    "message",
    JSON.stringify({
      type: "events",
      data: { signal_type: "START_SPEECH" },
    }),
  );
  FakeSocket.instance.emit(
    "message",
    JSON.stringify({
      type: "events",
      data: { signal_type: "END_SPEECH" },
    }),
  );
  FakeSocket.instance.emit(
    "message",
    JSON.stringify({
      type: "data",
      data: { transcript: "Notes", language_code: "hi-IN" },
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(translations, [
    { transcript: "Open Notes", languageCode: "hi-IN" },
  ]);
  assert.ok(events.includes("speech-start"));
  assert.ok(events.includes("closed"));
});

test("recognizes all supported Sarvam event shapes", () => {
  assert.equal(
    voiceProtocol.messageKind({
      type: "events",
      data: { signal_type: "END_SPEECH" },
    }),
    "speech-end",
  );
  assert.equal(
    voiceProtocol.translatedText({
      type: "translation",
      data: { translation: "hello" },
    }),
    "hello",
  );
  assert.equal(
    voiceProtocol.detectedLanguage({
      type: "data",
      data: { transcript: "hello", language_code: "ta-IN" },
    }),
    "ta-IN",
  );
});
