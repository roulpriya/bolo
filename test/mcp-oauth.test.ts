import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { test } from "vitest";
import { McpOAuthService } from "../src/main/services/mcp-oauth.ts";

const server = { id: "remote-tools", url: "https://mcp.example.com/mcp" };
let exchangedVerifier = "";

const fakeAuthorize = async (
  provider: OAuthClientProvider,
  options: { authorizationCode?: string; serverUrl: string | URL }
) => {
  if (options.authorizationCode) {
    exchangedVerifier = await provider.codeVerifier();
    await provider.saveTokens({
      access_token: "access-token",
      token_type: "bearer",
    });
    return "AUTHORIZED" as const;
  }

  await provider.saveCodeVerifier("pkce-verifier");
  const authorizationUrl = new URL("https://auth.example.com/authorize");
  authorizationUrl.searchParams.set("state", String(await provider.state?.()));
  await provider.redirectToAuthorization(authorizationUrl);
  return "REDIRECT" as const;
};

test("resumes an MCP OAuth callback after an app restart", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "bolo-mcp-oauth-"));
  let authorizationUrl = "";
  try {
    const firstService = new McpOAuthService({
      authorize: fakeAuthorize,
      dataDirectory: directory,
      openExternal: (url) => {
        authorizationUrl = url;
        return Promise.resolve();
      },
    });
    await firstService.initialize();
    assert.equal(await firstService.start(server), "REDIRECT");

    const state = new URL(authorizationUrl).searchParams.get("state");
    assert.ok(state);
    const credentialsFile = path.join(directory, "mcp-oauth.json");
    assert.equal(
      (await stat(credentialsFile)).mode.toString(8).slice(-3),
      "600"
    );

    const restartedService = new McpOAuthService({
      authorize: fakeAuthorize,
      dataDirectory: directory,
      openExternal: async () => undefined,
    });
    await restartedService.initialize();
    assert.equal(
      await restartedService.complete(
        `bolo://mcp-oauth?code=authorization-code&state=${state}`
      ),
      server.id
    );
    assert.equal(exchangedVerifier, "pkce-verifier");

    const stored = JSON.parse(await readFile(credentialsFile, "utf8"));
    assert.equal(stored[server.id].tokens.access_token, "access-token");
    assert.equal(stored[server.id].pendingAuthorization, undefined);
    await assert.rejects(
      restartedService.complete(
        `bolo://mcp-oauth?code=replayed-code&state=${state}`
      ),
      /invalid or expired/
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("reports an OAuth denial and consumes its state", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "bolo-mcp-denied-"));
  let authorizationUrl = "";
  try {
    const oauth = new McpOAuthService({
      authorize: fakeAuthorize,
      dataDirectory: directory,
      openExternal: (url) => {
        authorizationUrl = url;
        return Promise.resolve();
      },
    });
    await oauth.initialize();
    await oauth.start(server);
    const state = new URL(authorizationUrl).searchParams.get("state");
    assert.ok(state);

    await assert.rejects(
      oauth.complete(
        `bolo://mcp-oauth?error=access_denied&error_description=User%20cancelled&state=${state}`
      ),
      /MCP OAuth was denied: User cancelled/
    );
    await assert.rejects(
      oauth.complete(`bolo://mcp-oauth?code=late-code&state=${state}`),
      /invalid or expired/
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("ignores callback URLs for other protocols", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "bolo-mcp-ignore-"));
  try {
    const oauth = new McpOAuthService({
      authorize: fakeAuthorize,
      dataDirectory: directory,
      openExternal: async () => undefined,
    });
    await oauth.initialize();
    assert.equal(await oauth.complete("https://example.com/callback"), null);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("uses configured OAuth client credentials", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "bolo-mcp-client-"));
  try {
    const oauth = new McpOAuthService({
      authorize: fakeAuthorize,
      dataDirectory: directory,
      openExternal: async () => undefined,
    });
    await oauth.initialize();
    const provider = oauth.provider({
      ...server,
      oauthClientId: "registered-client",
      oauthClientSecret: "registered-secret",
    });

    assert.deepEqual(await provider.clientInformation(), {
      client_id: "registered-client",
      client_secret: "registered-secret",
    });
    const headers = new Headers();
    const parameters = new URLSearchParams();
    await provider.addClientAuthentication?.(
      headers,
      parameters,
      "https://auth.example.com/token"
    );
    assert.equal(parameters.get("client_id"), "registered-client");
    assert.equal(parameters.get("client_secret"), "registered-secret");
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("identifies servers that require a pre-registered OAuth client", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "bolo-mcp-preflight-"));
  try {
    const oauth = new McpOAuthService({
      authorize: fakeAuthorize,
      dataDirectory: directory,
      openExternal: async () => undefined,
    });
    await oauth.initialize();
    await oauth.provider(server).saveDiscoveryState?.({
      authorizationServerMetadata: {
        authorization_endpoint: "https://auth.example.com/authorize",
        issuer: "https://auth.example.com",
        response_types_supported: ["code"],
        token_endpoint: "https://auth.example.com/token",
      },
      authorizationServerUrl: "https://auth.example.com",
    });

    assert.match(oauth.connectionIssue(server) ?? "", /pre-registered/);
    assert.equal(
      oauth.connectionIssue({ ...server, oauthClientId: "registered-client" }),
      null
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
