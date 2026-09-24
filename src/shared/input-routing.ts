export type ConversationChoice = "continue" | "new";
export type RoutingReason = "uncertain" | "unavailable" | "unconfigured";

export interface PendingInput {
  id: string;
  inputMode: "typed" | "voice";
  reason?: RoutingReason;
  state: "checking" | "choice";
  text: string;
  threadId: string;
}

export interface InputEvent {
  pending: PendingInput | null;
  requestId: string;
  sourceThreadId: string;
  started?: { threadId: string; turnId: string };
}
