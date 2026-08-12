import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "vitest";
import { McpSettingsService } from "../src/main/services/mcp-settings.ts";

test("persists validated local MCP server settings with private permissions", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "bolo-mcp-settings-"));
  const settings = new McpSettingsService(directory);
  try {
    const saved = await settings.save([
      {
        args: ["-y", "example-mcp"],
        command: "npx",
        enabled: true,
        env: { EXAMPLE_TOKEN: "local-value" },
        name: "Example",
      },
    ]);
    assert.equal(saved[0].id.length > 0, true);
    assert.deepEqual(await settings.list(), saved);
    const file = await stat(path.join(directory, "mcp-servers.json"));
    assert.equal(file.mode.toString(8).slice(-3), "600");
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("accepts remote HTTP MCP servers and request headers", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "bolo-mcp-remote-"));
  const settings = new McpSettingsService(directory);
  try {
    const [saved] = await settings.save([
      {
        args: [],
        command: "",
        enabled: true,
        env: {},
        headers: { Authorization: "Bearer local-token" },
        name: "Remote tools",
        transport: "streamable-http",
        url: "https://mcp.example.com/mcp",
      },
    ]);
    assert.equal(saved.transport, "streamable-http");
    assert.equal(saved.headers.Authorization, "Bearer local-token");
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("adds the DeepWiki public remote MCP server once", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "bolo-mcp-deepwiki-"));
  const settings = new McpSettingsService(directory);
  try {
    const first = await settings.ensureDeepWiki();
    const second = await settings.ensureDeepWiki();
    assert.equal(first.length, 1);
    assert.deepEqual(second, first);
    assert.deepEqual(first[0], {
      args: [],
      command: "",
      enabled: true,
      env: {},
      headers: {},
      id: "deepwiki",
      name: "DeepWiki",
      transport: "streamable-http",
      url: "https://mcp.deepwiki.com/mcp",
    });
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
