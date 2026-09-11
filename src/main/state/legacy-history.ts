import path from "node:path";
import type { AgentInputItem } from "@openai/agents";
import { z } from "zod";
import {
  createTurnRecord,
  entityId,
  isTerminalTurn,
  type LegacyChat,
  legacyChatSchema,
  type ThreadMessage,
  type Turn,
  toolActivitySchema,
  turnState,
} from "../../shared/threads.ts";
import {
  contextItem,
  optionalDirectory,
  readOptionalJson,
  type ThreadRepository,
} from "./thread-repository.ts";

const legacyRun = z.object({
  createdAt: z.number().optional(),
  error: z.string().nullable().optional(),
  finishedAt: z.number().nullable().optional(),
  id: z.string(),
  input: z.string(),
  languageCode: z.string().optional(),
  result: z.string().nullable().optional(),
  state: turnState,
  toolActivity: z.array(toolActivitySchema).optional(),
});

function visibleContext(messages: ThreadMessage[]): AgentInputItem[] {
  return messages
    .filter((message) => message.kind !== "error")
    .map((message): AgentInputItem => {
      if (message.role === "user") {
        return { content: message.text, role: "user" };
      }
      return {
        content: [{ text: message.text, type: "output_text" }],
        role: "assistant",
        status: "completed",
        type: "message",
      };
    });
}

function recoveredTurn(threadId: string, messages: ThreadMessage[]): Turn {
  const input =
    messages.find((message) => message.role === "user")?.text ??
    "Recovered conversation";
  const turn = createTurnRecord(threadId, input);
  turn.messages = messages.map((message) => ({ ...message, kind: "message" }));
  turn.result = null;
  turn.state = "completed";
  turn.progress = "Recovered history";
  turn.finishedAt = turn.createdAt;
  return turn;
}

function contextMessages(
  items: z.infer<typeof contextItem>[]
): ThreadMessage[] {
  const messages: ThreadMessage[] = [];
  for (const item of items) {
    if (
      !(
        "role" in item &&
        (item.role === "user" || item.role === "assistant") &&
        "content" in item
      )
    ) {
      continue;
    }
    const text =
      typeof item.content === "string"
        ? item.content
        : item.content
            .map((part) => ("text" in part ? part.text : ""))
            .join("\n");
    if (text) {
      messages.push({
        id: crypto.randomUUID(),
        kind: item.role === "user" ? "input" : "result",
        role: item.role,
        text,
      });
    }
  }
  return messages;
}

async function importConversation(
  repository: ThreadRepository,
  directory: string,
  file: string
): Promise<void> {
  const id = file.slice(0, -5);
  if (
    !(file.endsWith(".json") && entityId.safeParse(id).success) ||
    repository.hasLegacySource(`conversation:${id}`)
  ) {
    return;
  }
  const items = z
    .array(contextItem)
    .parse(await readOptionalJson(path.join(directory, "conversations", file)));
  if (!repository.has(id)) {
    repository.create("Recovered conversation", id);
  }
  const messages = contextMessages(items);
  if (messages.length) {
    repository.saveTurn(recoveredTurn(id, messages));
  }
  repository.markLegacySource(id, `conversation:${id}`);
  await repository.setContext(id, items);
}

async function importRun(
  repository: ThreadRepository,
  value: unknown
): Promise<void> {
  const parsed = legacyRun.safeParse(value);
  if (!parsed.success || repository.hasLegacySource(`run:${parsed.data.id}`)) {
    return;
  }
  const run = parsed.data;
  // Old run records have no conversation ID. Keep them separate; never infer a link.
  const thread = repository.create(`Recovered: ${run.input.slice(0, 65)}`);
  const turn = createTurnRecord(
    thread.id,
    run.input,
    "typed",
    run.languageCode
  );
  const interrupted = !isTerminalTurn(run.state);
  turn.state = interrupted ? "failed" : run.state;
  turn.createdAt = run.createdAt ?? turn.createdAt;
  turn.finishedAt = run.finishedAt ?? Date.now();
  turn.error = interrupted
    ? "Bolo restarted before this turn finished."
    : (run.error ?? null);
  turn.result = run.result ?? null;
  turn.progress = "Recovered history";
  turn.toolActivity = (run.toolActivity ?? []).map((activity) =>
    activity.status === "running"
      ? {
          ...activity,
          completedAt: turn.finishedAt ?? Date.now(),
          output: turn.error,
          status: "failed",
        }
      : activity
  );
  const text = turn.result ?? turn.error;
  if (text) {
    turn.messages.push({
      id: crypto.randomUUID(),
      kind: turn.result ? "result" : "error",
      role: "assistant",
      text,
    });
  }
  repository.saveTurn(turn);
  repository.markLegacySource(thread.id, `run:${run.id}`);
  await repository.setContext(thread.id, visibleContext(turn.messages));
}

export async function migrateLegacyHistory(
  repository: ThreadRepository
): Promise<void> {
  const { directory } = repository;
  if (!directory) {
    return;
  }
  for (const file of await optionalDirectory(
    path.join(directory, "conversations")
  )) {
    // biome-ignore lint/performance/noAwaitInLoops: Preserve migration checkpoints between files.
    await importConversation(repository, directory, file);
  }
  const saved = await readOptionalJson(path.join(directory, "runs.json"));
  if (!Array.isArray(saved)) {
    return;
  }
  for (const value of saved) {
    // biome-ignore lint/performance/noAwaitInLoops: Commit each recovered record before importing the next.
    await importRun(repository, value);
  }

  await repository.flush();
}

export async function importLegacyChat(
  repository: ThreadRepository,
  value: LegacyChat
): Promise<string> {
  const chat = legacyChatSchema.parse(value);
  const source = `renderer:${chat.conversationId}`;
  if (repository.hasLegacySource(source)) {
    return chat.conversationId;
  }
  if (!repository.has(chat.conversationId)) {
    repository.create("Recovered conversation", chat.conversationId);
  }
  const thread = repository.get(chat.conversationId);
  // The renderer can migrate its old transcript only before any native turns exist.
  if (
    thread.turns.every((turn) => turn.progress === "Recovered history") &&
    chat.messages.length
  ) {
    const messages: ThreadMessage[] = chat.messages.map((message) => ({
      id: crypto.randomUUID(),
      kind: message.kind === "user" ? "input" : "result",
      role: message.kind === "user" ? "user" : "assistant",
      text: message.text,
    }));
    const linkedRun = repository.findLegacyThread(`run:${chat.runId}`)
      ?.turns[0];
    const latestReply = linkedRun?.result ?? linkedRun?.error;
    if (latestReply && messages.at(-1)?.text !== latestReply) {
      messages.push({
        id: crypto.randomUUID(),
        kind: "message",
        role: "assistant",
        text: latestReply,
      });
    }
    const turn = recoveredTurn(thread.id, messages);
    if (thread.turns[0]) {
      turn.id = thread.turns[0].id;
    }
    repository.saveTurn(turn);
  }
  repository.markLegacySource(thread.id, source);
  if (!repository.getContext(thread.id).length) {
    await repository.setContext(
      thread.id,
      visibleContext(
        repository.get(thread.id).turns.flatMap((turn) => turn.messages)
      )
    );
  }
  await repository.flush();
  return thread.id;
}
