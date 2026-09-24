import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { InputEvent, PendingInput } from "../../shared/input-routing.ts";
import {
  summarizeThread,
  type Thread,
  type ThreadEvent,
  type ThreadSummary,
} from "../../shared/threads.ts";
import {
  applyThreadEvent,
  loadLegacyChat,
  mergeThreadSummaries,
} from "./thread-state";

const hasText = (value: string) => value.length > 0;

export function useThread() {
  const [thread, setThread] = useState<Thread | null>(null);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const [pendingInput, setPendingInput] = useState<PendingInput | null>(null);
  const inputRevision = useRef(0);
  const navigationActive = useRef(Boolean(false));
  const selected = useRef<string>("");
  const generation = useRef(0);
  const operationActive = useRef(Boolean(false));

  const reportError = (cause: unknown) =>
    setError(cause instanceof Error ? cause.message : String(cause));
  const remember = (snapshot: Thread) => {
    setThreads((items) =>
      mergeThreadSummaries(items, [summarizeThread(snapshot)])
    );
  };
  const refresh = async () => {
    const id = selected.current;
    const revision = inputRevision.current;
    if (!hasText(id)) {
      return;
    }
    const [snapshot, items, pending] = await Promise.all([
      window.boloDesktop.getThread(id),
      window.boloDesktop.listThreads(),
      window.boloDesktop.getPendingInput(id),
    ]);
    setThreads((current) => mergeThreadSummaries(current, items));
    if (selected.current !== id) {
      return;
    }
    if (revision === inputRevision.current) {
      setPendingInput(pending);
    }
    setThread((current) =>
      current?.id === id && current.revision > snapshot.revision
        ? current
        : snapshot
    );
  };
  const open = async (load: () => Promise<Thread>): Promise<boolean> => {
    generation.current += 1;
    const request = generation.current;
    navigationActive.current = true;
    inputRevision.current += 1;
    setPendingInput(null);
    setBusy(true);
    setError("");
    try {
      const snapshot = await load();
      if (request !== generation.current) {
        return false;
      }
      selected.current = snapshot.id;
      navigationActive.current = false;
      setThread(snapshot);
      remember(snapshot);
      await refresh();
      return true;
    } catch (cause) {
      if (request === generation.current) {
        reportError(cause);
      }
      return false;
    } finally {
      if (request === generation.current) {
        navigationActive.current = false;
        setBusy(false);
      }
    }
  };
  const operate = async (action: () => Promise<unknown>): Promise<boolean> => {
    if (operationActive.current) {
      return false;
    }
    operationActive.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
      await refresh();
      return true;
    } catch (cause) {
      reportError(cause);
      await refresh().catch(reportError);
      return false;
    } finally {
      operationActive.current = false;
      setBusy(false);
    }
  };
  const onEvent = useEffectEvent((event: ThreadEvent) => {
    setThread((current) => applyThreadEvent(current, event));
    remember(event.thread);
  });
  const onInputEvent = useEffectEvent((event: InputEvent) => {
    if (navigationActive.current || selected.current !== event.sourceThreadId) {
      return;
    }
    inputRevision.current += 1;
    setPendingInput(event.pending);
    if (event.started && event.started.threadId !== selected.current) {
      const { threadId } = event.started;
      open(() => window.boloDesktop.getThread(threadId)).catch(reportError);
    } else if (event.started) {
      refresh().catch(reportError);
    }
  });
  const onFocus = useEffectEvent(() => {
    refresh().catch(reportError);
  });
  const restore = useEffectEvent(() => {
    open(() =>
      window.boloDesktop.restoreThread(loadLegacyChat(localStorage))
    ).catch(reportError);
  });
  useEffect(() => {
    const unsubscribe = window.boloDesktop.onThreadEvent(onEvent);
    const unsubscribeInput = window.boloDesktop.onInputEvent(onInputEvent);
    restore();
    window.addEventListener("focus", onFocus);
    return () => {
      generation.current += 1;
      unsubscribe();
      unsubscribeInput();
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  return {
    busy,
    create: () => open(() => window.boloDesktop.createThread()),
    error,
    operate,
    pendingInput,
    refresh,
    reportError,
    select: (id: string) => open(() => window.boloDesktop.selectThread(id)),
    setError,
    thread,
    threads,
  };
}
