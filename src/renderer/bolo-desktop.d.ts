import type {
  ConversationChoice,
  InputEvent,
  PendingInput,
} from "../shared/input-routing.ts";
import type {
  AnswerQuestionInput,
  StartTurnInput,
  VoiceStartOptions,
} from "../shared/ipc.ts";
import type { VoiceEvent } from "../shared/sessions.ts";
import type {
  LegacyChat,
  Thread,
  ThreadEvent,
  ThreadSummary,
  Turn,
} from "../shared/threads.ts";

interface McpServer {
  args: string[];
  command: string;
  enabled: boolean;
  env: Record<string, string>;
  headers: Record<string, string>;
  id: string;
  name: string;
  oauthClientId: string;
  oauthClientSecret: string;
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
      startMcpOAuth: (
        id: string
      ) => Promise<{ status: "connected" | "pending" }>;
      onMcpOAuthEvent: (
        callback: (event: {
          error?: string;
          serverId?: string;
          status: "connected" | "failed";
        }) => void
      ) => () => void;
      saveMcpServers: (servers: McpServer[]) => Promise<McpServer[]>;
      openSettings: () => Promise<{ ok: true }>;
      createThread: () => Promise<Thread>;
      listThreads: () => Promise<ThreadSummary[]>;
      getThread: (id: string) => Promise<Thread>;
      selectThread: (id: string) => Promise<Thread>;
      restoreThread: (options?: { legacyChat?: LegacyChat }) => Promise<Thread>;
      startVoiceSession: (
        options: VoiceStartOptions
      ) => Promise<{ sessionId: string }>;
      sendVoiceChunk: (sessionId: string, bytes: ArrayBuffer) => void;
      cancelVoiceSession: (sessionId: string) => Promise<{ ok: true }>;
      onVoiceEvent: (callback: (event: VoiceEvent) => void) => () => void;
      onThreadEvent: (callback: (event: ThreadEvent) => void) => () => void;
      startTurn: (
        input: StartTurnInput
      ) => Promise<{ threadId: string; turnId: string }>;
      submitInput: (input: StartTurnInput) => Promise<{ ok: true }>;
      getPendingInput: (threadId: string) => Promise<PendingInput | null>;
      resolveInput: (input: {
        requestId: string;
        choice: ConversationChoice;
      }) => Promise<{ ok: true }>;
      cancelInput: (threadId: string) => Promise<{ ok: true }>;
      onInputEvent: (callback: (event: InputEvent) => void) => () => void;
      answerQuestion: (input: AnswerQuestionInput) => Promise<{ ok: true }>;
      getTurn: (threadId: string, turnId: string) => Promise<Turn>;
      cancelTurn: (threadId: string, turnId: string) => Promise<{ ok: true }>;
      speech: (text: string, languageCode?: string) => Promise<Uint8Array>;
    };
  }
}
