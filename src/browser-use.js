const DEFAULT_BASE_URL = "https://api.browser-use.com/api/v3";
const TERMINAL_STATUSES = new Set(["stopped", "timed_out", "error"]);

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function apiError(response, body) {
  const detail =
    typeof body?.detail === "string"
      ? body.detail
      : body?.detail?.[0]?.msg || body?.message || response.statusText;
  return new Error(`Browser Use API request failed (${response.status}): ${detail}`);
}

export function buildYouTubeSearchUrl(query) {
  const value = String(query || "").trim();
  if (!value || value.length > 500) {
    throw new Error("A YouTube search query between 1 and 500 characters is required.");
  }
  const url = new URL("https://www.youtube.com/results");
  url.searchParams.set("search_query", value);
  return url.toString();
}

export async function resolveYouTubeVideoFast(
  query,
  { fetchImpl = globalThis.fetch, signal } = {},
) {
  const url = buildYouTubeSearchUrl(query);
  const response = await fetchImpl(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      "Accept-Language": "en-IN,en;q=0.9,hi;q=0.8",
    },
    signal,
  });
  if (!response.ok) {
    throw new Error(`YouTube search failed (${response.status}).`);
  }
  const html = await response.text();
  const match = html.match(
    /"videoRenderer":\{"videoId":"([A-Za-z0-9_-]{11})"/,
  );
  if (!match) throw new Error("YouTube returned no playable video result.");
  const nearby = html.slice(match.index, match.index + 2_500);
  const titleMatch = nearby.match(
    /"title":\{"runs":\[\{"text":"((?:\\.|[^"])*)"/,
  );
  let title = String(query).trim();
  if (titleMatch) {
    try {
      title = JSON.parse(`"${titleMatch[1]}"`);
    } catch {
      // The query remains a safe fallback title.
    }
  }
  return {
    videoUrl: `https://www.youtube.com/watch?v=${match[1]}`,
    videoTitle: title,
  };
}

export class BrowserUseClient {
  constructor({
    apiKey = process.env.BROWSER_USE_API_KEY,
    baseUrl = process.env.BROWSER_USE_API_URL || DEFAULT_BASE_URL,
    fetchImpl = globalThis.fetch,
    pollIntervalMs = 1500,
  } = {}) {
    if (!apiKey) throw new Error("BROWSER_USE_API_KEY is not configured.");
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.fetch = fetchImpl;
    this.pollIntervalMs = pollIntervalMs;
  }

  async request(path, options = {}) {
    const response = await this.fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        "X-Browser-Use-API-Key": this.apiKey,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw apiError(response, body);
    return body;
  }

  createTask({ task, profileId, outputSchema, model, maxCostUsd }) {
    return this.request("/sessions", {
      method: "POST",
      body: JSON.stringify({
        task,
        keepAlive: false,
        enableRecording: false,
        ...(profileId ? { profileId } : {}),
        ...(outputSchema ? { outputSchema } : {}),
        ...(model ? { model } : {}),
        ...(maxCostUsd ? { maxCostUsd } : {}),
      }),
    });
  }

  getSession(sessionId) {
    return this.request(`/sessions/${encodeURIComponent(sessionId)}`);
  }

  stopSession(sessionId) {
    return this.request(`/sessions/${encodeURIComponent(sessionId)}/stop`, {
      method: "POST",
      body: JSON.stringify({ strategy: "session" }),
    });
  }

  async runTask(options, { signal, onUpdate } = {}) {
    const created = await this.createTask(options);
    const sessionId = created.id;
    if (!sessionId) throw new Error("Browser Use did not return a session id.");
    onUpdate?.(created);

    const stopRemoteSession = () => {
      this.stopSession(sessionId).catch(() => {});
    };
    signal?.addEventListener("abort", stopRemoteSession, { once: true });

    try {
      let session = created;
      while (
        session.isTaskSuccessful === null ||
        session.isTaskSuccessful === undefined
      ) {
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        if (TERMINAL_STATUSES.has(session.status)) break;
        await delay(this.pollIntervalMs);
        session = await this.getSession(sessionId);
        onUpdate?.(session);
      }
      return session;
    } finally {
      signal?.removeEventListener("abort", stopRemoteSession);
    }
  }
}

export const taskOutputSchema = {
  type: "object",
  properties: {
    status: { type: "string", enum: ["verified", "failed", "uncertain"] },
    evidence: { type: "string" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    data: {
      type: "object",
      description:
        "Structured values explicitly requested by the task for later approved steps.",
      additionalProperties: true,
    },
  },
  required: ["status", "evidence", "confidence"],
  additionalProperties: false,
};

export const youtubeVideoOutputSchema = {
  type: "object",
  properties: {
    status: { type: "string", enum: ["verified", "failed", "uncertain"] },
    evidence: { type: "string" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    videoUrl: { type: "string" },
    videoTitle: { type: "string" },
  },
  required: [
    "status",
    "evidence",
    "confidence",
    "videoUrl",
    "videoTitle",
  ],
  additionalProperties: false,
};

// Backwards-compatible export for older callers.
export const calendarInviteOutputSchema = taskOutputSchema;
