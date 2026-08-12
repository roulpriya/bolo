import type { VoiceStartOptions } from "../shared/ipc.ts";

interface McpServer {
  args: string[];
  command: string;
  enabled: boolean;
  env: Record<string, string>;
  headers: Record<string, string>;
  id: string;
  name: string;
  transport: "stdio" | "streamable-http" | "sse";
  url: string;
}

declare global {
  interface Window {
    boloDesktop: {
      setExpanded: (expanded: boolean) => void;
      setIgnoreMouseEvents: (ignore: boolean) => void;
      hideWindow: () => void;
      onFocusCommand: (callback: () => void) => () => void;
      onNewCommand: (callback: () => void) => () => void;
      health: () => Promise<unknown>;
      getMcpServers: () => Promise<McpServer[]>;
      startMcpOAuth: (id: string) => Promise<{ ok: true }>;
      saveMcpServers: (servers: McpServer[]) => Promise<McpServer[]>;
      openSettings: () => Promise<{ ok: true }>;
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
