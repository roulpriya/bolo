import {
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import { installBrowserShimIfNeeded } from "../browser-shim";
import audioWorkletUrl from "./audio-worklet.ts?url";
import { Composer } from "./components/composer";
import { Conversation } from "./components/conversation";
import { RecordingBar } from "./components/recording-bar";
import type { AppState, Message, Recording, Run } from "./types";

installBrowserShimIfNeeded();

interface AgentTextEvent {
  delta: string;
  runId: string;
}

interface VoiceEvent {
  error?: string;
  runId?: string;
  sessionId: string;
  transcript?: string;
  type:
    | "ready"
    | "speech-start"
    | "speech-end"
    | "translated"
    | "failed"
    | "closed";
}

const CONFIGURATION_ERROR_PATTERN = /API_KEY|not configured/i;
const hasText = (value: string) => value.length > 0;
const isPresent = <Value,>(value: Value | null): value is Value =>
  value !== null;

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
const friendlyError = (message: string) =>
  CONFIGURATION_ERROR_PATTERN.test(message)
    ? "Bolo needs its API keys configured before it can run this task."
    : message || "Something went wrong.";
const workedFor = (run: Run) => {
  const { createdAt: startedAt, finishedAt } = run;
  if (!(startedAt && finishedAt)) {
    return "Worked for a moment";
  }
  const elapsedSeconds = Math.max(
    0,
    Math.round((finishedAt - startedAt) / 1000)
  );
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  const duration = minutes ? `${minutes}min ${seconds}sec` : `${seconds}sec`;
  return `Worked for ${duration}`;
};

function App() {
  const [state, setState] = useState<AppState>("idle");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [run, setRun] = useState<Run | null>(null);
  const [recording, setRecording] = useState<Recording | null>(null);
  const [shortcutVisible, setShortcutVisible] = useState(
    () => !localStorage.getItem("bolo:seenShortcutHint")
  );
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const conversationRef = useRef<HTMLElement>(null);
  const runId = useRef<string>("");
  const voiceSessionId = useRef<string>("");
  const voicePurpose = useRef<"command" | "answer">("command");
  const mediaStream = useRef<MediaStream | null>(null);
  const audioContext = useRef<AudioContext | null>(null);
  const workletNode = useRef<AudioWorkletNode | null>(null);
  const silentGain = useRef<GainNode | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recordingTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingStartedAt = useRef(0);
  const handledQuestionId = useRef<string>("");
  const messageId = useRef(0);
  const speechAudio = useRef<HTMLAudioElement | null>(null);
  const speechUrl = useRef<string>("");
  const speechGeneration = useRef(0);
  const speechFinish = useRef<(() => void) | null>(null);
  const ignoringMouseEvents = useRef<boolean | null>(null);
  const runInputMode = useRef<"typed" | "voice">("typed");

  const addMessage = (
    kind: Message["kind"],
    text: string,
    progress = false
  ) => {
    messageId.current += 1;
    setMessages((items) => [
      ...items,
      { id: messageId.current, kind, progress, text },
    ]);
  };
  const handleAgentText = (event: AgentTextEvent) => {
    if (!event.delta || event.runId !== runId.current) {
      return;
    }
    setRun((value) =>
      value
        ? { ...value, response: `${value.response ?? ""}${event.delta}` }
        : value
    );
  };
  const clearPoll = () => {
    if (isPresent(pollTimer.current)) {
      clearTimeout(pollTimer.current);
    }
  };
  const stopSpeech = () => {
    speechGeneration.current += 1;
    speechAudio.current?.pause();
    speechFinish.current?.();
    if (hasText(speechUrl.current)) {
      URL.revokeObjectURL(speechUrl.current);
    }
    speechUrl.current = "";
    speechAudio.current = null;
    speechFinish.current = null;
  };
  const finishProgress = (label: string) =>
    setRun((value) =>
      value ? { ...value, finished: true, progress: label } : value
    );
  const fail = (message: string) => {
    clearPoll();
    setState("failed");
    finishProgress("Stopped");
    addMessage("bot", friendlyError(message));
  };
  const canAnswer =
    state === "questioning" ||
    (voicePurpose.current === "answer" &&
      Boolean(run?.pendingQuestion) &&
      ["connecting", "listening", "translating"].includes(state));
  const idleLike = ["idle", "completed", "failed"].includes(state);
  const canInput = idleLike || canAnswer;

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
    const handleMouseMove = (event: MouseEvent) => {
      const isVisiblePanel =
        event.target instanceof Element &&
        Boolean(
          event.target.closest(".composer, .conversation, .recording-bar")
        );
      const shouldIgnore = !isVisiblePanel;
      if (ignoringMouseEvents.current === shouldIgnore) {
        return;
      }
      ignoringMouseEvents.current = shouldIgnore;
      window.boloDesktop.setIgnoreMouseEvents(shouldIgnore);
    };
    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);
  useEffect(() => {
    if (messages.length) {
      window.boloDesktop.setExpanded(true);
      requestAnimationFrame(() => {
        if (isPresent(conversationRef.current)) {
          conversationRef.current.scrollTop =
            conversationRef.current.scrollHeight;
        }
      });
    }
  }, [messages]);
  const focusInput = () => inputRef.current?.focus();
  const speak = async (text: string, languageCode = "en-IN") => {
    if (runInputMode.current !== "voice") {
      return;
    }
    if (!text.trim()) {
      return;
    }
    stopSpeech();
    speechGeneration.current += 1;
    const generation = speechGeneration.current;
    try {
      const bytes = await window.boloDesktop.speech(text, languageCode);
      if (generation !== speechGeneration.current) {
        return;
      }
      speechUrl.current = URL.createObjectURL(
        new Blob([bytes], { type: "audio/wav" })
      );
      const audio = new Audio(speechUrl.current);
      speechAudio.current = audio;
      await new Promise<void>((resolve, reject) => {
        speechFinish.current = resolve;
        audio.addEventListener("ended", resolve, { once: true });
        audio.addEventListener("error", reject, { once: true });
        audio.play().catch(reject);
      });
    } catch {
      /* Spoken response is optional. */
    } finally {
      if (hasText(speechUrl.current)) {
        URL.revokeObjectURL(speechUrl.current);
      }
      speechUrl.current = "";
      speechAudio.current = null;
      speechFinish.current = null;
    }
  };
  const schedulePoll = (delay = 400) => {
    clearPoll();
    pollTimer.current = setTimeout(pollRun, delay);
  };
  const completeRun = async (nextRun: Run) => {
    const result = nextRun.result || "The task is complete.";
    setState("completed");
    setRun({
      ...nextRun,
      finished: true,
      progress: workedFor(nextRun),
      response: result,
    });
    await speak(result, nextRun.languageCode || "en-IN");
  };
  const handlePendingQuestion = async (nextRun: Run) => {
    const question = nextRun.pendingQuestion;
    if (!question) {
      return;
    }
    setState("questioning");
    if (handledQuestionId.current === question.id) {
      return;
    }
    handledQuestionId.current = question.id;
    addMessage("bot", question.prompt);
    await speak(question.prompt, nextRun.languageCode || "en-IN");
    if (hasText(runId.current)) {
      await startRecording("answer", question.id);
    }
  };
  const pollRun = async () => {
    if (!hasText(runId.current)) {
      return;
    }
    try {
      const nextRun = await window.boloDesktop.getRun(runId.current);
      setRun(nextRun);
      if (nextRun.state === "completed") {
        await completeRun(nextRun);
        return;
      }
      if (["failed", "cancelled"].includes(nextRun.state)) {
        return fail(nextRun.error || "The task stopped.");
      }
      if (nextRun.state === "waiting_for_user" && nextRun.pendingQuestion) {
        await handlePendingQuestion(nextRun);
      } else {
        setState("running");
      }
      schedulePoll();
    } catch (error: unknown) {
      fail(
        `Lost contact with the task. ${error instanceof Error ? error.message : String(error)}`
      );
    }
  };
  const cleanupRecording = () => {
    if (isPresent(recordingTimer.current)) {
      clearInterval(recordingTimer.current);
    }
    setRecording(null);
    workletNode.current?.disconnect();
    silentGain.current?.disconnect();
    for (const track of mediaStream.current?.getTracks() ?? []) {
      track.stop();
    }
    audioContext.current?.close().catch(() => undefined);
    workletNode.current = null;
    silentGain.current = null;
    mediaStream.current = null;
    audioContext.current = null;
  };
  const cancelRecording = async () => {
    const id = voiceSessionId.current;
    voiceSessionId.current = "";
    cleanupRecording();
    if (hasText(id)) {
      try {
        await window.boloDesktop.cancelVoice(id);
      } catch {
        // The local media resources are already released.
      }
    }
    setState(voicePurpose.current === "answer" ? "questioning" : "idle");
  };
  const startRecording = async (
    purpose: "command" | "answer" = "command",
    questionId: string | null = null
  ) => {
    if (hasText(voiceSessionId.current)) {
      return;
    }
    try {
      stopSpeech();
      mediaStream.current = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: true,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      audioContext.current = new AudioContext();
      await audioContext.current.audioWorklet.addModule(audioWorkletUrl);
      workletNode.current = new AudioWorkletNode(
        audioContext.current,
        "bolo-pcm-processor"
      );
      silentGain.current = audioContext.current.createGain();
      silentGain.current.gain.value = 0;
      audioContext.current
        .createMediaStreamSource(mediaStream.current)
        .connect(workletNode.current);
      workletNode.current.connect(silentGain.current);
      silentGain.current.connect(audioContext.current.destination);
      voicePurpose.current = purpose;
      const started = await window.boloDesktop.startVoice({
        purpose,
        ...(purpose === "answer" ? { questionId, runId: runId.current } : {}),
      });
      voiceSessionId.current = started.sessionId;
      workletNode.current.port.onmessage = (event) => {
        if (hasText(voiceSessionId.current) && event.data?.byteLength) {
          window.boloDesktop.sendVoiceChunk(voiceSessionId.current, event.data);
        }
      };
      recordingStartedAt.current = Date.now();
      setRecording({
        label: purpose === "answer" ? "Listening for your answer" : "Listening",
        seconds: 0,
      });
      recordingTimer.current = setInterval(
        () =>
          setRecording(
            (value) =>
              value && {
                ...value,
                seconds: Math.floor(
                  (Date.now() - recordingStartedAt.current) / 1000
                ),
              }
          ),
        500
      );
      setState("connecting");
    } catch (error: unknown) {
      cleanupRecording();
      const message = error instanceof Error ? error.message : String(error);
      const name = error instanceof Error ? error.name : "Error";
      fail(
        name === "NotAllowedError"
          ? "Microphone access is off. Allow it in System Settings or type the task."
          : `The microphone could not start: ${message}`
      );
    }
  };
  const handleTranslatedVoice = (event: VoiceEvent) => {
    voiceSessionId.current = "";
    cleanupRecording();
    addMessage("user", event.transcript ?? "");
    if (voicePurpose.current === "command") {
      runId.current = event.runId ?? "";
      runInputMode.current = "voice";
    }
    setState("running");
    setRun({ progress: "Working", toolActivity: [] });
    schedulePoll(0);
  };
  const handleFailedVoice = (event: VoiceEvent) => {
    voiceSessionId.current = "";
    cleanupRecording();
    const error = event.error ?? "Voice input failed.";
    if (voicePurpose.current === "answer" && run?.pendingQuestion) {
      addMessage("bot", friendlyError(error));
      setState("questioning");
      return;
    }
    fail(error);
  };
  const handleVoiceEvent = (event: VoiceEvent) => {
    if (!event || event.sessionId !== voiceSessionId.current) {
      return;
    }
    switch (event.type) {
      case "ready":
      case "speech-start":
        setState("listening");
        break;
      case "speech-end":
        setState("translating");
        break;
      case "translated":
        handleTranslatedVoice(event);
        break;
      case "failed":
        handleFailedVoice(event);
        break;
      case "closed":
        voiceSessionId.current = "";
        cleanupRecording();
        break;
      default:
        setState("questioning");
    }
  };
  const submitText = async (text: string) => {
    const value = text.trim();
    if (!value) {
      return;
    }
    setInput("");
    addMessage("user", value);
    try {
      if (run?.pendingQuestion) {
        if (hasText(voiceSessionId.current)) {
          await cancelRecording();
        }
        await window.boloDesktop.answerRun(
          runId.current,
          run.pendingQuestion.id,
          value
        );
        setState("running");
        schedulePoll(0);
        return;
      }
      if (["completed", "failed"].includes(state)) {
        resetTask();
      }
      runInputMode.current = "typed";
      const started = await window.boloDesktop.startAgent(value);
      runId.current = started.id;
      setState("running");
      setRun({ progress: "Working", toolActivity: [] });
      schedulePoll(0);
    } catch (error: unknown) {
      fail(error instanceof Error ? error.message : String(error));
    }
  };
  const stopEverything = async () => {
    stopSpeech();
    if (hasText(voiceSessionId.current)) {
      await cancelRecording();
    }
    if (hasText(runId.current)) {
      try {
        await window.boloDesktop.stopRun(runId.current);
      } catch {
        // The run may already have reached a terminal state.
      }
    }
    fail("Stopped by the user.");
  };
  function resetTask() {
    clearPoll();
    stopSpeech();
    if (hasText(voiceSessionId.current)) {
      cancelRecording().catch(() => undefined);
    }
    runId.current = "";
    runInputMode.current = "typed";
    handledQuestionId.current = "";
    setRun(null);
    setMessages([]);
    setInput("");
    window.boloDesktop.setExpanded(false);
    setState("idle");
    requestAnimationFrame(focusInput);
  }
  const adjustHeight = (target: HTMLTextAreaElement) => {
    target.style.height = "auto";
    target.style.height = `${Math.min(target.scrollHeight, 92)}px`;
  };
  const handleComposerChange = (value: string) => {
    setInput(value);
    if (isPresent(inputRef.current)) {
      adjustHeight(inputRef.current);
    }
  };
  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submitText(input).catch((error: unknown) => {
        fail(error instanceof Error ? error.message : String(error));
      });
    }
  };
  const handleComposerSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submitText(input).catch((error: unknown) => {
      fail(error instanceof Error ? error.message : String(error));
    });
  };
  const onVoiceEvent = useEffectEvent(handleVoiceEvent);
  const onAgentText = useEffectEvent(handleAgentText);
  const onResetTask = useEffectEvent(resetTask);
  const onClearPoll = useEffectEvent(clearPoll);
  const onFocusInput = useEffectEvent(focusInput);
  useEffect(() => {
    const unVoice = window.boloDesktop.onVoiceEvent(onVoiceEvent);
    const unAgentText = window.boloDesktop.onAgentText(onAgentText);
    const unFocus = window.boloDesktop.onFocusCommand(() => {
      inputRef.current?.focus();
      setShortcutVisible(false);
      localStorage.setItem("bolo:seenShortcutHint", "1");
    });
    const unNew = window.boloDesktop.onNewCommand(onResetTask);
    const onKeyDownGlobal = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        window.boloDesktop.hideWindow();
      }
    };
    window.addEventListener("focus", onFocusInput);
    window.addEventListener("keydown", onKeyDownGlobal);
    return () => {
      unVoice();
      unAgentText();
      unFocus();
      unNew();
      window.removeEventListener("focus", onFocusInput);
      window.removeEventListener("keydown", onKeyDownGlobal);
      onClearPoll();
    };
  }, []);
  const conversationProps = {
    messages,
    reference: conversationRef,
    run,
  };
  const recordingProps = { onCancel: cancelRecording, recording };
  const composerProps = {
    canAnswer,
    canInput,
    input,
    inputRef,
    onChange: handleComposerChange,
    onKeyDown: handleComposerKeyDown,
    onRecord: () =>
      startRecording(
        state === "questioning" ? "answer" : "command",
        run?.pendingQuestion?.id || null
      ).catch((error: unknown) => {
        fail(error instanceof Error ? error.message : String(error));
      }),
    onSettings: () => window.boloDesktop.openSettings().catch(() => undefined),
    onStop: stopEverything,
    onSubmit: handleComposerSubmit,
    showStop: Boolean(run && !run.finished),
  };
  return (
    <main aria-label="Bolo execution agent" className="palette">
      <Conversation {...conversationProps} />
      <RecordingBar {...recordingProps} />
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
