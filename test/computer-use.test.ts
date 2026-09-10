import assert from "node:assert/strict";
import { test } from "vitest";
import { z } from "zod";
import {
  NOT_EXECUTED,
  runAnthropicComputer,
} from "../src/main/agent/anthropic-computer.ts";
import {
  claudeAction,
  computerAction,
  normalizeKey,
} from "../src/main/agent/computer-actions.ts";
import {
  type ComputerSession,
  computerConfiguration,
  type RequestJson,
} from "../src/main/agent/computer-session.ts";
import { DesktopComputer } from "../src/main/agent/desktop-computer.ts";
import { runOpenAIComputer } from "../src/main/agent/openai-computer.ts";

const frame = {
  displayHeight: 1600,
  displayId: 1,
  displayWidth: 2560,
  height: 800,
  image: "png",
  width: 1280,
};
function desktopHarness() {
  const controller = new AbortController();
  const commands: Record<string, unknown>[] = [];
  const computer = new DesktopComputer({
    command: (command, signal) => {
      signal?.throwIfAborted();
      commands.push(command);
      if (command.type === "screenshot") {
        return Promise.resolve(frame);
      }
      if (command.type === "cursor_position") {
        return Promise.resolve({ x: 30, y: 40 });
      }
      if (command.type === "zoom") {
        return Promise.resolve({ image: "zoom-png" });
      }
      return Promise.resolve({});
    },
    signal: controller.signal,
  });
  return { commands, computer, controller };
}
function sessionHarness() {
  const harness = desktopHarness();
  const session: ComputerSession = {
    askUser: async () => "yes",
    computer: harness.computer,
    signal: harness.controller.signal,
  };
  return { ...harness, session };
}
function requests(responses: unknown[]) {
  const bodies: Record<string, unknown>[] = [];
  const urls: string[] = [];
  const request: RequestJson = (url, _headers, body) => {
    urls.push(url);
    bodies.push(structuredClone(body));
    const response = responses.shift();
    if (!response) {
      throw new Error("Unexpected extra model request");
    }
    return Promise.resolve(response);
  };
  return { bodies, request, urls };
}
const done = {
  text: '{"status":"verified","evidence":"Visible PASS"}',
  type: "text",
};
function openAIResponse(output: unknown[], id = "response-1") {
  return { id, output, status: "completed" };
}
function claudeCall(
  id: string,
  name: string,
  input: unknown,
  toolset_name: string | undefined = "computer"
) {
  return {
    id,
    input,
    name,
    type: "tool_use",
    ...(toolset_name ? { toolset_name } : {}),
  };
}

const list = z.array(z.record(z.string(), z.unknown()));

test("desktop config is independent of the existing browser model", () => {
  assert.deepEqual(
    computerConfiguration({
      OPENAI_API_KEY: "test",
      OPENAI_COMPUTER_MODEL: "browser-model",
    }),
    { apiKey: "test", model: "gpt-5.6-sol", provider: "openai" }
  );
  assert.equal(
    computerConfiguration({
      ANTHROPIC_API_KEY: "test",
      COMPUTER_USE_PROVIDER: "anthropic",
    }).model,
    "claude-opus-5"
  );
  assert.throws(() =>
    computerConfiguration({ COMPUTER_USE_PROVIDER: "other" })
  );
  assert.throws(
    () => computerConfiguration({ COMPUTER_USE_PROVIDER: "anthropic" }),
    /ANTHROPIC_API_KEY/
  );
});

test("normalizes both provider formats and rejects malformed actions", () => {
  assert.equal(normalizeKey("Page_Down"), "PageDown");
  assert.equal(normalizeKey("super"), "Meta");
  assert.deepEqual(
    computerAction.parse({ path: [{ x: 1, y: 2 }, [3, 4]], type: "drag" }),
    {
      keys: [],
      path: [
        [1, 2],
        [3, 4],
      ],
      type: "drag",
    }
  );
  assert.equal(
    claudeAction("triple_click", { text: "ctrl+shift" }, [10, 20]).type,
    "click"
  );
  assert.deepEqual(
    claudeAction(
      "scroll",
      { scroll_amount: 3, scroll_direction: "left" },
      [10, 20]
    ),
    { keys: [], scroll_x: -300, scroll_y: 0, type: "scroll", x: 10, y: 20 }
  );
  for (const value of [
    { path: [[1, 2]], type: "drag" },
    { type: "click", x: Number.NaN, y: 2 },
    { button: "back", type: "click", x: 1, y: 1 },
    { keys: [], type: "keypress" },
    { duration: 301, type: "wait" },
  ]) {
    assert.equal(computerAction.safeParse(value).success, false);
  }
});

