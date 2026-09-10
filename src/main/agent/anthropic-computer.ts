import { z } from "zod";
import { claudeAction } from "./computer-actions.ts";
import {
  auxiliaryCall,
  auxiliaryTools,
  COMPUTER_INSTRUCTIONS,
  type ComputerSession,
  parseVerification,
  type RequestJson,
  requestJson,
  toolSchema,
} from "./computer-session.ts";

const blockSchema = z.looseObject({
  text: z.string().optional(),
  type: z.string(),
});
const toolCall = z.object({
  id: z.string(),
  input: z.unknown(),
  name: z.string(),
  toolset_name: z.string().optional(),
  type: z.literal("tool_use"),
});
const responseSchema = z.object({
  content: z.array(blockSchema),
  stop_reason: z.string(),
});
export const NOT_EXECUTED =
  "Not executed: an earlier computer action in this turn failed.";

function imageContent(data: string) {
  return {
    source: { data, media_type: "image/png", type: "base64" },
    type: "image",
  };
}

async function executeCall(
  session: ComputerSession,
  call: z.infer<typeof toolCall>
): Promise<unknown> {
  if (call.toolset_name === "computer") {
    const optionalPosition = [
      "left_click",
      "right_click",
      "middle_click",
      "double_click",
      "triple_click",
      "scroll",
    ];
    if (
      optionalPosition.includes(call.name) &&
      !z.object({ coordinate: z.unknown() }).safeParse(call.input).success
    ) {
      await session.computer.execute({ type: "cursor_position" });
    }
    const action = claudeAction(call.name, call.input, session.computer.cursor);
    const result = await session.computer.execute(action);
    return result.image
      ? [{ text: result.text, type: "text" }, imageContent(result.image)]
      : result.text;
  }
  if (call.toolset_name) {
    throw new Error(`Unsupported toolset: ${call.toolset_name}`);
  }
  return JSON.stringify(await auxiliaryCall(session, call.name, call.input));
}

async function executeBatch(
  session: ComputerSession,
  calls: z.infer<typeof toolCall>[]
) {
  const results: unknown[] = [];
  let failed = false;
  for (const call of calls) {
    session.signal.throwIfAborted();
    let content: unknown = NOT_EXECUTED;
    let isError = failed;
    if (!failed) {
      try {
        // biome-ignore lint/performance/noAwaitInLoops: Run every tool in order and halt the batch on its first failure.
        content = await executeCall(session, call);
      } catch (error) {
        session.signal.throwIfAborted();
        content =
          error instanceof Error ? error.message : "Computer action failed.";
        failed = true;
        isError = true;
        await session.computer.release();
      }
    }
    results.push({
      tool_use_id: call.id,
      type: "tool_result",
      ...(call.toolset_name ? { toolset_name: call.toolset_name } : {}),
      content,
      ...(isError ? { is_error: true } : {}),
    });
  }
  return { failed, results };
}

export async function runAnthropicComputer(
  session: ComputerSession,
  task: string,
  options: {
    apiKey: string;
    model: string;
    request?: RequestJson;
    maxTurns?: number;
  }
) {
  const request = options.request ?? requestJson;
  const messages: unknown[] = [
    {
      content: [
        { text: task, type: "text" },
        imageContent(await session.computer.screenshot()),
      ],
      role: "user",
    },
  ];
  const tools = [
    { type: "computer_toolset_20260801" },
    ...auxiliaryTools.map((tool) => ({
      description: tool.description,
      input_schema: toolSchema(tool.parameters),
      name: tool.name,
    })),
  ];
  let lastBatchFailed = false;
  try {
    for (let turn = 0; turn < (options.maxTurns ?? 30); turn += 1) {
      session.signal.throwIfAborted();
      const response = responseSchema.parse(
        // biome-ignore lint/performance/noAwaitInLoops: Each provider request depends on the previous turn.
        await request(
          "https://api.anthropic.com/v1/messages",
          { "anthropic-version": "2023-06-01", "x-api-key": options.apiKey },
          {
            max_tokens: 4096,
            messages,
            model: options.model,
            system: COMPUTER_INSTRUCTIONS,
            tools,
          },
          session.signal
        )
      );
      session.signal.throwIfAborted();
      if (!["end_turn", "tool_use"].includes(response.stop_reason)) {
        throw new Error(
          `Claude computer use stopped unexpectedly: ${response.stop_reason}`
        );
      }
      messages.push({ content: response.content, role: "assistant" });
      const calls = response.content
        .filter((block) => block.type === "tool_use")
        .map((block) => toolCall.parse(block));
      if (!calls.length) {
        if (response.stop_reason === "tool_use") {
          throw new Error("Claude returned tool_use without tool calls.");
        }
        const result = parseVerification(
          response.content
            .filter((block) => block.type === "text")
            .map((block) => block.text ?? "")
            .join("\n")
        );
        return lastBatchFailed && result.status === "verified"
          ? { ...result, status: "uncertain" as const }
          : result;
      }
      const batch = await executeBatch(session, calls);
      lastBatchFailed = batch.failed;
      const { results } = batch;
      // Tool results must come first and answer every tool_use, including skipped members.
      const image = await session.computer.screenshot();
      messages.push({
        content: [
          ...results,
          { text: "Current desktop after tool results.", type: "text" },
          imageContent(image),
        ],
        role: "user",
      });
    }
    throw new Error(
      "Computer use reached the 30-turn limit without completing."
    );
  } finally {
    await session.computer.release();
  }
}
