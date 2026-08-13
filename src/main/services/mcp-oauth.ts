import crypto from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  type AuthResult,
  auth,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationMixed,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";

const FILE_NAME = "mcp-oauth.json";
const REDIRECT_URL = "bolo://mcp-oauth";
const AUTHORIZATION_TIMEOUT_MS = 10 * 60 * 1000;

interface PendingAuthorization {
  createdAt: number;
  serverUrl: string;
  state: string;
}

interface OAuthRecord {
  clientInformation?: OAuthClientInformationMixed;
  codeVerifier?: string;
  discoveryState?: OAuthDiscoveryState;
  pendingAuthorization?: PendingAuthorization;
  tokens?: OAuthTokens;
}

interface OAuthServer {
  id: string;
  oauthClientId?: string;
  oauthClientSecret?: string;
  url: string;
}

type OAuthRecords = Record<string, OAuthRecord>;
type Authorize = typeof auth;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

/** OAuth token storage and PKCE callback coordination for remote MCP servers. */
export class McpOAuthService {
  private readonly authorize: Authorize;
  private readonly file: string;
  private readonly openExternal: (url: string) => Promise<void>;
  private records: OAuthRecords = {};

  constructor({
    authorize = auth,
    dataDirectory,
    openExternal,
  }: {
    authorize?: Authorize;
    dataDirectory: string;
    openExternal: (url: string) => Promise<void>;
  }) {
    this.authorize = authorize;
    this.file = path.join(dataDirectory, FILE_NAME);
    this.openExternal = openExternal;
  }

  async initialize(): Promise<void> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.file, "utf8"));
      this.records = isRecord(parsed) ? (parsed as OAuthRecords) : {};
      await this.removeExpiredAuthorizations();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new Error("Could not read MCP OAuth credentials.", {
          cause: error,
        });
      }
    }
  }

  connectionIssue(server: OAuthServer): string | null {
    const record = this.records[server.id];
    if (server.oauthClientId || record?.clientInformation || record?.tokens) {
      return null;
    }
    const metadata = record?.discoveryState?.authorizationServerMetadata;
    if (
      metadata &&
      !metadata.registration_endpoint &&
      metadata.client_id_metadata_document_supported !== true
    ) {
      return "OAuth requires a pre-registered client ID and secret. Add them in MCP Settings, save, and connect again.";
    }
    return null;
  }

  provider(server: OAuthServer): OAuthClientProvider {
    const state = crypto.randomBytes(32).toString("base64url");
    const record = (): OAuthRecord => {
      let value = this.records[server.id];
      if (!isRecord(value)) {
        value = {};
        this.records[server.id] = value;
      }
      return value;
    };
    const configuredClient = server.oauthClientId
      ? {
          client_id: server.oauthClientId,
          ...(server.oauthClientSecret
            ? { client_secret: server.oauthClientSecret }
            : {}),
        }
      : undefined;
    return {
      addClientAuthentication: server.oauthClientSecret
        ? (_headers, parameters) => {
            parameters.set("client_id", server.oauthClientId ?? "");
            parameters.set("client_secret", server.oauthClientSecret ?? "");
          }
        : undefined,
      clientInformation: () => record().clientInformation ?? configuredClient,
      get clientMetadata() {
        return {
          client_name: "Bolo",
          grant_types: ["authorization_code", "refresh_token"],
          redirect_uris: [REDIRECT_URL],
          response_types: ["code"],
          token_endpoint_auth_method: "none",
        };
      },
      codeVerifier: () => {
        const verifier = record().codeVerifier;
        if (!verifier) {
          throw new Error("The MCP OAuth verifier is missing or expired.");
        }
        return verifier;
      },
      discoveryState: () => record().discoveryState,
      invalidateCredentials: async (scope) => {
        const value = record();
        if (scope === "all" || scope === "client") {
          value.clientInformation = undefined;
        }
        if (scope === "all" || scope === "tokens") {
          value.tokens = undefined;
        }
        if (scope === "all" || scope === "verifier") {
          value.codeVerifier = undefined;
          value.pendingAuthorization = undefined;
        }
        if (scope === "all" || scope === "discovery") {
          value.discoveryState = undefined;
        }
        await this.persist();
      },
      redirectToAuthorization: async (url: URL) => {
        record().pendingAuthorization = {
          createdAt: Date.now(),
          serverUrl: server.url,
          state,
        };
        await this.persist();
        try {
          await this.openExternal(url.toString());
        } catch (error) {
          record().pendingAuthorization = undefined;
          await this.persist();
          throw error;
        }
      },
      get redirectUrl() {
        return REDIRECT_URL;
      },
      saveClientInformation: async (value) => {
        record().clientInformation = value;
        await this.persist();
      },
      saveCodeVerifier: async (value: string) => {
        record().codeVerifier = value;
        await this.persist();
      },
      saveDiscoveryState: async (value) => {
        record().discoveryState = value;
        await this.persist();
      },
      saveTokens: async (value) => {
        record().tokens = value;
        await this.persist();
      },
      state: () => state,
      tokens: () => record().tokens,
    };
  }

  start(server: OAuthServer): Promise<AuthResult> {
    return this.authorize(this.provider(server), { serverUrl: server.url });
  }

  async complete(callbackUrl: string): Promise<string | null> {
    const callback = new URL(callbackUrl);
    if (callback.protocol !== "bolo:" || callback.hostname !== "mcp-oauth") {
      return null;
    }
    const state = callback.searchParams.get("state");
    const match = state ? this.findPendingAuthorization(state) : undefined;
    if (!match) {
      throw new Error("The MCP OAuth callback is invalid or expired.");
    }

    match.record.pendingAuthorization = undefined;
    await this.persist();

    const oauthError = callback.searchParams.get("error");
    if (oauthError) {
      const description = callback.searchParams
        .get("error_description")
        ?.trim()
        .slice(0, 300);
      throw new Error(
        description
          ? `MCP OAuth was denied: ${description}`
          : `MCP OAuth was denied (${oauthError.slice(0, 100)}).`
      );
    }

    const code = callback.searchParams.get("code");
    if (!code) {
      throw new Error("The MCP OAuth callback did not include a code.");
    }
    await this.authorize(
      this.provider({ id: match.id, url: match.pending.serverUrl }),
      {
        authorizationCode: code,
        serverUrl: match.pending.serverUrl,
      }
    );
    return match.id;
  }

  private findPendingAuthorization(
    state: string
  ):
    | { id: string; pending: PendingAuthorization; record: OAuthRecord }
    | undefined {
    const now = Date.now();
    for (const [id, record] of Object.entries(this.records)) {
      const pending = record.pendingAuthorization;
      if (
        pending &&
        now - pending.createdAt <= AUTHORIZATION_TIMEOUT_MS &&
        pending.state === state
      ) {
        return { id, pending, record };
      }
    }
  }

  private async removeExpiredAuthorizations(): Promise<void> {
    const now = Date.now();
    let changed = false;
    for (const record of Object.values(this.records)) {
      const pending = record.pendingAuthorization;
      if (pending && now - pending.createdAt > AUTHORIZATION_TIMEOUT_MS) {
        record.pendingAuthorization = undefined;
        changed = true;
      }
    }
    if (changed) {
      await this.persist();
    }
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
