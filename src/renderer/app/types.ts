export type AppState =
  | "idle"
  | "connecting"
  | "listening"
  | "translating"
  | "running"
  | "questioning"
  | "completed"
  | "failed";

export interface Recording {
  label: string;
  seconds: number;
}
