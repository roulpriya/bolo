const SARVAM_BASE_URL = "https://api.sarvam.ai";
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

export function speechLanguage(text) {
  return /[\u0900-\u097f]/.test(String(text || "")) ? "hi-IN" : "en-IN";
}

export function ttsSpeaker(
  configuredSpeaker = process.env.SARVAM_TTS_SPEAKER || DEFAULT_TTS_SPEAKER,
) {
  const speaker = String(configuredSpeaker).trim().toLowerCase();
  if (!FEMALE_TTS_SPEAKERS.has(speaker)) {
    throw new Error(
      `SARVAM_TTS_SPEAKER must be a supported female Bulbul v3 voice; received "${speaker}".`,
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

export async function transcribe(buffer, mimeType = "audio/webm") {
  const form = new FormData();
  const extension = mimeType.includes("mp4") ? "m4a" : "webm";
  form.append("file", new Blob([buffer], { type: mimeType }), `bolo.${extension}`);
  form.append("model", "saaras:v3");
  // The supported command naturally mixes Hindi and English words such as
  // “reminder set karo”, so Saaras' code-mixed mode preserves it more reliably.
  form.append("mode", "codemix");

  const response = await fetch(`${SARVAM_BASE_URL}/speech-to-text`, {
    method: "POST",
    headers: { "api-subscription-key": apiKey() },
    body: form,
  });
  if (!response.ok) {
    throw new Error(await errorMessage(response, "Speech could not be understood."));
  }
  const data = await response.json();
  const transcript = data.transcript?.trim();
  if (!transcript) throw new Error("Sarvam returned an empty transcript.");
  return transcript;
}

export async function synthesize(
  text,
  {
    fetchImpl = globalThis.fetch,
    speaker = ttsSpeaker(),
    pace = ttsPace(),
    targetLanguageCode = speechLanguage(text),
  } = {},
) {
  const response = await fetchImpl(`${SARVAM_BASE_URL}/text-to-speech`, {
    method: "POST",
    headers: {
      "api-subscription-key": apiKey(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      target_language_code: targetLanguageCode,
      speaker,
      pace,
      speech_sample_rate: 24000,
      model: "bulbul:v3",
      output_audio_codec: "wav",
    }),
  });
  if (!response.ok) {
    throw new Error(await errorMessage(response, "Spoken response is unavailable."));
  }
  const data = await response.json();
  if (!data.audios?.[0]) throw new Error("Sarvam returned no audio.");
  return Buffer.from(data.audios[0], "base64");
}
