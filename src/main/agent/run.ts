export interface ToolActivityEntry {
  at: number;
  completedAt?: number;
  detail: string;
  id: string;
  input: string;
  kind: "activity" | "tool_call";
  output: string | null;
  status: "completed" | "failed" | "running";
  tool: string;
}

export interface PendingQuestion {
  id: string;
  kind: "confirmation" | "input";
  prompt: string;
  reject: ((error: unknown) => void) | null;
  resolve: ((value: string) => void) | null;
}

export type RunState =
  | "cancelled"
  | "completed"
  | "failed"
  | "running"
  | "waiting_for_user";

/** Shared mutable run record threaded through the agent, its specialists, and DesktopService. */
export interface Run {
  abortController: AbortController;
  createdAt: number;
  currentTool: string | null;
  error: string | null;
  finalScreenshotPath?: string | null;
  finishedAt: number | null;
  id: string;
  input: string;
  internalStopReason?: string;
  languageCode: string;
  pendingQuestion: PendingQuestion | null;
  progress: string;
  result: string | null;
  stage?: string;
  state: RunState;
  toolActivity: ToolActivityEntry[];
}
