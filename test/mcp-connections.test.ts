import assert from "node:assert/strict";
import {
  type MCPServer,
  MemorySession,
  type Model,
  type ModelRequest,
  RunContext,
  Runner,
  Usage,
} from "@openai/agents";
import { test, vi } from "vitest";
import { AgentService } from "../src/main/agent/agent-service.ts";
import { McpConnections } from "../src/main/agent/mcp-connections.ts";
import type { McpServerSettings } from "../src/main/services/mcp-settings.ts";
import { createTurnRecord } from "../src/shared/threads.ts";

function settings(id: string): McpServerSettings {
  return {
    args: [],
    command: "test-server",
    enabled: true,
    env: {},
    headers: {},
    id,
    name: id,
    oauthClientId: "",
    oauthClientSecret: "",
    transport: "stdio",
    url: "",
  };
}

class FakeServer implements MCPServer {
  cacheToolsList = false;
  errorFunction: MCPServer["errorFunction"];
  name: string;
  connect = vi.fn(() => Promise.resolve());
  close = vi.fn(() => Promise.resolve());
  invalidateToolsCache = vi.fn(() => Promise.resolve());
  listTools = vi.fn<MCPServer["listTools"]>(() =>
    Promise.resolve([
      {
        inputSchema: {
          additionalProperties: false,
          properties: {},
          required: [],
          type: "object",
        },
        name: "lookup",
      },
    ])
  );
  callTool = vi.fn<MCPServer["callTool"]>(() =>
    Promise.resolve([{ text: "ok", type: "text" }])
  );

  constructor(name: string) {
    this.name = name;
  }
}

function fixture(now?: () => number) {
  const servers: FakeServer[] = [];
  const create = vi.fn((config: McpServerSettings) => {
    const server = new FakeServer(config.name);
    servers.push(server);
    return server;
  });
  return { create, pool: new McpConnections(create, now), servers };
}

const noop = () => undefined;

test("reuses MCP connections across consecutive and concurrent task requests", async () => {
  const { create, pool, servers } = fixture();
  const connecting = vi.fn();
  try {
    const results = await Promise.all([
      pool.getTools([settings("one")], connecting),
      pool.getTools([settings("one")], connecting),
    ]);
    await pool.getTools([settings("one")], connecting);
    assert.equal(create.mock.calls.length, 1);
    assert.equal(servers[0].connect.mock.calls.length, 1);
    assert.equal(servers[0].close.mock.calls.length, 0);
    assert.equal(servers[0].cacheToolsList, true);
    assert.equal(connecting.mock.calls.length, 1);
    assert.equal(results[0].tools[0].name, results[1].tools[0].name);
  } finally {
    await pool.close();
  }
  assert.equal(servers[0].close.mock.calls.length, 1);
});

test("replaces only changed servers and closes removed servers", async () => {
  const { pool, servers } = fixture();
  const one = settings("one");
  const two = settings("two");
  try {
    await pool.getTools([one, two], noop);
    await pool.getTools(
      [one, { ...two, headers: { Authorization: "new-token" } }],
      noop
    );
    assert.equal(servers.length, 3);
    assert.equal(servers[0].close.mock.calls.length, 0);
    assert.equal(servers[1].close.mock.calls.length, 1);
    assert.equal(servers[2].connect.mock.calls.length, 1);
    await pool.getTools([one], noop);
    assert.equal(servers[2].close.mock.calls.length, 1);
    assert.equal(servers[0].connect.mock.calls.length, 1);
    await pool.getTools([], noop);
    assert.equal(servers[0].close.mock.calls.length, 1);
  } finally {
    await pool.close();
  }
});

test("backs off failed connections and retries them without reconnecting healthy servers", async () => {
  let now = 0;
  const { pool, create, servers } = fixture(() => now);
  create.mockImplementationOnce((config) => {
    const server = new FakeServer(config.name);
    server.connect.mockRejectedValue(new Error("Offline"));
    servers.push(server);
    return server;
  });
  const configured = [settings("offline"), settings("healthy")];
  try {
    const first = await pool.getTools(configured, noop);
    assert.equal(first.errors.length, 1);
    assert.equal(first.tools.length, 1);
    await pool.getTools(configured, noop);
    assert.equal(create.mock.calls.length, 2);
    now = 31_000;
    const retried = await pool.getTools(configured, noop);
    assert.equal(retried.errors.length, 0);
    assert.equal(create.mock.calls.length, 3);
    assert.equal(servers[1].connect.mock.calls.length, 1);
    assert.equal(servers[1].close.mock.calls.length, 0);
  } finally {
    await pool.close();
  }
});

