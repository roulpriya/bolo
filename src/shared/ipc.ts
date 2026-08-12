import { z } from "zod";

/**
 * The single renderer-to-main contract. Keep Electron's string channels and
 * runtime validation together so the preload bridge cannot silently drift.
 */
export const IPC = {
  agentText: "bolo:agent-text",
  answerRun: "bolo:answer-run",
  cancelVoice: "bolo:cancel-voice",
  focusCommand: "focus-command",
  getRun: "bolo:get-run",
  health: "bolo:health",
  hideWindow: "hide-window",
  mcpOAuthStart: "bolo:mcp-oauth-start",
  mcpServersGet: "bolo:mcp-servers-get",
  mcpServersSave: "bolo:mcp-servers-save",
  newCommand: "new-command",
  setExpanded: "set-expanded",
  setIgnoreMouseEvents: "bolo:set-ignore-mouse-events",
  settingsOpen: "bolo:settings-open",
  speech: "bolo:speech",
  startAgent: "bolo:start-agent",
  startVoice: "bolo:start-voice",
  stopRun: "bolo:stop-run",
  voiceChunk: "bolo:voice-chunk",
  voiceEvent: "bolo:voice-event",
} as const;

const id = z.string().trim().min(1).max(200);
const text = z.string().trim().min(1).max(4000);
const mcpServer = z
  .object({
    args: z.array(z.string().max(2000)).max(100).default([]),
    command: z.string().trim().max(1000).default(""),
    enabled: z.boolean().default(true),
    env: z
      .record(
        z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
        z.string().max(10_000)
      )
      .refine((entries) => Object.keys(entries).length <= 50)
      .default({}),
    headers: z
      .record(
        z.string().regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/),
        z.string().max(10_000)
      )
      .refine((entries) => Object.keys(entries).length <= 50)
      .default({}),
    id: z
      .string()
      .regex(/^[a-zA-Z0-9_-]{1,100}$/)
      .optional(),
    name: z.string().trim().min(1).max(100),
    transport: z.enum(["stdio", "streamable-http", "sse"]).default("stdio"),
    url: z.string().trim().max(4000).default(""),
  })
  .strict();

export const ipcArgs = {
  answerRun: z.tuple([id, id, z.string().trim().min(1).max(2000)]),
  cancelVoice: z.tuple([id]),
  getRun: z.tuple([id]),
  mcpOAuthStart: z.tuple([id]),
  mcpServersGet: z.tuple([]),
  mcpServersSave: z.tuple([z.array(mcpServer).max(20)]),
  setExpanded: z.tuple([z.boolean()]),
  setIgnoreMouseEvents: z.tuple([z.boolean()]),
  settingsOpen: z.tuple([]),
  speech: z.tuple([
    z.string().trim().min(1).max(600),
    z.string().trim().min(1).max(30).optional(),
  ]),
  startAgent: z.tuple([text]),
  startVoice: z.tuple([
    z
      .object({
        purpose: z.enum(["command", "answer"]),
        questionId: id.optional(),
        runId: id.optional(),
      })
      .strict(),
  ]),
  stopRun: z.tuple([id]),
  voiceChunk: z.tuple([id, z.instanceof(ArrayBuffer)]),
} as const;

export type VoiceStartOptions = z.infer<typeof ipcArgs.startVoice>[0];
export type McpServerInput = z.infer<typeof mcpServer>;
