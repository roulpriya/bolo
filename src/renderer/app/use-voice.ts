import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { VoiceStartOptions } from "../../shared/ipc.ts";
import type { VoiceEvent } from "../../shared/sessions.ts";
import audioWorkletUrl from "./audio-worklet.ts?worker&url";
import type { Recording } from "./types";

interface Capture {
  context: AudioContext | null;
  sessionId: string;
  stream: MediaStream | null;
  timer: ReturnType<typeof setInterval> | null;
  worklet: AudioWorkletNode | null;
}

function isPresent(value: Capture | null): value is Capture {
  return value !== null;
}

function release(capture: Capture): void {
  if (capture.timer) {
    clearInterval(capture.timer);
  }
  capture.worklet?.disconnect();
  for (const track of capture.stream?.getTracks() ?? []) {
    track.stop();
  }
  capture.context?.close().catch(() => undefined);
}

export function useVoice(
  onTranslated: () => void,
  onError: (error: unknown) => void
) {
  const active = useRef<Capture | null>(null);
  const [state, setState] = useState<
    "connecting" | "listening" | "translating" | null
  >(null);
  const [recording, setRecording] = useState<Recording | null>(null);

  const cleanup = () => {
    const capture = active.current;
    active.current = null;
    if (isPresent(capture)) {
      release(capture);
    }
    setState(null);
    setRecording(null);
    return capture;
  };
  const cancel = async () => {
    const capture = cleanup();
    if (capture?.sessionId) {
      await window.boloDesktop
        .cancelVoiceSession(capture.sessionId)
        .catch(onError);
    }
  };
  const start = async (options: VoiceStartOptions) => {
    if (isPresent(active.current)) {
      return;
    }
    const capture: Capture = {
      context: null,
      sessionId: "",
      stream: null,
      timer: null,
      worklet: null,
    };
    active.current = capture;
    setState("connecting");
    setRecording({ label: "Connecting", seconds: 0 });
    try {
      capture.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: true,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      if (active.current !== capture) {
        release(capture);
        return;
      }
      capture.context = new AudioContext();
      await capture.context.audioWorklet.addModule(audioWorkletUrl);
      if (active.current !== capture) {
        release(capture);
        return;
      }
      const worklet = new AudioWorkletNode(
        capture.context,
        "bolo-pcm-processor"
      );
      capture.worklet = worklet;
      const gain = capture.context.createGain();
      gain.gain.value = 0;
      capture.context.createMediaStreamSource(capture.stream).connect(worklet);
      worklet.connect(gain);
      gain.connect(capture.context.destination);
      const started = await window.boloDesktop.startVoiceSession(options);
      capture.sessionId = started.sessionId;
      if (active.current !== capture) {
        await window.boloDesktop.cancelVoiceSession(capture.sessionId);
        release(capture);
        return;
      }
      worklet.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
        if (active.current === capture && event.data instanceof ArrayBuffer) {
          window.boloDesktop.sendVoiceChunk(capture.sessionId, event.data);
        }
      };
      const startedAt = Date.now();
      capture.timer = setInterval(() => {
        setRecording({
          label: "Listening",
          seconds: Math.floor((Date.now() - startedAt) / 1000),
        });
      }, 500);
    } catch (error) {
      if (active.current !== capture) {
        release(capture);
        return;
      }
      await cancel();
      onError(
        error instanceof Error && error.name === "NotAllowedError"
          ? new Error(
              "Microphone access is off. Allow it in System Settings or type the task."
            )
          : error
      );
    }
  };
  const onEvent = useEffectEvent((event: VoiceEvent) => {
    if (event.sessionId !== active.current?.sessionId) {
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
        cleanup();
        onTranslated();
        break;
      case "failed":
        cleanup();
        onError(new Error(event.error ?? "Voice input failed."));
        break;
      case "closed":
        cleanup();
        break;
      default:
        break;
    }
  });
  useEffect(() => {
    const unsubscribe = window.boloDesktop.onVoiceEvent(onEvent);
    return () => {
      unsubscribe();
      const capture = active.current;
      active.current = null;
      if (isPresent(capture)) {
        release(capture);
        if (capture.sessionId) {
          window.boloDesktop
            .cancelVoiceSession(capture.sessionId)
            .catch(() => undefined);
        }
      }
    };
  }, []);
  return { cancel, recording, start, state };
}
