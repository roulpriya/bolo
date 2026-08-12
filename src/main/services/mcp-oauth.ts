import crypto from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { auth } from "@modelcontextprotocol/sdk/client/auth.js";

const FILE_NAME = "mcp-oauth.json";
const REDIRECT_URL = "bolo://mcp-oauth";

type OAuthRecord = Record<string, Record<string, unknown>>;

/** OAuth token storage and PKCE callback coordination for remote MCP servers. */
export class McpOAuthService {
  private readonly file: string;
  private readonly openExternal: (url: string) => Promise<void>;
  private readonly pending = new Map<string, { id: string; url: string }>();
  private records: OAuthRecord = {};

  constructor({
    dataDirectory,
    openExternal,
  }: { dataDirectory: string; openExternal: (url: string) => Promise<void> }) {
    this.file = path.join(dataDirectory, FILE_NAME);
    this.openExternal = openExternal;
  }

  async initialize(): Promise<void> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.file, "utf8"));
      this.records =
        parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? (parsed as OAuthRecord)
          : {};
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new Error("Could not read MCP OAuth credentials.", {
          cause: error,
        });
      }
    }
  }

  provider(server: { id: string; url: string }) {
    const state = crypto.randomUUID();
    const record = () => {
      let value = this.records[server.id];
      if (!value) {
        value = {};
        this.records[server.id] = value;
      }
      return value;
    };
    return {
      clientInformation: () => record().clientInformation,
      get clientMetadata() {
        return {
          client_name: "Bolo",
          grant_types: ["authorization_code", "refresh_token"],
          redirect_uris: [REDIRECT_URL],
          response_types: ["code"],
          token_endpoint_auth_method: "none",
        };
      },
      codeVerifier: () => String(record().codeVerifier ?? ""),
      discoveryState: () => record().discoveryState,
      redirectToAuthorization: async (url: URL) => {
        this.pending.set(state, server);
        await this.openExternal(url.toString());
      },
      get redirectUrl() {
        return REDIRECT_URL;
      },
      saveClientInformation: async (value: Record<string, unknown>) => {
        record().clientInformation = value;
        await this.persist();
      },
      saveCodeVerifier: async (value: string) => {
        record().codeVerifier = value;
        await this.persist();
      },
      saveDiscoveryState: async (value: Record<string, unknown>) => {
        record().discoveryState = value;
        await this.persist();
      },
      saveTokens: async (value: Record<string, unknown>) => {
        record().tokens = value;
        await this.persist();
      },
      state: () => state,
      tokens: () => record().tokens,
    };
  }

  async start(server: { id: string; url: string }): Promise<void> {
    await auth(this.provider(server), { serverUrl: server.url });
  }

  async complete(callbackUrl: string): Promise<string | null> {
    const callback = new URL(callbackUrl);
    if (callback.protocol !== "bolo:" || callback.hostname !== "mcp-oauth") {
      return null;
    }
    const state = callback.searchParams.get("state");
    const code = callback.searchParams.get("code");
    if (!(state && code && this.pending.has(state))) {
      throw new Error("The MCP OAuth callback is invalid or expired.");
    }
    const server = this.pending.get(state);
    this.pending.delete(state);
    await auth(this.provider(server), {
      authorizationCode: code,
      serverUrl: server.url,
    });
    return server.id;
  }

  private async persist(): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true });
    await writeFile(this.file, JSON.stringify(this.records, null, 2), {
      encoding: "utf8",
      mode: 0o600,
    });
    await chmod(this.file, 0o600);
  }
}
