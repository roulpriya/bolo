import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { after, before, test } from "node:test";
import { startServer } from "../src/server.js";

let server;
let baseUrl;

before(async () => {
  const started = await startServer({ port: 0 });
  server = started.server;
  baseUrl = `http://127.0.0.1:${started.port}`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test("rejects cross-origin browser requests before task planning", async () => {
  const response = await fetch(`${baseUrl}/api/plan`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://attacker.example",
      "Sec-Fetch-Site": "cross-site",
    },
    body: JSON.stringify({ transcript: "open YouTube" }),
  });

  assert.equal(response.status, 403);
  assert.match((await response.json()).error, /cross-origin/i);
});

test("rejects non-loopback Host headers", async () => {
  const result = await new Promise((resolve, reject) => {
    const request = httpRequest(`${baseUrl}/api/health`, {
      headers: { Host: "attacker.example" },
    }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        resolve({ status: response.statusCode, body: JSON.parse(body) });
      });
    });
    request.on("error", reject);
    request.end();
  });

  assert.equal(result.status, 403);
  assert.match(result.body.error, /invalid local request host/i);
});

test("serves the UI with hardened response headers", async () => {
  const response = await fetch(`${baseUrl}/`, {
    headers: { Origin: baseUrl, "Sec-Fetch-Site": "same-origin" },
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-powered-by"), null);
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.match(
    response.headers.get("content-security-policy"),
    /frame-ancestors 'none'/,
  );
});

test("exposes a structured capability catalog", async () => {
  const response = await fetch(`${baseUrl}/api/capabilities`, {
    headers: { Origin: baseUrl, "Sec-Fetch-Site": "same-origin" },
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  const reminder = body.capabilities.find(
    (capability) => capability.id === "apple.reminders.create",
  );
  assert.equal(reminder.risk, "local_reversible");
  assert.equal(reminder.executor, "apple_events");
});

test("plans return a plan-bound approval token", async () => {
  const planned = await fetch(`${baseUrl}/api/plan`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: baseUrl,
      "Sec-Fetch-Site": "same-origin",
    },
    body: JSON.stringify({ transcript: "Open the Calculator app." }),
  });
  assert.equal(planned.status, 200);
  const body = await planned.json();
  assert.equal(body.plan.steps[0].capability, "mac.application.open");
  assert.match(body.approvalToken, /^[^.]+\.[^.]+$/);

  const rejected = await fetch(`${baseUrl}/api/runs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: baseUrl,
      "Sec-Fetch-Site": "same-origin",
    },
    body: JSON.stringify({ taskId: body.taskId, confirmed: true }),
  });
  assert.equal(rejected.status, 400);
  assert.match((await rejected.json()).error, /confirmed task/i);
});

test("rejects oversized task text without calling an agent", async () => {
  const response = await fetch(`${baseUrl}/api/plan`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: baseUrl,
      "Sec-Fetch-Site": "same-origin",
    },
    body: JSON.stringify({ transcript: "x".repeat(4_001) }),
  });

  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /too long/i);
});
