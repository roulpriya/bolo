import { useEffect, useEffectEvent, useRef, useState } from "react";
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
    if (!hasText(id)) {
      return;
    }
    const [snapshot, items] = await Promise.all([
      window.boloDesktop.getThread(id),
      window.boloDesktop.listThreads(),
    ]);
    setThreads((current) => mergeThreadSummaries(current, items));
    if (selected.current !== id) {
      return;
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
    setBusy(true);
    setError("");
    try {
      const snapshot = await load();
      if (request !== generation.current) {
        return false;
      }
      selected.current = snapshot.id;
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
    restore();
    window.addEventListener("focus", onFocus);
    return () => {
      generation.current += 1;
      unsubscribe();
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  return {
    busy,
    create: () => open(() => window.boloDesktop.createThread()),
    error,
    operate,
    refresh,
    reportError,
    select: (id: string) => open(() => window.boloDesktop.selectThread(id)),
    setError,
    thread,
    threads,
  };
}
