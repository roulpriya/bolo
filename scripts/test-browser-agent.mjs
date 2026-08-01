#!/usr/bin/env node

import "../dist/src/config.js";
import crypto from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { AgentService } from "../dist/src/agent-service.js";

const expectedText = "Bolo browser agent verified";
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const evidenceDirectory = path.resolve(
  "artifacts",
  "browser-agent-e2e",
  timestamp,
);
const profileDirectory = path.join(evidenceDirectory, "profile");
await mkdir(evidenceDirectory, { recursive: true });

const activityLog = [];
const run = {
  id: `browser-e2e-${crypto.randomUUID()}`,
  input: "Standalone browser specialist test",
  state: "running",
  currentTool: null,
  progress: "Starting standalone browser test",
  pendingQuestion: null,
  toolActivity: activityLog,
  abortController: new AbortController(),
};

const agentService = new AgentService({
  workspaceDirectory: process.cwd(),
  browserProfileDirectory: profileDirectory,
});

const page = await agentService.browser.newPage();
await page.setContent(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Bolo Browser Agent E2E</title>
    <style>
      body { font-family: system-ui; margin: 60px auto; width: 760px; color: #171717; }
      .card { border: 2px solid #222; border-radius: 18px; padding: 32px; }
      h1 { margin-top: 0; }
      label, input, button { display: block; font-size: 22px; margin-top: 20px; }
      input { width: 680px; padding: 14px; }
      button { padding: 14px 24px; }
      #form { display: none; }
      #result { margin-top: 26px; font-size: 30px; font-weight: 800; }
      .pass { color: #087a31; }
      .fail { color: #b42318; }
    </style>
  </head>
  <body>
    <main class="card">
      <h1>Bolo Browser Agent Test</h1>
      <p>Click Start Test, enter the requested verification phrase, then click Verify.</p>
      <button id="start">Start Test</button>
      <section id="form">
        <label for="verification">Verification phrase</label>
        <input id="verification" autocomplete="off">
        <button id="verify">Verify</button>
      </section>
      <div id="result" aria-live="polite">NOT STARTED</div>
    </main>
    <script>
      const expected = ${JSON.stringify(expectedText)};
      const start = document.querySelector("#start");
      const form = document.querySelector("#form");
      const input = document.querySelector("#verification");
      const verify = document.querySelector("#verify");
      const result = document.querySelector("#result");
      start.addEventListener("click", () => {
        start.style.display = "none";
        form.style.display = "block";
        result.textContent = "READY";
      });
      verify.addEventListener("click", () => {
        const passed = input.value === expected;
        result.textContent = passed ? "PASS" : "FAIL";
        result.className = passed ? "pass" : "fail";
      });
    </script>
  </body>
</html>`);

await page.screenshot({
  path: path.join(evidenceDirectory, "before.png"),
  fullPage: true,
});
await writeFile(
  path.join(evidenceDirectory, "fixture.html"),
  await page.content(),
  "utf8",
);

let report;
try {
  const modelResult = await agentService.runBrowserSpecialist(
    run,
    `Use the visible browser page to complete this test:
1. Click "Start Test".
2. Type exactly "${expectedText}" into the Verification phrase field.
3. Click "Verify".
4. Inspect a fresh screenshot and return status "verified" only if the page visibly says "PASS".`,
    async (prompt) => {
      throw new Error(`Unexpected user question during deterministic test: ${prompt}`);
    },
  );

  const finalPage = await agentService.browser.newPage();
  const domEvidence = await finalPage.evaluate((expected) => {
    const result = document.querySelector("#result")?.textContent?.trim() || "";
    const value =
      document.querySelector("#verification")?.value?.trim() || "";
    return {
      title: document.title,
      result,
      value,
      passed: result === "PASS" && value === expected,
    };
  }, expectedText);
  await finalPage.screenshot({
    path: path.join(evidenceDirectory, "after.png"),
    fullPage: true,
  });

  report = {
    passed: domEvidence.passed && modelResult?.status === "verified",
    runId: run.id,
    model: process.env.OPENAI_COMPUTER_MODEL || "gpt-5.6",
    modelResult,
    domEvidence,
    activityCount: activityLog.length,
    evidenceDirectory,
  };
} catch (error) {
  const livePage = await agentService.browser.newPage().catch(() => null);
  await livePage
    ?.screenshot({
      path: path.join(evidenceDirectory, "failure.png"),
      fullPage: true,
    })
    .catch(() => {});
  report = {
    passed: false,
    runId: run.id,
    model: process.env.OPENAI_COMPUTER_MODEL || "gpt-5.6",
    error: String(error?.stack || error),
    activityCount: activityLog.length,
    evidenceDirectory,
  };
} finally {
  await writeFile(
    path.join(evidenceDirectory, "activity.json"),
    JSON.stringify(activityLog, null, 2),
    "utf8",
  );
  await agentService.close();
}

await writeFile(
  path.join(evidenceDirectory, "report.json"),
  JSON.stringify(report, null, 2),
  "utf8",
);
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.passed ? 0 : 1;
