export interface VoiceEvent {
  error?: string;
  languageCode?: string;
  questionId?: string;
  sessionId: string;
  threadId?: string;
  transcript?: string;
  turnId?: string;
  type:
    | "ready"
    | "speech-start"
    | "speech-end"
    | "translated"
    | "failed"
    | "closed";
}