test("a failed tool refreshes only its connection on the next task without replaying the action", async () => {
  const { pool, servers } = fixture();
  try {
    const configured = [settings("one"), settings("two")];
    const { tools } = await pool.getTools(configured, noop);
    servers[0].callTool.mockRejectedValue(new Error("Connection closed"));
    const [tool] = tools;
    assert.equal(tool.type, "function");
    assert.ok("invoke" in tool);
    const result = await tool.invoke(new RunContext(), "{}");
    assert.match(String(result), /not retried/);
    assert.equal(servers[0].callTool.mock.calls.length, 1);
    await pool.getTools(configured, noop);
    assert.equal(servers.length, 3);
    assert.equal(servers[0].close.mock.calls.length, 1);
    assert.equal(servers[1].close.mock.calls.length, 0);
    assert.equal(servers[2].callTool.mock.calls.length, 0);
  } finally {
    await pool.close();
  }
});

test("shutdown waits for an in-flight connection and releases it", async () => {
  const { pool, create, servers } = fixture();
  let finish: (() => void) | undefined;
  const connected = new Promise<void>((resolve) => {
    finish = resolve;
  });
  create.mockImplementationOnce((config) => {
    const server = new FakeServer(config.name);
    server.connect.mockReturnValue(connected);
    servers.push(server);
    return server;
  });
  const request = pool.getTools([settings("one")], noop);
  await vi.waitFor(() => assert.equal(servers.length, 1));
  const closing = pool.close();
  finish?.();
  await request;
  await closing;
  assert.equal(servers[0].close.mock.calls.length, 1);
  await assert.rejects(() => pool.getTools([settings("one")], noop), /closed/);
});

test("AgentService retains transports between tasks and removes disabled servers", async () => {
  let configured = [settings("one")];
  const agent = new AgentService({
    browserProfileDirectory: process.cwd(),
    mcpServersProvider: () => Promise.resolve(configured),
    workspaceDirectory: process.cwd(),
  });
  const server = new FakeServer("one");
  const create = vi.spyOn(agent, "createMcpServer").mockReturnValue(server);
  const run: Parameters<typeof agent.createMcpTools>[0] = {
    ...createTurnRecord(crypto.randomUUID(), "test"),
    abortController: new AbortController(),
    notify: () => undefined,
  };
  try {
    await agent.createMcpTools(run, "one");
    await agent.createMcpTools(run, "one");
    assert.equal(create.mock.calls.length, 1);
    assert.equal(server.close.mock.calls.length, 0);
    configured = [{ ...configured[0], enabled: false }];
    await assert.rejects(agent.createMcpTools(run, "one"), /disabled/);
    assert.equal(server.close.mock.calls.length, 1);
  } finally {
    await agent.close();
  }
});

test("catalog synchronization never connects and loading one server leaves the others alone", async () => {
  const { pool, create, servers } = fixture();
  const configured = [settings("one"), settings("two")];
  try {
    await pool.synchronize(configured);
    assert.equal(create.mock.calls.length, 0);
    await pool.getTools(configured, noop, ["one"]);
    assert.equal(create.mock.calls.length, 1);
    await pool.getTools(configured, noop, ["two"]);
    assert.equal(create.mock.calls.length, 2);
    assert.equal(servers[0].close.mock.calls.length, 0);
    await pool.synchronize([configured[1]]);
    assert.equal(servers[0].close.mock.calls.length, 1);
    assert.equal(servers[1].close.mock.calls.length, 0);
  } finally {
    await pool.close();
  }
});