test("desktop actions carry screenshot scaling and execute modifier drag in order", async () => {
  const { computer, commands } = desktopHarness();
  await computer.screenshot();
  await computer.execute({
    keys: ["CTRL"],
    path: [
      [10, 20],
      [30, 40],
    ],
    type: "drag",
  });
  assert.deepEqual(
    commands.map((item) => item.type),
    [
      "screenshot",
      "key_down",
      "move",
      "mouse_down",
      "move",
      "mouse_up",
      "key_up",
    ]
  );
  assert.equal(commands[2].displayWidth, 2560);
  assert.equal(commands[2].width, 1280);
  assert.equal(commands[4].dragging, true);
  assert.deepEqual(commands[2].keys, ["Control"]);
  const count = commands.length;
  await assert.rejects(
    computer.execute({
      path: [
        [1, 1],
        [1280, 1],
      ],
      type: "drag",
    }),
    /outside/
  );
  assert.equal(commands.length, count);
});

test("cancellation during a held key releases it without using the aborted signal", async () => {
  const { computer, commands, controller } = desktopHarness();
  await computer.screenshot();
  const running = computer.execute({
    duration: 30,
    keys: ["SHIFT"],
    type: "hold_key",
  });
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  await assert.rejects(running, /abort/i);
  assert.equal(commands.at(-1)?.type, "key_up");
  assert.deepEqual(commands.at(-1)?.keys, []);
});

test("mouse release runs when a drag step fails", async () => {
  const { computer, commands } = desktopHarness();
  const { command } = computer;
  computer.command = (action, signal) => {
    if (action.dragging) {
      throw new Error("move failed");
    }
    return command(action, signal);
  };
  await computer.screenshot();
  await assert.rejects(
    computer.execute({
      keys: ["SHIFT"],
      path: [
        [1, 1],
        [2, 2],
      ],
      type: "drag",
    }),
    /move failed/
  );
  assert.deepEqual(
    commands.slice(-2).map((item) => item.type),
    ["mouse_up", "key_up"]
  );
});

test("OpenAI executes batches and returns screenshots with matching call and response IDs", async () => {
  const { session, commands } = sessionHarness();
  const harness = requests([
    openAIResponse([
      {
        actions: [
          { button: "wheel", type: "click", x: 10, y: 20 },
          { text: "नमस्ते", type: "type" },
        ],
        call_id: "call-1",
        type: "computer_call",
      },
    ]),
    openAIResponse(
      [{ content: [{ ...done, type: "output_text" }], type: "message" }],
      "response-2"
    ),
  ]);
  const result = await runOpenAIComputer(session, "Type text", {
    apiKey: "test",
    model: "test-model",
    request: harness.request,
  });
  assert.equal(result.status, "verified");
  assert.equal(harness.bodies[1].previous_response_id, "response-1");
  const outputs = list.parse(harness.bodies[1].input);
  assert.equal(outputs[0].call_id, "call-1");
  assert.deepEqual(outputs[0].output, {
    detail: "original",
    image_url: "data:image/png;base64,png",
    type: "computer_screenshot",
  });
  assert.deepEqual(
    commands.map((item) => item.type),
    ["screenshot", "move", "click", "type", "screenshot"]
  );
});

test("OpenAI safety checks require approval before any action and echo acknowledgments", async () => {
  const check = {
    code: "confirmation",
    id: "safety-1",
    message: "Confirm action",
  };
  for (const answer of ["no", "yes"]) {
    const { session, commands } = sessionHarness();
    session.askUser = async () => answer;
    const harness = requests([
      openAIResponse([
        {
          actions: [{ text: "hello", type: "type" }],
          call_id: "call-1",
          pending_safety_checks: [check],
          type: "computer_call",
        },
      ]),
      openAIResponse([
        { content: [{ ...done, type: "output_text" }], type: "message" },
      ]),
    ]);
    const run = runOpenAIComputer(session, "Test", {
      apiKey: "test",
      model: "test",
      request: harness.request,
    });
    if (answer === "no") {
      await assert.rejects(run, /did not approve/);
      assert.deepEqual(
        commands.map((item) => item.type),
        ["screenshot"]
      );
    } else {
      await run;
      assert.deepEqual(
        list.parse(harness.bodies[1].input)[0].acknowledged_safety_checks,
        [check]
      );
    }
  }
});

