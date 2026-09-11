import { z } from "zod";
import { entityId, legacyChatSchema } from "./threads.ts";

/**
 * The single renderer-to-main contract. Keep Electron's string channels and
 * runtime validation together so the preload bridge cannot silently drift.
 */
export const IPC = {
  answerQuestion: "bolo:answer-question",
  cancelTurn: "bolo:cancel-turn",
  cancelVoiceSession: "bolo:cancel-voice-session",
  createThread: "bolo:create-thread",
  focusCommand: "focus-command",
  getThread: "bolo:get-thread",
  getTurn: "bolo:get-turn",
  health: "bolo:health",
  hideWindow: "hide-window",
  listThreads: "bolo:list-threads",
  mcpOAuthEvent: "bolo:mcp-oauth-event",
  mcpOAuthStart: "bolo:mcp-oauth-start",
  mcpServersGet: "bolo:mcp-servers-get",
  mcpServersSave: "bolo:mcp-servers-save",
  newCommand: "new-command",
  restoreThread: "bolo:restore-thread",
  selectThread: "bolo:select-thread",
  setExpanded: "set-expanded",
  setIgnoreMouseEvents: "bolo:set-ignore-mouse-events",
  settingsOpen: "bolo:settings-open",
  speech: "bolo:speech",
  startTurn: "bolo:start-turn",
  startVoiceSession: "bolo:start-voice-session",
  threadEvent: "bolo:thread-event",
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
    oauthClientId: z.string().trim().max(1000).default(""),
    oauthClientSecret: z.string().trim().max(10_000).default(""),
    transport: z.enum(["stdio", "streamable-http", "sse"]).default("stdio"),
    url: z.string().trim().max(4000).default(""),
  })
  .strict();

export const ipcArgs = {
  answerQuestion: z.tuple([
    z
      .object({
        questionId: entityId,
        text: z.string().trim().min(1).max(2000),
        threadId: entityId,
        turnId: entityId,
      })
      .strict(),
  ]),
  cancelTurn: z.tuple([entityId, entityId]),
  cancelVoiceSession: z.tuple([id]),
  createThread: z.tuple([]),
  getThread: z.tuple([entityId]),
  getTurn: z.tuple([entityId, entityId]),
  listThreads: z.tuple([]),
  mcpOAuthStart: z.tuple([id]),
  mcpServersGet: z.tuple([]),
  mcpServersSave: z.tuple([z.array(mcpServer).max(20)]),
  restoreThread: z.tuple([
    z
      .object({
        legacyChat: legacyChatSchema.optional(),
      })
      .strict()
      .optional(),
  ]),
  selectThread: z.tuple([entityId]),
  setExpanded: z.tuple([z.boolean()]),
  setIgnoreMouseEvents: z.tuple([z.boolean()]),
  settingsOpen: z.tuple([]),
  speech: z.tuple([
    z.string().trim().min(1).max(600),
    z.string().trim().min(1).max(30).optional(),
  ]),
  startTurn: z.tuple([z.object({ text, threadId: entityId }).strict()]),
  startVoiceSession: z.tuple([
    z.discriminatedUnion("purpose", [
      z.object({ purpose: z.literal("command"), threadId: entityId }).strict(),
      z
        .object({
          purpose: z.literal("answer"),
          questionId: entityId,
          threadId: entityId,
          turnId: entityId,
        })
        .strict(),
    ]),
  ]),
  voiceChunk: z.tuple([id, z.instanceof(ArrayBuffer)]),
} as const;

export type VoiceStartOptions = z.infer<typeof ipcArgs.startVoiceSession>[0];
export type McpServerInput = z.infer<typeof mcpServer>;

export type StartTurnInput = z.infer<typeof ipcArgs.startTurn>[0];
export type AnswerQuestionInput = z.infer<typeof ipcArgs.answerQuestion>[0];
