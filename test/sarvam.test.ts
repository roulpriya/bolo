import assert from "node:assert/strict";
import { test } from "vitest";
import {
  DEFAULT_TTS_PACE,
  DEFAULT_TTS_SPEAKER,
  normalizeLanguageCode,
  speechLanguage,
  synthesize,
  translateText,
  ttsPace,
  ttsSpeaker,
} from "../src/main/services/sarvam.ts";

test("uses Simran as Bolo's default light female voice", () => {
  assert.equal(DEFAULT_TTS_SPEAKER, "simran");
  assert.equal(ttsSpeaker("SIMRAN"), "simran");
  assert.equal(DEFAULT_TTS_PACE, 1.12);
  assert.equal(ttsPace("1.2"), 1.2);
});

test("rejects a configured voice that is not a supported female Bulbul v3 speaker", () => {
  assert.throws(() => ttsSpeaker("shubh"), /supported female Bulbul v3 voice/);
});

test("sends the selected female voice to Sarvam TTS", async () => {
  process.env.SARVAM_API_KEY = "sarvam_test";
  let request: { options: RequestInit; url: string } | null = null;
  const audio = await synthesize("नमस्ते", {
    fetchImpl: (url, options) => {
      request = { options, url };
      return {
        json: async () => ({
          audios: [Buffer.from("test-audio").toString("base64")],
        }),
        ok: true,
      };
    },
    speaker: "priya",
  });

  assert.equal(request.url, "https://api.sarvam.ai/text-to-speech");
  assert.equal(JSON.parse(request.options.body).speaker, "priya");
  assert.equal(audio.toString(), "test-audio");
});

test("rejects an unsafe Sarvam speech pace", () => {
  assert.throws(() => ttsPace("very-fast"), /between 0.5 and 2/);
  assert.throws(() => ttsPace("2.5"), /between 0.5 and 2/);
});

test("selects Hindi for Devanagari and Indian English otherwise", () => {
  assert.equal(speechLanguage("नमस्ते, reminder set karo"), "hi-IN");
  assert.equal(speechLanguage("Your reminder is ready."), "en-IN");
});

test("normalizes detected BCP-47 language codes", () => {
  assert.equal(normalizeLanguageCode("TA-in"), "ta-IN");
  assert.equal(normalizeLanguageCode("not-a-language"), "en-IN");
});

test("translates text with explicit source and target languages", async () => {
  process.env.SARVAM_API_KEY = "sarvam_test";
  let request: { options: RequestInit; url: string } | null = null;
  const translated = await translateText("Which city?", {
    fetchImpl: (url, options) => {
      request = { options, url };
      return {
        json: async () => ({
          source_language_code: "en-IN",
          translated_text: "कौन सा शहर?",
        }),
        ok: true,
      };
    },
    sourceLanguageCode: "en-IN",
    targetLanguageCode: "hi-IN",
  });
  const body = JSON.parse(request.options.body);
  assert.equal(request.url, "https://api.sarvam.ai/translate");
  assert.equal(body.source_language_code, "en-IN");
  assert.equal(body.target_language_code, "hi-IN");
  assert.equal(body.model, "sarvam-translate:v1");
  assert.equal(translated.text, "कौन सा शहर?");
});
