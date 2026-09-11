import {
  type LegacyChat,
  legacyChatSchema,
  type Thread,
  type ThreadEvent,
  type ThreadSummary,
} from "../../shared/threads.ts";

export function loadLegacyChat(storage: Pick<Storage, "getItem">): {
  legacyChat?: LegacyChat;
} {
  try {
    const legacy = legacyChatSchema.safeParse(
      JSON.parse(storage.getItem("bolo:activeChat") ?? "null")
    );
    return legacy.success ? { legacyChat: legacy.data } : {};
  } catch {
    return {};
  }
}

export function applyThreadEvent(
  current: Thread | null,
  event: ThreadEvent
): Thread | null {
  if (
    !current ||
    event.threadId !== current.id ||
    event.thread.id !== current.id ||
    event.revision !== event.thread.revision ||
    event.revision <= current.revision ||
    !event.thread.turns.some(
      (turn) => turn.id === event.turnId && turn.threadId === current.id
    )
  ) {
    return current;
  }
  return event.thread;
}

export function mergeThreadSummaries(
  current: ThreadSummary[],
  incoming: ThreadSummary[]
): ThreadSummary[] {
  const summaries = new Map(current.map((thread) => [thread.id, thread]));
  for (const thread of incoming) {
    const existing = summaries.get(thread.id);
    if (!existing || thread.revision >= existing.revision) {
      summaries.set(thread.id, thread);
    }
  }
  return [...summaries.values()].sort(
    (left, right) => right.updatedAt - left.updatedAt
  );
}
