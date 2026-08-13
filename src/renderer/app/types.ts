export type AppState =
  | "idle"
  | "connecting"
  | "listening"
  | "translating"
  | "running"
  | "questioning"
  | "completed"
  | "failed";

export interface Message {
  id: number;
  kind: "user" | "bot";
  progress?: boolean;
  text: string;
}

export interface PendingQuestion {
  id: string;
  prompt: string;
}

export interface ToolActivity {
  at?: number;
  detail: string;
  id?: string;
  input?: string;
  kind: "activity" | "tool_call";
  output?: string;
  status?: "running" | "completed" | "failed";
  tool: string;
}

export interface Run {
  createdAt?: number;
  error?: string;
  finished?: boolean;
  finishedAt?: number | null;
  languageCode?: string;
  pendingQuestion?: PendingQuestion | null;
  progress?: string;
  response?: string;
  result?: string;
  state?: string;
  toolActivity?: ToolActivity[];
}

export interface Recording {
  label: string;
  seconds: number;
}
