import type { VoiceStartOptions } from "../shared/ipc.ts";
import type { Run, ToolActivity } from "./app/types";

interface VoiceEvent {
  error?: string;
  runId?: string;
  sessionId: string;
  transcript?: string;
  type:
    | "ready"
    | "speech-start"
    | "speech-end"
    | "translated"
    | "failed"
    | "closed";
}

const PREVIEW_NOTICE =
  "Browser preview shim — connect the Bolo desktop app for real agent runs.";

const runs = new Map<string, Run>();
const voiceListeners = new Set<(event: VoiceEvent) => void>();
let runCounter = 0;

function emitVoice(event: VoiceEvent) {
  for (const listener of voiceListeners) {
    listener(event);
  }
}

function sampleToolActivity(): ToolActivity[] {
  return [
    {
      detail: "",
      id: "t1",
      input: JSON.stringify({ path: "agent-service.ts" }),
      kind: "tool_call",
      status: "completed",
      tool: "read",
    },
    {
      detail: "",
      id: "t2",
      input: JSON.stringify({
        command:
          "sed -n '240,335p' node_modules/@openai/agents-core/dist/mcp.d.ts",
      }),
      kind: "tool_call",
      output: "1: interface McpServer {\n2:   name: string;\n...",
      status: "completed",
      tool: "bash",
    },
    {
      detail: "",
      id: "t3",
      input: JSON.stringify({ path: "logger.d.ts" }),
      kind: "tool_call",
      output: "ENOENT: no such file or directory",
      status: "failed",
      tool: "write",
    },
    {
      detail: "",
      id: "t4",
      input: JSON.stringify({ command: "npm run test:browser-agent" }),
      kind: "tool_call",
      status: "running",
      tool: "bash",
    },
  ];
}

/**
 * Installs a mock `window.boloDesktop` when the renderer is opened in a
 * plain browser tab (e.g. the Vite dev server) instead of inside Electron,
 * where the preload script never runs. Dev/preview only.
 */
export function installBrowserShimIfNeeded() {
  if (window.boloDesktop) {
    return;
  }
  console.info(
    "[bolo] No Electron preload detected — installing browser preview shim."
  );
  window.boloDesktop = {
    answerRun: (runId, _questionId, text) => {
      const run = runs.get(runId);
      if (run) {
        run.pendingQuestion = null;
        setTimeout(() => {
          run.state = "completed";
          run.finished = true;
          run.finishedAt = Date.now();
          run.result = `Got it — you said "${text}". ${PREVIEW_NOTICE}`;
        }, 600);
      }
      return Promise.resolve({ ok: true });
    },
    cancelVoice: () => Promise.resolve({ ok: true }),
    getMcpServers: () => Promise.resolve([]),
    getRun: (id) => {
      const run = runs.get(id);
      if (!run) {
        return Promise.reject(new Error("Unknown preview run."));
      }
      return Promise.resolve(run);
    },
    health: () => Promise.resolve({ ok: true, shim: true }),
    hideWindow: () => undefined,
    onAgentText: () => () => undefined,
    onFocusCommand: () => () => undefined,
    onMcpOAuthEvent: () => () => undefined,
    onNewCommand: () => () => undefined,
    onVoiceEvent: (callback) => {
      voiceListeners.add(callback);
      return () => voiceListeners.delete(callback);
    },
    openSettings: () => {
      window.open("../settings/index.html", "_blank", "noopener");
      return Promise.resolve({ ok: true });
    },
    saveMcpServers: (servers) => Promise.resolve(servers),
    sendVoiceChunk: () => undefined,
    setExpanded: () => undefined,
    setIgnoreMouseEvents: () => undefined,
    speech: () =>
      Promise.reject(
        new Error("Speech playback is unavailable in the browser preview.")
      ),
    startAgent: (text) => {
      runCounter += 1;
      const id = `preview-${runCounter}`;
      const toolActivity = sampleToolActivity();
      const run: Run = {
        createdAt: Date.now(),
        progress: "Working",
        state: "running",
        toolActivity,
      };
      runs.set(id, run);
      setTimeout(() => {
        run.state = "completed";
        run.finished = true;
        run.finishedAt = Date.now();
        run.result = `You said: "${text}". ${PREVIEW_NOTICE}`;
        for (const activity of toolActivity) {
          if (activity.status === "running") {
            activity.status = "completed";
            activity.output = "ok";
          }
        }
      }, 900);
      return Promise.resolve({ id });
    },
    startMcpOAuth: () => Promise.resolve({ status: "pending" }),
    startVoice: (_options: VoiceStartOptions) => {
      const sessionId = `preview-voice-${Date.now()}`;
      setTimeout(
        () =>
          emitVoice({
            error: "Voice input is unavailable in the browser preview.",
            sessionId,
            type: "failed",
          }),
        300
      );
      return Promise.resolve({ sessionId });
    },
    stopRun: (id) => {
      const run = runs.get(id);
      if (run) {
        run.state = "cancelled";
        run.finished = true;
      }
      return Promise.resolve({ ok: true });
    },
  };
}
