import { z } from "zod";

export const entityId = z.uuid();
export const turnState = z.enum([
  "running",
  "waiting_for_user",
  "completed",
  "failed",
  "cancelled",
]);

export const toolActivitySchema = z.object({
  at: z.number(),
  completedAt: z.number().optional(),
  detail: z.string(),
  id: z.string(),
  input: z.string(),
  kind: z.enum(["activity", "tool_call"]),
  output: z.string().nullable(),
  status: z.enum(["completed", "failed", "running"]),
  tool: z.string(),
});

export const questionSchema = z.object({
  id: entityId,
  kind: z.enum(["confirmation", "input"]),
  prompt: z.string(),
});

export const messageSchema = z.object({
  id: entityId,
  kind: z.enum(["input", "question", "answer", "result", "error", "message"]),
  questionId: entityId.optional(),
  role: z.enum(["user", "assistant"]),
  text: z.string(),
});

export const turnSchema = z.object({
  createdAt: z.number(),
  currentTool: z.string().nullable(),
  error: z.string().nullable(),
  finishedAt: z.number().nullable(),
  id: entityId,
  input: z.string(),
  inputMode: z.enum(["typed", "voice"]),
  languageCode: z.string(),
  messages: z.array(messageSchema),
  pendingQuestion: questionSchema.nullable(),
  progress: z.string(),
  response: z.string(),
  result: z.string().nullable(),
  state: turnState,
  threadId: entityId,
  toolActivity: z.array(toolActivitySchema),
});

export const threadSchema = z.object({
  createdAt: z.number(),
  id: entityId,
  revision: z.number().int().nonnegative(),
  title: z.string(),
  turns: z.array(turnSchema),
  updatedAt: z.number(),
});

export const legacyChatSchema = z.object({
  conversationId: entityId,
  messages: z
    .array(
      z.object({
        id: z.number(),
        kind: z.enum(["user", "bot"]),
        text: z.string().max(100_000),
      })
    )
    .max(2000),
  runId: z.string().max(200),
});

export type Turn = z.infer<typeof turnSchema>;
export type TurnState = Turn["state"];
export type Thread = z.infer<typeof threadSchema>;
export type ThreadMessage = z.infer<typeof messageSchema>;
export type PendingQuestion = z.infer<typeof questionSchema>;
export type ToolActivityEntry = z.infer<typeof toolActivitySchema>;
export type LegacyChat = z.infer<typeof legacyChatSchema>;
export type ThreadSummary = Omit<Thread, "turns"> & {
  activeTurnId: string | null;
  activeTurnState: "running" | "waiting_for_user" | "stopping" | null;
  turnCount: number;
};

export interface ThreadEvent {
  revision: number;
  thread: Thread;
  threadId: string;
  turnId: string;
  type: "thread.updated";
}

export function isTerminalTurn(state: TurnState): boolean {
  return state === "completed" || state === "failed" || state === "cancelled";
}

export function summarizeThread(thread: Thread): ThreadSummary {
  const { turns, ...metadata } = thread;
  const active = turns.find((turn) => !isTerminalTurn(turn.state));
  const activeState = active?.state;
  return {
    ...metadata,
    activeTurnId: active?.id ?? null,
    activeTurnState:
      activeState === "running" || activeState === "waiting_for_user"
        ? activeState
        : null,
    turnCount: turns.length,
  };
}

export function createTurnRecord(
  threadId: string,
  input: string,
  inputMode: Turn["inputMode"] = "typed",
  languageCode = "en-IN"
): Turn {
  return {
    createdAt: Date.now(),
    currentTool: null,
    error: null,
    finishedAt: null,
    id: crypto.randomUUID(),
    input,
    inputMode,
    languageCode,
    messages: [
      { id: crypto.randomUUID(), kind: "input", role: "user", text: input },
    ],
    pendingQuestion: null,
    progress: "Working",
    response: "",
    result: null,
    state: "running",
    threadId,
    toolActivity: [],
  };
}
