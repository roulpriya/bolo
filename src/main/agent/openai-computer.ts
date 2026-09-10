import { z } from "zod";
import { computerAction } from "./computer-actions.ts";
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

const safetyCheck = z.object({
  code: z.string().nullish(),
  id: z.string(),
  message: z.string().nullish(),
});
const outputItem = z.discriminatedUnion("type", [
  z.object({
    actions: z.array(z.unknown()).min(1),
    call_id: z.string(),
    pending_safety_checks: z.array(safetyCheck).default([]),
    type: z.literal("computer_call"),
  }),
  z.object({
    arguments: z.string(),
    call_id: z.string(),
    name: z.string(),
    type: z.literal("function_call"),
  }),
  z.object({
    content: z.array(
      z.object({ text: z.string().optional(), type: z.string() })
    ),
    type: z.literal("message"),
  }),
  z.object({ type: z.literal("reasoning") }),
]);
const responseSchema = z.object({
  id: z.string(),
  output: z.array(outputItem),
  status: z.literal("completed"),
});
const AFFIRMATIVE =
  /^(?:yes|y|confirm|proceed|approve|haan|han|हाँ|जी हाँ)(?:\s|[.!]|$)/i;

async function executeComputerCall(
  session: ComputerSession,
  call: Extract<z.infer<typeof outputItem>, { type: "computer_call" }>
) {
  const acknowledged = call.pending_safety_checks;
  if (acknowledged.length) {
    const answer = await session.askUser(
      `The desktop reached a provider safety check: ${acknowledged.map((check) => check.message || check.code || check.id).join("; ")}. Do you want to continue?`,
      "confirmation"
    );
    session.signal.throwIfAborted();
    if (!AFFIRMATIVE.test(answer.trim())) {
      throw new Error("The user did not approve the provider safety check.");
    }
  }
  // Validate the entire batch before executing any part of it.
  const actions = call.actions.map((action) => computerAction.parse(action));
  for (const action of actions) {
    session.signal.throwIfAborted();
    // biome-ignore lint/performance/noAwaitInLoops: Computer actions must execute in provider order.
    await session.computer.execute(action);
  }
  return {
    call_id: call.call_id,
    type: "computer_call_output",
    ...(acknowledged.length
      ? { acknowledged_safety_checks: acknowledged }
      : {}),
    output: {
      detail: "original",
      image_url: `data:image/png;base64,${await session.computer.screenshot()}`,
      type: "computer_screenshot",
    },
  };
}

export async function runOpenAIComputer(
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
  const tools = [
    { type: "computer" },
    ...auxiliaryTools.map((tool) => ({
      description: tool.description,
      name: tool.name,
      parameters: toolSchema(tool.parameters),
      strict: true,
      type: "function",
    })),
  ];
  let input: unknown[] = [
    {
      content: [
        { text: task, type: "input_text" },
        {
          detail: "original",
          image_url: `data:image/png;base64,${await session.computer.screenshot()}`,
          type: "input_image",
        },
      ],
      role: "user",
    },
  ];
  let previousResponseId: string | undefined;
  try {
    for (let turn = 0; turn < (options.maxTurns ?? 30); turn += 1) {
      session.signal.throwIfAborted();
      const response = responseSchema.parse(
        // biome-ignore lint/performance/noAwaitInLoops: Each provider request depends on the previous turn.
        await request(
          "https://api.openai.com/v1/responses",
          { Authorization: `Bearer ${options.apiKey}` },
          {
            input,
            instructions: COMPUTER_INSTRUCTIONS,
            model: options.model,
            previous_response_id: previousResponseId,
            tools,
          },
          session.signal
        )
      );
      session.signal.throwIfAborted();
      previousResponseId = response.id;
      input = [];
      const finalText: string[] = [];
      for (const item of response.output) {
        if (item.type === "computer_call") {
          // biome-ignore lint/performance/noAwaitInLoops: Calls and their actions are ordered.
          input.push(await executeComputerCall(session, item));
        } else if (item.type === "function_call") {
          const result = await auxiliaryCall(
            session,
            item.name,
            JSON.parse(item.arguments)
          );
          input.push({
            call_id: item.call_id,
            output: JSON.stringify(result),
            type: "function_call_output",
          });
        } else if (item.type === "message") {
          finalText.push(
            ...item.content.flatMap((part) =>
              part.type === "output_text" && part.text ? [part.text] : []
            )
          );
        }
      }
      if (!input.length) {
        return parseVerification(finalText.join("\n"));
      }
      // A user answer can change the desktop; observe it before the next decision.
      if (!response.output.some((item) => item.type === "function_call")) {
        continue;
      }
      const image = await session.computer.screenshot();
      input.push({
        content: [
          { text: "Current desktop after tool results.", type: "input_text" },
          {
            detail: "original",
            image_url: `data:image/png;base64,${image}`,
            type: "input_image",
          },
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
