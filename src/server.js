import "./config.js";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import express from "express";
import multer from "multer";
import { completionText, confirmationText } from "./planner.js";
import { synthesize, transcribe } from "./sarvam.js";
import { permissionStatus } from "./mac.js";
import {
  createActiveTask,
  executeTask,
  understandTask,
} from "./bolo-agent.js";
import { ApprovalService } from "./orchestration/approval-service.js";
import { RunStore } from "./orchestration/run-store.js";
import { transitionRun } from "./domain/state-machine.js";
import { defaultCapabilityRegistry } from "./orchestration/capability-registry.js";
import { configuration } from "./config.js";

const app = express();
const publicDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "public",
);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
});
const runHistoryFile =
  process.env.NODE_ENV === "test"
    ? null
    : path.resolve(
        process.env.BOLO_RUN_HISTORY_FILE || ".bolo",
        process.env.BOLO_RUN_HISTORY_FILE ? "" : "runs.json",
      );
const runs = new RunStore({ file: runHistoryFile });
await runs.load();
const activeTasks = new Map();
const approvalService = new ApprovalService();
const MAX_ACTIVE_TASKS = 50;
const ACTIVE_TASK_TTL_MS = 15 * 60_000;
const RUN_TTL_MS = 60 * 60_000;

function pruneExpiredState(now = Date.now()) {
  for (const [id, task] of activeTasks) {
    if (now - task.createdAt > ACTIVE_TASK_TTL_MS) activeTasks.delete(id);
  }
  for (const [id, run] of runs) {
    if (
      run.state !== "executing" &&
      now - (run.finishedAt || run.createdAt) > RUN_TTL_MS
    ) {
      runs.delete(id);
    }
  }
}

export function localRequestGuard(request, response, next) {
  const allowedHost =
    request.hostname === "127.0.0.1" || request.hostname === "localhost";
  if (!allowedHost) {
    return response.status(403).json({ error: "Invalid local request host." });
  }

  const origin = request.get("origin");
  const expectedOrigin = `${request.protocol}://${request.get("host")}`;
  const fetchSite = request.get("sec-fetch-site");
  if ((origin && origin !== expectedOrigin) || fetchSite === "cross-site") {
    return response.status(403).json({ error: "Cross-origin requests are not allowed." });
  }
  next();
}

