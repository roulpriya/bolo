import assert from "node:assert/strict";
import test from "node:test";
import {
  BrowserUseClient,
  buildYouTubeSearchUrl,
  resolveYouTubeVideoFast,
  youtubeVideoOutputSchema,
} from "../src/browser-use.js";

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: async () => body,
  };
}

test("runs a Browser Use v3 session and returns its verified output", async () => {
  const calls = [];
  const responses = [
    {
      id: "session-1",
      status: "running",
      isTaskSuccessful: null,
      liveUrl: "https://live.example/session-1",
    },
    {
      id: "session-1",
      status: "stopped",
      isTaskSuccessful: true,
      output: {
        status: "verified",
        evidence: "Event details were visible after saving.",
        confidence: 0.99,
      },
    },
  ];
  const client = new BrowserUseClient({
    apiKey: "bu_test",
    pollIntervalMs: 0,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse(responses.shift());
    },
  });

  const updates = [];
  const result = await client.runTask(
    {
      task: "Find today's weather",
      profileId: "profile-1",
      outputSchema: { type: "object" },
      maxCostUsd: 1,
    },
    { onUpdate: (update) => updates.push(update.status) },
  );

  assert.equal(result.isTaskSuccessful, true);
  assert.equal(result.output.status, "verified");
  assert.deepEqual(updates, ["running", "stopped"]);
  assert.equal(calls[0].url, "https://api.browser-use.com/api/v3/sessions");
  const requestBody = JSON.parse(calls[0].options.body);
  assert.equal(requestBody.profileId, "profile-1");
  assert.equal(requestBody.keepAlive, false);
  assert.equal(requestBody.maxCostUsd, 1);
  assert.equal(
    calls[0].options.headers["X-Browser-Use-API-Key"],
    "bu_test",
  );
  assert.match(calls[1].url, /\/sessions\/session-1$/);
});

test("surfaces Browser Use API errors without leaking the API key", async () => {
  const client = new BrowserUseClient({
    apiKey: "bu_secret",
    fetchImpl: async () =>
      jsonResponse({ detail: "Invalid API key" }, 401),
  });

  await assert.rejects(
    () => client.getSession("session-1"),
    (error) => {
      assert.match(error.message, /401.*Invalid API key/);
      assert.doesNotMatch(error.message, /bu_secret/);
      return true;
    },
  );
});

test("YouTube resolver schema requires the canonical result fields", () => {
  assert.deepEqual(youtubeVideoOutputSchema.required, [
    "status",
    "evidence",
    "confidence",
    "videoUrl",
    "videoTitle",
  ]);
  assert.equal(youtubeVideoOutputSchema.additionalProperties, false);
});

test("fast YouTube resolver extracts the first playable video", async () => {
  const resolved = await resolveYouTubeVideoFast("test song", {
    fetchImpl: async () => ({
      ok: true,
      text: async () =>
        '{"videoRenderer":{"videoId":"dQw4w9WgXcQ","title":{"runs":[{"text":"Test Song Official"}]}}',
    }),
  });
  assert.deepEqual(resolved, {
    videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    videoTitle: "Test Song Official",
  });
  assert.equal(
    buildYouTubeSearchUrl("test song"),
    "https://www.youtube.com/results?search_query=test+song",
  );
});
