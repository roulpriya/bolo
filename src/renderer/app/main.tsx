import {
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import {
  isTerminalTurn,
  type Thread,
  type Turn,
} from "../../shared/threads.ts";
import { installBrowserShimIfNeeded } from "../browser-shim";
import { BackgroundRequest } from "./components/background-request";
import { Composer } from "./components/composer";
import { Conversation } from "./components/conversation";
import { RecordingBar } from "./components/recording-bar";
import { ThreadPicker } from "./components/thread-picker";
import type { AppState } from "./types";
import { useSpeech } from "./use-speech";
import { useThread } from "./use-thread";
import { useVoice } from "./use-voice";

installBrowserShimIfNeeded();

const labels: Record<AppState, string> = {
  completed: "Complete",
  connecting: "Connecting",
  failed: "Needs attention",
  idle: "Ready",
  listening: "Listening",
  questioning: "Needs your answer",
  running: "Working",
  translating: "Translating",
};
const CONFIGURATION_ERROR_PATTERN = /API_KEY|not configured/i;

function turnState(turn: Turn | undefined): AppState {
  if (!turn) {
    return "idle";
  }
  if (turn.state === "waiting_for_user") {
    return "questioning";
  }
  if (turn.state === "cancelled") {
    return "failed";
  }
  return turn.state;
}

function App() {
  const conversation = useThread();
  const { thread, threads, busy, error, reportError } = conversation;
  const speech = useSpeech();
  const voice = useVoice(() => {
    conversation.refresh().catch(reportError);
  }, reportError);
  const [input, setInput] = useState("");
  const [shortcutVisible, setShortcutVisible] = useState(
    () => !localStorage.getItem("bolo:seenShortcutHint")
  );
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const conversationRef = useRef<HTMLElement>(null);
  const ignoringMouseEvents = useRef<boolean | null>(null);
  const interaction = useRef(0);
  const navigating = useRef(Boolean(false));
  const latestThread = useRef(thread);
  latestThread.current = thread;
  const handledQuestion = useRef("");
  const previousTurn = useRef<Turn | undefined>(undefined);
  const latest = thread?.turns.at(-1);
  const active = threads.find((item) => item.activeTurnId);
  const background = active?.id === thread?.id ? undefined : active;
  const state = voice.state ?? turnState(latest);
  const canAnswer = latest?.state === "waiting_for_user";
  const canEdit = Boolean(thread && !busy && (!voice.state || canAnswer));
  const canInput = Boolean(
    thread && !busy && (canAnswer || !(voice.state || active))
  );

  const interruptPlayback = () => {
    interaction.current += 1;
    speech.stop();
  };
  const startRecording = async () => {
    if (!(thread && canInput)) {
      return;
    }
    interruptPlayback();
    conversation.setError("");
    if (canAnswer && latest?.pendingQuestion) {
      await voice.start({
        purpose: "answer",
        questionId: latest.pendingQuestion.id,
        threadId: thread.id,
        turnId: latest.id,
      });
    } else {
      await voice.start({ purpose: "command", threadId: thread.id });
    }
  };
  const submit = async () => {
    const text = input.trim();
    if (!(thread && text && canInput)) {
      return;
    }
    interruptPlayback();
    await voice.cancel();
    let submitted: boolean;
    if (canAnswer && latest?.pendingQuestion) {
      const answer = {
        questionId: latest.pendingQuestion.id,
        text,
        threadId: thread.id,
        turnId: latest.id,
      };
      submitted = await conversation.operate(() =>
        window.boloDesktop.answerQuestion(answer)
      );
    } else {
      submitted = await conversation.operate(() =>
        window.boloDesktop.startTurn({ text, threadId: thread.id })
      );
    }
    if (submitted) {
      setInput("");
    }
  };
  const stop = async () => {
    interruptPlayback();
    await voice.cancel();
    if (thread && latest && !isTerminalTurn(latest.state)) {
      await conversation.operate(() =>
        window.boloDesktop.cancelTurn(thread.id, latest.id)
      );
    }
  };
  const newConversation = async () => {
    await changeConversation(conversation.create);
  };
  const changeConversation = async (load: () => Promise<boolean>) => {
    if (navigating.current) {
      return;
    }
    navigating.current = true;
    interruptPlayback();
    try {
      await voice.cancel();
      if (await load()) {
        setInput("");
        inputRef.current?.focus();
      }
    } finally {
      navigating.current = false;
    }
  };
  const selectThread = async (id: string) => {
    await changeConversation(() => conversation.select(id));
  };
  const stopBackground = async () => {
    if (!background?.activeTurnId) {
      return;
    }
    const { id, activeTurnId } = background;
    await conversation.operate(() =>
      window.boloDesktop.cancelTurn(id, activeTurnId)
    );
  };
  const onTurnChanged = useEffectEvent(async (snapshot: Thread | null) => {
    const changedTurn = snapshot?.turns.at(-1);
    const previous = previousTurn.current;
    previousTurn.current = changedTurn;
    if (
      navigating.current ||
      !(snapshot && changedTurn?.inputMode === "voice")
    ) {
      return;
    }
    const question = changedTurn.pendingQuestion;
    if (
      changedTurn.state === "waiting_for_user" &&
      question &&
      handledQuestion.current !== question.id
    ) {
      handledQuestion.current = question.id;
      const request = interaction.current;
      await speech.speak(question.prompt, changedTurn.languageCode);
      const current = latestThread.current?.turns.at(-1);
      if (
        request === interaction.current &&
        !navigating.current &&
        latestThread.current?.id === snapshot.id &&
        current?.pendingQuestion?.id === question.id
      ) {
        await voice.start({
          purpose: "answer",
          questionId: question.id,
          threadId: snapshot.id,
          turnId: changedTurn.id,
        });
      }
    } else if (
      changedTurn.state === "completed" &&
      previous?.id === changedTurn.id &&
      !isTerminalTurn(previous.state) &&
      changedTurn.result
    ) {
      await speech.speak(changedTurn.result, changedTurn.languageCode);
    }
  });
  const onError = useEffectEvent(reportError);
  useEffect(() => {
    onTurnChanged(thread).catch(onError);
  }, [thread]);
  useEffect(() => {
    document.body.classList.toggle(
      "is-listening",
      ["connecting", "listening", "translating"].includes(state)
    );
    document.body.classList.toggle("is-working", state === "running");
    document.body.classList.toggle(
      "is-attention",
      ["questioning", "failed"].includes(state)
    );
  }, [state]);
  useEffect(() => {
    window.boloDesktop.setExpanded(Boolean(thread?.turns.length || background));
    if (thread?.turns.length) {
      requestAnimationFrame(() => {
        const element = conversationRef.current;
        element?.scrollTo(0, element.scrollHeight);
      });
    }
  }, [thread, background]);
  const onNew = useEffectEvent(() => {
    newConversation().catch(reportError);
  });
  useEffect(() => {
    const unFocus = window.boloDesktop.onFocusCommand(() => {
      inputRef.current?.focus();
      setShortcutVisible(false);
      localStorage.setItem("bolo:seenShortcutHint", "1");
    });
    const unNew = window.boloDesktop.onNewCommand(onNew);
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        window.boloDesktop.hideWindow();
      }
    };
    const onMouseMove = (event: MouseEvent) => {
      const panel =
        event.target instanceof Element &&
        event.target.closest(
          ".composer, .conversation, .recording-bar, .thread-picker, .background-request, .palette-error"
        );
      const ignore = !panel;
      if (ignoringMouseEvents.current !== ignore) {
        ignoringMouseEvents.current = ignore;
        window.boloDesktop.setIgnoreMouseEvents(ignore);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mousemove", onMouseMove);
    return () => {
      unFocus();
      unNew();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mousemove", onMouseMove);
    };
  }, []);
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submit().catch(reportError);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      submit().catch(reportError);
    }
  };
  const pickerProps = {
    disabled: busy,
    onCreate: () => {
      newConversation().catch(reportError);
    },
    onSelect: (id: string) => {
      selectThread(id).catch(reportError);
    },
    selectedId: thread?.id,
    threads,
  };
  const composerProps = {
    canAnswer,
    canEdit,
    canInput,
    input,
    inputRef,
    onChange: setInput,
    onKeyDown,
    onRecord: () => {
      startRecording().catch(reportError);
    },
    onSettings: () => {
      window.boloDesktop.openSettings().catch(reportError);
    },
    onStop: () => {
      stop().catch(reportError);
    },
    onSubmit,
    showStop: Boolean(latest && !isTerminalTurn(latest.state)),
  };
  const friendlyError = CONFIGURATION_ERROR_PATTERN.test(error)
    ? "Bolo needs its API keys configured before it can run this task."
    : error;
  const backgroundProps = {
    disabled: busy,
    onOpen: () => {
      if (background) {
        selectThread(background.id).catch(reportError);
      }
    },
    onStop: () => {
      stopBackground().catch(reportError);
    },
  };
  return (
    <main aria-label="Bolo execution agent" className="palette">
      <ThreadPicker {...pickerProps} />
      {background ? (
        <BackgroundRequest {...backgroundProps} thread={background} />
      ) : null}
      <Conversation reference={conversationRef} thread={thread} />
      <RecordingBar onCancel={voice.cancel} recording={voice.recording} />
      {error ? (
        <p className="palette-error" role="alert">
          {friendlyError}
        </p>
      ) : null}
      <Composer {...composerProps} />
      {shortcutVisible ? (
        <footer className="shortcut-hint">
          <kbd>⌘</kbd>
          <kbd>⇧</kbd>
          <kbd>Space</kbd> to show Bolo
        </footer>
      ) : null}
      <p aria-live="polite" className="sr-only">
        Bolo is {labels[state].toLowerCase()}.
      </p>
    </main>
  );
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Bolo renderer root element was not found.");
}
createRoot(rootElement).render(<App />);