test("OpenAI stops on failed actions without executing later actions", async () => {
  const { session, commands } = sessionHarness();
  const harness = requests([
    openAIResponse([
      {
        actions: [
          { type: "click", x: 1500, y: 10 },
          { text: "must not run", type: "type" },
        ],
        call_id: "call-1",
        type: "computer_call",
      },
    ]),
  ]);
  await assert.rejects(
    runOpenAIComputer(session, "Test", {
      apiKey: "test",
      model: "test",
      request: harness.request,
    }),
    /outside/
  );
  assert.equal(
    commands.some((item) => item.type === "type"),
    false
  );
});

test("Claude answers all batch members, echoes toolsets and halts dependent actions after failure", async () => {
  const { session, commands } = sessionHarness();
  const harness = requests([
    {
      content: [
        claudeCall("1", "left_click", { coordinate: [10, 20] }),
        claudeCall("2", "mouse_move", { coordinate: [9999, 1] }),
        claudeCall("3", "type", { text: "must not run" }),
      ],
      stop_reason: "tool_use",
    },
    { content: [done], stop_reason: "end_turn" },
  ]);
  const result = await runAnthropicComputer(session, "Test", {
    apiKey: "test",
    model: "test",
    request: harness.request,
  });
  assert.equal(result.status, "uncertain");
  assert.equal(
    commands.some((item) => item.type === "type"),
    false
  );
  const messages = list.parse(harness.bodies[1].messages);
  const results = list.parse(messages[2].content);
  assert.deepEqual(
    results.slice(0, 3).map((item) => item.tool_use_id),
    ["1", "2", "3"]
  );
  assert.ok(
    results.slice(0, 3).every((item) => item.toolset_name === "computer")
  );
  assert.equal(results[1].is_error, true);
  assert.equal(results[2].content, NOT_EXECUTED);
});

test("Claude supports screenshot, zoom, omitted click coordinates and custom questions", async () => {
  const { session, commands } = sessionHarness();
  const harness = requests([
    {
      content: [
        claudeCall("1", "left_click", {}),
        claudeCall("2", "zoom", { region: [10, 10, 50, 50] }),
        claudeCall("3", "screenshot", {}),
        {
          id: "4",
          input: { kind: "confirmation", prompt: "Continue?" },
          name: "ask_user_question",
          type: "tool_use",
        },
      ],
      stop_reason: "tool_use",
    },
    { content: [done], stop_reason: "end_turn" },
  ]);
  await runAnthropicComputer(session, "Test", {
    apiKey: "test",
    model: "test",
    request: harness.request,
  });
  assert.ok(
    commands.some(
      (item) => item.type === "move" && item.x === 30 && item.y === 40
    )
  );
  const messages = list.parse(harness.bodies[1].messages);
  const results = list.parse(messages[2].content);
  assert.equal(list.parse(results[1].content)[1].type, "image");
  assert.equal(results[3].toolset_name, undefined);
  assert.deepEqual(list.parse(harness.bodies[0].tools)[0], {
    type: "computer_toolset_20260801",
  });
});

test("truncated responses and iteration limits cannot report completion", async () => {
  const { session } = sessionHarness();
  const harness = requests([{ content: [done], stop_reason: "max_tokens" }]);
  await assert.rejects(
    runAnthropicComputer(session, "Test", {
      apiKey: "test",
      model: "test",
      request: harness.request,
    }),
    /max_tokens/
  );
  const looping = requests([
    openAIResponse([
      {
        actions: [{ type: "screenshot" }],
        call_id: "1",
        type: "computer_call",
      },
    ]),
  ]);
  await assert.rejects(
    runOpenAIComputer(session, "Test", {
      apiKey: "test",
      maxTurns: 1,
      model: "test",
      request: looping.request,
    }),
    /turn limit/
  );
});
