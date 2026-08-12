import crypto from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const SETTINGS_FILE = "mcp-servers.json";
const DEEPWIKI_SERVER: McpServerSettings = {
  args: [],
  command: "",
  enabled: true,
  env: {},
  headers: {},
  id: "deepwiki",
  name: "DeepWiki",
  transport: "streamable-http",
  url: "https://mcp.deepwiki.com/mcp",
};
const ENVIRONMENT_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const SERVER_ID_PATTERN = /^[a-zA-Z0-9_-]{1,100}$/;
const REMOTE_TRANSPORTS = new Set(["streamable-http", "sse"]);

function cleanString(value: unknown, maxLength: number, label: string): string {
  const text = String(value ?? "").trim();
  if (!text || text.length > maxLength) {
    throw new Error(`Invalid MCP server ${label}.`);
  }
  return text;
}

export interface McpServerSettings {
  args: string[];
  command: string;
  enabled: boolean;
  env: Record<string, string>;
  headers: Record<string, string>;
  id: string;
  name: string;
  transport: "stdio" | "streamable-http" | "sse";
  url: string;
}

export type McpServerInput = Omit<McpServerSettings, "id"> & { id?: string };

/** Persists the user-managed local MCP server definitions in Bolo's app data. */
export class McpSettingsService {
  private readonly file: string;

  constructor(dataDirectory: string) {
    this.file = path.join(dataDirectory, SETTINGS_FILE);
  }

  async list(): Promise<McpServerSettings[]> {
    try {
      const contents = await readFile(this.file, "utf8");
      const parsed: unknown = JSON.parse(contents);
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed.map((server) => this.normalize(server));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw new Error("Could not read MCP server settings.", { cause: error });
    }
  }

  async save(servers: McpServerInput[]): Promise<McpServerSettings[]> {
    if (servers.length > 20) {
      throw new Error("You can configure up to 20 MCP servers.");
    }
    const normalized = servers.map((server) => this.normalize(server));
    const names = new Set<string>();
    for (const server of normalized) {
      const key = server.name.toLocaleLowerCase();
      if (names.has(key)) {
        throw new Error("MCP server names must be unique.");
      }
      names.add(key);
    }
    await mkdir(path.dirname(this.file), { recursive: true });
    await writeFile(this.file, JSON.stringify(normalized, null, 2), {
      encoding: "utf8",
      mode: 0o600,
    });
    await chmod(this.file, 0o600);
    return normalized;
  }

  async ensureDeepWiki(): Promise<McpServerSettings[]> {
    const servers = await this.list();
    if (servers.some((server) => server.id === DEEPWIKI_SERVER.id)) {
      return servers;
    }
    return this.save([...servers, DEEPWIKI_SERVER]);
  }

  private normalize(value: unknown): McpServerSettings {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Invalid MCP server settings.");
    }
    const source = value as Record<string, unknown>;
    const transport =
      source.transport === "streamable-http" || source.transport === "sse"
        ? source.transport
        : "stdio";
    const args = Array.isArray(source.args)
      ? source.args.map((arg) => cleanString(arg, 2000, "argument"))
      : [];
    if (args.length > 100) {
      throw new Error("An MCP server can have up to 100 arguments.");
    }
    const env = this.normalizeEnvironment(source.env);
    const headers = this.normalizeHeaders(source.headers);
    const url = String(source.url ?? "").trim();
    this.validateRemoteUrl(transport, url);
    return {
      args,
      command:
        transport === "stdio"
          ? cleanString(source.command, 1000, "command")
          : String(source.command ?? "")
              .trim()
              .slice(0, 1000),
      enabled: source.enabled !== false,
      env,
      headers,
      id:
        typeof source.id === "string" && SERVER_ID_PATTERN.test(source.id)
          ? source.id
          : crypto.randomUUID(),
      name: cleanString(source.name, 100, "name"),
      transport,
      url,
    };
  }

  private normalizeEnvironment(value: unknown): Record<string, string> {
    const env: Record<string, string> = {};
    if (!value) {
      return env;
    }
    if (typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Invalid MCP server environment variables.");
    }
    for (const [key, envValue] of Object.entries(value)) {
      if (!ENVIRONMENT_NAME_PATTERN.test(key)) {
        throw new Error("Invalid MCP server environment variable name.");
      }
      env[key] = cleanString(envValue, 10_000, "environment variable");
    }
    if (Object.keys(env).length > 50) {
      throw new Error("An MCP server can have up to 50 environment variables.");
    }
    return env;
  }

  private validateRemoteUrl(transport: string, url: string): void {
    if (!REMOTE_TRANSPORTS.has(transport)) {
      return;
    }
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch (error) {
      throw new Error("Invalid remote MCP server URL.", { cause: error });
    }
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password
    ) {
      throw new Error("Remote MCP server URLs must use HTTP or HTTPS.");
    }
  }

  private normalizeHeaders(value: unknown): Record<string, string> {
    const headers: Record<string, string> = {};
    if (!value) {
      return headers;
    }
    if (typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Invalid MCP server headers.");
    }
    for (const [key, headerValue] of Object.entries(value)) {
      if (!HEADER_NAME_PATTERN.test(key)) {
        throw new Error("Invalid MCP server header name.");
      }
      headers[key] = cleanString(headerValue, 10_000, "header");
    }
    if (Object.keys(headers).length > 50) {
      throw new Error("An MCP server can have up to 50 headers.");
    }
    return headers;
  }
}
