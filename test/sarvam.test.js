import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_TTS_SPEAKER,
  DEFAULT_TTS_PACE,
  synthesize,
  speechLanguage,
  ttsPace,
  ttsSpeaker,
} from "../src/sarvam.js";

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
  let request;
  const audio = await synthesize("नमस्ते", {
    speaker: "priya",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        json: async () => ({
          audios: [Buffer.from("test-audio").toString("base64")],
        }),
      };
    },
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
