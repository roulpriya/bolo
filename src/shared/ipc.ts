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
  newCommand: "new-command",
  setExpanded: "set-expanded",
  setIgnoreMouseEvents: "bolo:set-ignore-mouse-events",
  speech: "bolo:speech",
  startAgent: "bolo:start-agent",
  startVoice: "bolo:start-voice",
  stopRun: "bolo:stop-run",
  voiceChunk: "bolo:voice-chunk",
  voiceEvent: "bolo:voice-event",
} as const;

const id = z.string().trim().min(1).max(200);
const text = z.string().trim().min(1).max(4000);

export const ipcArgs = {
  answerRun: z.tuple([id, id, z.string().trim().min(1).max(2000)]),
  cancelVoice: z.tuple([id]),
  getRun: z.tuple([id]),
  setExpanded: z.tuple([z.boolean()]),
  setIgnoreMouseEvents: z.tuple([z.boolean()]),
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
