const SARVAM_BASE_URL = "https://api.sarvam.ai";
const LANGUAGE_CODE_PATTERN = /^[a-z]{2,3}-IN$/i;
const DEVANAGARI_PATTERN = /[\u0900-\u097f]/;
const FEMALE_TTS_SPEAKERS = new Set([
  "ritu",
  "priya",
  "neha",
  "pooja",
  "simran",
  "kavya",
  "ishita",
  "shreya",
  "roopa",
  "tanya",
  "shruti",
  "suhani",
  "kavitha",
  "rupali",
]);

export const DEFAULT_TTS_SPEAKER = "simran";
export const DEFAULT_TTS_PACE = 1.12;

export function normalizeLanguageCode(value, fallback = "en-IN") {
  const code = String(value || "").trim();
  if (!LANGUAGE_CODE_PATTERN.test(code)) {
    return fallback;
  }
  const [language] = code.split("-");
  return `${language.toLowerCase()}-IN`;
}

export function speechLanguage(text) {
  return DEVANAGARI_PATTERN.test(String(text || "")) ? "hi-IN" : "en-IN";
}

export function ttsSpeaker(
  configuredSpeaker = process.env.SARVAM_TTS_SPEAKER || DEFAULT_TTS_SPEAKER
) {
  const speaker = String(configuredSpeaker).trim().toLowerCase();
  if (!FEMALE_TTS_SPEAKERS.has(speaker)) {
    throw new Error(
      `SARVAM_TTS_SPEAKER must be a supported female Bulbul v3 voice; received "${speaker}".`
    );
  }
  return speaker;
}

export function ttsPace(configuredPace = process.env.SARVAM_TTS_PACE) {
  const pace =
    configuredPace === undefined || String(configuredPace).trim() === ""
      ? DEFAULT_TTS_PACE
      : Number(configuredPace);
  if (!Number.isFinite(pace) || pace < 0.5 || pace > 2) {
    throw new Error("SARVAM_TTS_PACE must be a number between 0.5 and 2.");
  }
  return pace;
}

function apiKey() {
  if (!process.env.SARVAM_API_KEY) {
    throw new Error("SARVAM_API_KEY is not configured.");
  }
  return process.env.SARVAM_API_KEY;
}

async function errorMessage(response, fallback) {
  const body = await response.text();
  try {
    const parsed = JSON.parse(body);
    return parsed.error?.message || parsed.message || fallback;
  } catch {
    return body.slice(0, 240) || fallback;
  }
}

export async function translateText(
  input,
  {
    sourceLanguageCode = "auto",
    targetLanguageCode = "en-IN",
    fetchImpl = globalThis.fetch,
  } = {}
) {
  const text = String(input || "").trim();
  if (!text) {
    throw new Error("No text supplied for translation.");
  }
  if (text.length > 2000) {
    throw new Error("Sarvam translation input exceeds 2,000 characters.");
  }
  const target = normalizeLanguageCode(targetLanguageCode);
  const source =
    sourceLanguageCode === "auto"
      ? "auto"
      : normalizeLanguageCode(sourceLanguageCode);
  if (source !== "auto" && source === target) {
    return { sourceLanguageCode: source, text };
  }

  const response = await fetchImpl(`${SARVAM_BASE_URL}/translate`, {
    body: JSON.stringify({
      input: text,
      mode: "formal",
      model: source === "auto" ? "mayura:v1" : "sarvam-translate:v1",
      source_language_code: source,
      target_language_code: target,
    }),
    headers: {
      "api-subscription-key": apiKey(),
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(await errorMessage(response, "Text translation failed."));
  }
  const data = await response.json();
  const translated = String(data.translated_text || "").trim();
  if (!translated) {
    throw new Error("Sarvam returned an empty translation.");
  }
  return {
    sourceLanguageCode: normalizeLanguageCode(
      data.source_language_code,
      source
    ),
    text: translated,
  };
}

export async function synthesize(
  text,
  {
    fetchImpl = globalThis.fetch,
    speaker = ttsSpeaker(),
    pace = ttsPace(),
    targetLanguageCode = speechLanguage(text),
  } = {}
) {
  const response = await fetchImpl(`${SARVAM_BASE_URL}/text-to-speech`, {
    body: JSON.stringify({
      model: "bulbul:v3",
      output_audio_codec: "wav",
      pace,
      speaker,
      speech_sample_rate: 24_000,
      target_language_code: normalizeLanguageCode(targetLanguageCode),
      text,
    }),
    headers: {
      "api-subscription-key": apiKey(),
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(
      await errorMessage(response, "Spoken response is unavailable.")
    );
  }
  const data = await response.json();
  if (!data.audios?.[0]) {
    throw new Error("Sarvam returned no audio.");
  }
  return Buffer.from(data.audios[0], "base64");
}
