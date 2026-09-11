import type { Turn } from "../../shared/threads.ts";

/** Live execution fields are stripped by turnSchema before IPC or storage. */
export interface TurnExecution extends Turn {
  abortController: AbortController;
  notify: () => void;
}
