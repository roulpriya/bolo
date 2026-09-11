#!/usr/bin/env node

import "../src/main/config.ts";
import crypto from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { AgentService } from "../src/main/agent/agent-service.ts";
import { createTurnRecord } from "../src/shared/threads.ts";

const targetUrl = "https://www.selenium.dev/selenium/web/web-form.html";
const expectedText = "Bolo real URL verified";
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const evidenceDirectory = path.resolve(
  "artifacts",
  "browser-agent-real-url",
  timestamp
);
await mkdir(evidenceDirectory, { recursive: true });

const activityLog = [];
const networkLog = [];
const questions = [];
const run = {
  ...createTurnRecord(
    crypto.randomUUID(),
    "Standalone browser specialist test"
  ),
  abortController: new AbortController(),
  currentTool: null,
  id: `browser-real-url-${crypto.randomUUID()}`,
  input: "Standalone real URL browser specialist test",
  notify: () => undefined,
  pendingQuestion: null,
  progress: "Starting real URL browser test",
  state: "running",
  toolActivity: activityLog,
};

const agentService = new AgentService({
  browserProfileDirectory: path.join(evidenceDirectory, "profile"),
  workspaceDirectory: process.cwd(),
});
const page = await agentService.browser.newPage();
await page.context().addInitScript(() => {
  const evidencePrefix = "bolo-browser-evidence:";
  const read = () => {
    try {
      return window.name.startsWith(evidencePrefix)
        ? JSON.parse(window.name.slice(evidencePrefix.length))
        : [];
    } catch {
      return [];
    }
  };
  const record = (entry) => {
    window.name = `${evidencePrefix}${JSON.stringify([
      ...read(),
      { ...entry, at: Date.now(), url: location.href },
    ])}`;
  };
  document.addEventListener(
    "input",
    (event) => {
      const { target } = event;
      if (target?.name === "my-text") {
        record({ action: "text-input", value: target.value });
      }
    },
    true
  );
  document.addEventListener(
    "change",
    (event) => {
      const { target } = event;
      if (target?.name === "my-select") {
        record({
          action: "select",
          label: target.selectedOptions?.[0]?.textContent?.trim() || "",
          value: target.value,
        });
      }
    },
    true
  );
  document.addEventListener(
    "click",
    (event) => {
      if (event.target?.matches?.('button[type="submit"]')) {
        record({
          action: "submit",
          selectValue:
            document.querySelector('[name="my-select"]')?.value || "",
          textValue: document.querySelector('[name="my-text"]')?.value || "",
        });
      }
    },
    true
  );
});
page.on("response", (response) => {
  if (response.request().resourceType() !== "document") {
    return;
  }
  networkLog.push({
    at: Date.now(),
    status: response.status(),
    url: response.url(),
  });
});
await page.goto("about:blank");
await page.screenshot({
  path: path.join(evidenceDirectory, "before-navigation.png"),
});

let report;
try {
  const modelResult = await agentService.runBrowserSpecialist(
    run,
    `Navigate to ${targetUrl} in the visible browser. On the page:
1. Enter exactly "${expectedText}" in the field labelled "Text input".
2. Select "Two" in the dropdown labelled "Dropdown (select)".
3. Submit the form. This is a public Selenium test fixture and submission is approved.
4. Inspect a fresh screenshot and return status "verified" only if the resulting page visibly says "Received!".`,
    (prompt, kind) => {
      questions.push({ answer: "yes", at: Date.now(), kind, prompt });
      return "yes";
    }
  );

  const finalPage = await agentService.browser.newPage();
  const browserEvidence = await finalPage.evaluate(() => {
    const prefix = "bolo-browser-evidence:";
    let actions = [];
    try {
      actions = window.name.startsWith(prefix)
        ? JSON.parse(window.name.slice(prefix.length))
        : [];
    } catch {
      // A missing or malformed action log is equivalent to no recorded actions.
    }
    return {
      actions,
      bodyText: document.body?.innerText?.trim() || "",
      heading: document.querySelector("h1")?.textContent?.trim() || "",
      title: document.title,
      url: location.href,
    };
  });
  await finalPage.screenshot({
    fullPage: true,
    path: path.join(evidenceDirectory, "after-submission.png"),
  });
  await writeFile(
    path.join(evidenceDirectory, "final-page.html"),
    await finalPage.content(),
    "utf8"
  );

  const submittedAction = browserEvidence.actions.find(
    (entry) =>
      entry.action === "submit" &&
      entry.textValue === expectedText &&
      entry.selectValue === "2"
  );
  const domPassed =
    new URL(browserEvidence.url).hostname === "www.selenium.dev" &&
    new URL(browserEvidence.url).pathname.endsWith("/submitted-form.html") &&
    browserEvidence.bodyText.includes("Received!") &&
    Boolean(submittedAction);
  report = {
    activityCount: activityLog.length,
    browserEvidence,
    evidenceDirectory,
    model: process.env.OPENAI_COMPUTER_MODEL || "gpt-5.6",
    modelResult,
    networkLog,
    passed: domPassed && modelResult?.status === "verified",
    questions,
    targetUrl,
    turnId: run.id,
  };
} catch (error) {
  const livePage = await agentService.browser.newPage().catch(() => null);
  await livePage
    ?.screenshot({
      fullPage: true,
      path: path.join(evidenceDirectory, "failure.png"),
    })
    .catch(() => undefined);
  report = {
    activityCount: activityLog.length,
    error: String(error?.stack || error),
    evidenceDirectory,
    model: process.env.OPENAI_COMPUTER_MODEL || "gpt-5.6",
    networkLog,
    passed: false,
    questions,
    targetUrl,
    turnId: run.id,
  };
} finally {
  await writeFile(
    path.join(evidenceDirectory, "activity.json"),
    JSON.stringify(activityLog, null, 2),
    "utf8"
  );
  await agentService.close();
}

await writeFile(
  path.join(evidenceDirectory, "report.json"),
  JSON.stringify(report, null, 2),
  "utf8"
);
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.passed ? 0 : 1;