app.disable("x-powered-by");
app.use(localRequestGuard);
app.use((_request, response, next) => {
  response.set({
    "Cache-Control": "no-store",
    "Content-Security-Policy":
      "default-src 'self'; connect-src 'self'; media-src 'self' blob:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    "Permissions-Policy": "camera=(), microphone=(self), geolocation=()",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  });
  next();
});
app.use(express.json({ limit: "100kb" }));
app.use(express.static(publicDirectory, { dotfiles: "deny" }));

app.get("/api/health", async (_request, response) => {
  const localComputerConfigured = await permissionStatus()
    .then((status) => status.accessibilityTrusted === true)
    .catch(() => false);
  response.json({
    ok: true,
    sarvamConfigured: Boolean(process.env.SARVAM_API_KEY),
    openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
    browserUseConfigured: Boolean(process.env.BROWSER_USE_API_KEY),
    browserProfileConfigured: Boolean(process.env.BROWSER_USE_PROFILE_ID),
    localComputerConfigured,
  });
});

app.get("/api/capabilities", async (_request, response) => {
  const capabilities = await Promise.all(
    defaultCapabilityRegistry.list().map(async (capability) => ({
      id: capability.id,
      description: capability.description,
      risk: capability.risk,
      approval: capability.approval,
      executor: capability.executor,
      targetLatencyMs: capability.targetLatencyMs,
      available: await defaultCapabilityRegistry
        .isAvailable(capability.id)
        .catch(() => false),
    })),
  );
  response.json({ capabilities });
});

app.post("/api/transcribe", upload.single("audio"), async (request, response) => {
  try {
    if (!request.file) return response.status(400).json({ error: "No microphone audio received." });
    const transcript = await transcribe(request.file.buffer, request.file.mimetype);
    response.json({ transcript });
  } catch (error) {
    response.status(502).json({ error: error.message });
  }
});

function planningResponse(task, understanding) {
  if (understanding.status === "needs_clarification") {
    return {
      status: "needs_clarification",
      taskId: task.id,
      transcript: task.transcript,
      clarificationQuestion:
        understanding.clarificationQuestion ||
        "What detail should Bolo use for this task?",
    };
  }
  if (understanding.status === "unsupported" || !task.plan) {
    const error = new Error(
      "Bolo cannot perform that request.",
    );
    error.statusCode = 422;
    throw error;
  }
  return {
    status: "ready",
    taskId: task.id,
    transcript: task.transcript,
    plan: task.plan,
    approvalToken: task.approvalToken,
    confirmation: confirmationText(task.plan),
  };
}

app.post("/api/plan", async (request, response) => {
  try {
    pruneExpiredState();
    if (activeTasks.size >= MAX_ACTIVE_TASKS) {
      return response.status(429).json({ error: "Too many active tasks. Try again shortly." });
    }
    const transcript = String(request.body?.transcript || "").trim();
    if (!transcript) {
      return response.status(400).json({ error: "Please say or type a task." });
    }
    if (transcript.length > 4_000) {
      return response.status(400).json({ error: "The task is too long." });
    }
    const taskId = crypto.randomUUID();
    const task = createActiveTask(taskId);
    task.createdAt = Date.now();
    task.transcript = transcript;
    activeTasks.set(taskId, task);
    const understanding = await understandTask(task, transcript);
    if (task.plan) task.approvalToken = approvalService.issue(task.plan);
    response.json(planningResponse(task, understanding));
  } catch (error) {
    response.status(error.statusCode || 502).json({ error: error.message });
  }
});

app.post("/api/plan/:taskId/clarify", async (request, response) => {
  try {
    pruneExpiredState();
    const task = activeTasks.get(request.params.taskId);
    if (!task) return response.status(404).json({ error: "Active task not found." });
    const answer = String(request.body?.answer || "").trim();
    if (!answer) {
      return response.status(400).json({ error: "Please answer the question." });
    }
    if (answer.length > 2_000) {
      return response.status(400).json({ error: "The clarification is too long." });
    }
    const understanding = await understandTask(task, answer);
    if (task.plan) task.approvalToken = approvalService.issue(task.plan);
    response.json(planningResponse(task, understanding));
  } catch (error) {
    response.status(error.statusCode || 502).json({ error: error.message });
  }
});

app.post("/api/speech", async (request, response) => {
  try {
    const text = String(request.body?.text || "").slice(0, 600);
    if (!text) return response.status(400).json({ error: "No response text supplied." });
    const audio = await synthesize(text);
    response.type("audio/wav").send(audio);
  } catch (error) {
    response.status(502).json({ error: error.message });
  }
});

app.post("/api/runs", (request, response) => {
  try {
    pruneExpiredState();
    const activeTask = activeTasks.get(request.body?.taskId);
    const plan = activeTask?.plan;
    if (
      !plan?.requiresConfirmation ||
      plan.goal !== "perform_task" ||
      !approvalService.verify(plan, request.body?.approvalToken, {
        consume: true,
      })
    ) {
      throw new Error("A confirmed task is required.");
    }
    // Consume approval before starting so retries cannot duplicate side effects.
    activeTasks.delete(activeTask.id);
    const id = crypto.randomUUID();
    const run = {
      id,
      createdAt: Date.now(),
      state: "pending",
      stage: "Starting agent",
      cancelled: false,
      plan,
      verification: null,
      error: null,
      internalStopReason: null,
      abortController: new AbortController(),
    };
    transitionRun(run, "executing");
    run.persist = () => runs.touch(id);
    runs.set(id, run);
    response.status(202).json({ id });

    executeTask(activeTask, run)
      .then((verification) => {
        run.verification = verification;
        if (verification.status === "verified") {
          transitionRun(run, "completed");
          run.completion = completionText(plan, verification);
        } else {
          transitionRun(run, "failed");
          run.error =
            verification.status === "uncertain"
              ? "I could not clearly verify the requested final state."
              : "The requested task could not be visibly verified.";
        }
        runs.touch(id);
      })
      .catch((error) => {
        transitionRun(
          run,
          run.cancelled || error.name === "AbortError" ? "cancelled" : "failed",
        );
        run.error =
          run.internalStopReason ||
          (error.name === "AbortError" ? "Stopped by the user." : error.message);
        runs.touch(id);
      });
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

app.get("/api/runs/:id", (request, response) => {
  pruneExpiredState();
  const run = runs.get(request.params.id);
  if (!run) return response.status(404).json({ error: "Run not found." });
  const {
    id,
    state,
    stage,
    plan,
    verification,
    error,
    completion,
    liveUrl,
    steps,
  } = run;
  response.json({
    id,
    state,
    stage,
    plan,
    verification,
    error,
    completion,
    liveUrl,
    steps: steps || {},
  });
});

app.post("/api/runs/:id/stop", (request, response) => {
  const run = runs.get(request.params.id);
  if (!run) return response.status(404).json({ error: "Run not found." });
  run.cancelled = true;
  run.abortController.abort();
  runs.touch(run.id);
  response.json({ ok: true });
});

app.use((error, _request, response, _next) => {
  if (error instanceof multer.MulterError || error?.type === "entity.too.large") {
    return response.status(413).json({ error: "The request payload is too large." });
  }
  console.error("Unhandled request error:", error);
  response.status(500).json({ error: "The request could not be processed." });
});

const port = configuration.port;
export function startServer({ port: requestedPort = port } = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(requestedPort, "127.0.0.1", () => {
      const address = server.address();
      const actualPort =
        typeof address === "object" && address ? address.port : requestedPort;
      console.log(`Bolo is ready at http://127.0.0.1:${actualPort}`);
      resolve({ server, port: actualPort });
    });
    server.once("error", reject);
  });
}

export async function closeRunStore() {
  await runs.close();
}

const isDirectRun =
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url;

if (process.env.NODE_ENV !== "test" && isDirectRun) {
  await startServer();
}

export default app;
