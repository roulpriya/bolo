import type { VoiceStartOptions } from "../shared/ipc.ts";

declare global {
  interface Window {
    boloDesktop: {
      setExpanded: (expanded: boolean) => void;
      setIgnoreMouseEvents: (ignore: boolean) => void;
      hideWindow: () => void;
      onFocusCommand: (callback: () => void) => () => void;
      onNewCommand: (callback: () => void) => () => void;
      health: () => Promise<unknown>;
      startVoice: (
        options: VoiceStartOptions
      ) => Promise<{ sessionId: string }>;
      sendVoiceChunk: (sessionId: string, bytes: ArrayBuffer) => void;
      cancelVoice: (sessionId: string) => Promise<{ ok: true }>;
      onVoiceEvent: (callback: (event: unknown) => void) => () => void;
      onAgentText: (callback: (event: unknown) => void) => () => void;
      startAgent: (text: string) => Promise<{ id: string }>;
      answerRun: (
        runId: string,
        questionId: string,
        text: string
      ) => Promise<{ ok: true }>;
      getRun: (id: string) => Promise<unknown>;
      stopRun: (id: string) => Promise<{ ok: true }>;
      speech: (text: string, languageCode?: string) => Promise<Uint8Array>;
    };
  }
}