test("ordinary requests never connect to MCP and loaded tools are callable only after discovery", async () => {
  const agent = new AgentService({
    browserProfileDirectory: process.cwd(),
    mcpServersProvider: async () => [settings("one"), settings("unrelated")],
    workspaceDirectory: process.cwd(),
  });
  const server = new FakeServer("one");
  const create = vi.spyOn(agent, "createMcpServer").mockReturnValue(server);
  const requests: ModelRequest[] = [];
  let discover = false;
  let discoveryStep = 0;
  const model: Model = {
    getResponse() {
      throw new Error("Expected streaming");
    },
    async *getStreamedResponse(request) {
      requests.push(request);
      await Promise.resolve();
      const reply = {
        content: [{ text: "Done", type: "output_text" as const }],
        role: "assistant" as const,
        status: "completed" as const,
        type: "message" as const,
      };
      let output:
        | typeof reply
        | {
            type: "function_call";
            callId: string;
            name: string;
            arguments: string;
          } = reply;
      if (discover) {
        discoveryStep += 1;
        if (discoveryStep === 1) {
          assert.equal(server.connect.mock.calls.length, 0);
          assert.ok(
            request.tools.some((tool) => tool.name === "load_mcp_tools")
          );
          output = {
            arguments: '{"serverId":"one"}',
            callId: "load-one",
            name: "load_mcp_tools",
            type: "function_call",
          };
        } else if (discoveryStep === 2) {
          output = {
            arguments: '{"serverId":"one"}',
            callId: "load-one-again",
            name: "load_mcp_tools",
            type: "function_call",
          };
        } else if (discoveryStep === 3) {
          assert.equal(
            request.tools.filter((tool) => tool.name.includes("lookup")).length,
            1
          );
          const loaded = request.tools.find((tool) =>
            tool.name.includes("lookup")
          );
          assert.ok(loaded);
          output = {
            arguments: "{}",
            callId: "lookup-one",
            name: loaded.name,
            type: "function_call",
          };
        }
      }
      yield {
        response: {
          id: `response-${requests.length}`,
          output: [output],
          usage: new Usage(),
        },
        type: "response_done",
      };
    },
  };
  agent.runner = new Runner({
    modelProvider: { getModel: () => model },
    tracingDisabled: true,
  });
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  const session = new MemorySession();
  const execute = (input: string) =>
    agent.execute(
      {
        ...createTurnRecord(crypto.randomUUID(), input),
        abortController: new AbortController(),
        notify: noop,
      },
      async () => "yes",
      noop,
      session
    );
  try {
    await execute("Hello");
    assert.equal(create.mock.calls.length, 0);
    assert.equal(server.listTools.mock.calls.length, 0);
    discover = true;
    await execute("Use server one");
    assert.equal(create.mock.calls.length, 1);
    assert.equal(create.mock.calls[0][0].id, "one");
    assert.equal(server.callTool.mock.calls.length, 1);
    discover = false;
    const listings = server.listTools.mock.calls.length;
    await execute("Thank you");
    assert.equal(server.listTools.mock.calls.length, listings);
    assert.equal(server.connect.mock.calls.length, 1);
    assert.ok(
      !requests.at(-1)?.tools.some((tool) => tool.name.includes("lookup"))
    );
  } finally {
    vi.unstubAllEnvs();
    await agent.close();
  }
});

test("cancelling MCP discovery rejects late tools and never connects an unrelated server", async () => {
  const agent = new AgentService({
    browserProfileDirectory: process.cwd(),
    mcpServersProvider: async () => [settings("one"), settings("unrelated")],
    workspaceDirectory: process.cwd(),
  });
  const server = new FakeServer("one");
  let finish: () => void = noop;
  server.connect.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  const create = vi.spyOn(agent, "createMcpServer").mockReturnValue(server);
  const run = {
    ...createTurnRecord(crypto.randomUUID(), "Use one"),
    abortController: new AbortController(),
    notify: noop,
  };
  try {
    const loading = agent.createMcpTools(run, "one");
    await vi.waitFor(() => assert.equal(server.connect.mock.calls.length, 1));
    run.abortController.abort();
    finish();
    await assert.rejects(loading, { name: "AbortError" });
    assert.equal(create.mock.calls.length, 1);
    assert.equal(server.callTool.mock.calls.length, 0);
    await assert.rejects(agent.createMcpTools(run, "unrelated"), {
      name: "AbortError",
    });
    assert.equal(create.mock.calls.length, 1);
  } finally {
    finish();
    await agent.close();
  }
});

test("invalid tool arguments do not discard a healthy MCP connection", async () => {
  const { pool, servers } = fixture();
  try {
    const configured = [settings("one")];
    const { tools } = await pool.getTools(configured, noop);
    const [tool] = tools;
    assert.ok("invoke" in tool);
    const result = await tool.invoke(new RunContext(), "not JSON");
    assert.match(String(result), /input was invalid/);
    await pool.getTools(configured, noop);
    assert.equal(servers.length, 1);
    assert.equal(servers[0].close.mock.calls.length, 0);
    assert.equal(servers[0].callTool.mock.calls.length, 0);
  } finally {
    await pool.close();
  }
});
