import {
  connectMcpServers,
  getAllMcpTools,
  type MCPServer,
  type MCPServers,
} from "@openai/agents";
import type { McpServerSettings } from "../services/mcp-settings.ts";

const RETRY_DELAY_MS = 30_000;

interface Connection {
  configuration: string;
  error: Error | null;
  manager: MCPServers | null;
  retryAt: number;
  server: MCPServer;
}

function connectionError(name: string, error: unknown) {
  return new Error(
    `${name}: ${error instanceof Error ? error.message : String(error)}`
  );
}

/** Owns MCP transports across turns; tool actions are never replayed on failure. */
export class McpConnections {
  private readonly connections = new Map<string, Connection>();
  private readonly createServer: (settings: McpServerSettings) => MCPServer;
  private readonly now: () => number;
  private pending = Promise.resolve();
  private closed = Boolean(false);

  constructor(
    createServer: (settings: McpServerSettings) => MCPServer,
    now: () => number = Date.now
  ) {
    this.createServer = createServer;
    this.now = now;
  }

  private enqueue<T>(operation: () => Promise<T>) {
    const result = this.pending.then(operation);
    this.pending = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  private async reconcile(settings: McpServerSettings[]) {
    if (this.closed) {
      throw new Error("MCP connections are closed.");
    }
    const configurations = new Map(
      settings.map((server) => [server.id, JSON.stringify(server)])
    );
    const obsolete = [...this.connections].filter(
      ([id, connection]) => configurations.get(id) !== connection.configuration
    );
    await Promise.all(
      obsolete.map(async ([id, connection]) => {
        await connection.manager?.close();
        this.connections.delete(id);
      })
    );
  }

  synchronize(settings: McpServerSettings[]) {
    return this.enqueue(() => this.reconcile(settings));
  }

  getTools(
    settings: McpServerSettings[],
    onConnecting: () => void,
    requestedIds = settings.map((server) => server.id)
  ) {
    return this.enqueue(async () => {
      await this.reconcile(settings);
      const connections = await Promise.all(
        settings
          .filter((server) => requestedIds.includes(server.id))
          .map((server) => this.prepare(server, onConnecting))
      );
      const active = connections
        .filter((connection) => !connection.error)
        .map((connection) => connection.server);
      return {
        errors: connections.flatMap((connection) =>
          connection.error ? [connection.error] : []
        ),
        tools: await getAllMcpTools({
          includeServerInToolNames: true,
          mcpServers: active,
        }),
      };
    });
  }

  private async prepare(settings: McpServerSettings, onConnecting: () => void) {
    let connection = this.connections.get(settings.id);
    if (connection?.error && this.now() < connection.retryAt) {
      return connection;
    }
    if (!connection || connection.error) {
      onConnecting();
      await connection?.manager?.close();
      const server = this.createServer(settings);
      connection = {
        configuration: JSON.stringify(settings),
        error: null,
        manager: null,
        retryAt: 0,
        server,
      };
      this.connections.set(settings.id, connection);
      const entry = connection;
      server.cacheToolsList = true;
      server.errorFunction = ({ error }) => {
        if (error instanceof Error && error.name === "InvalidToolInputError") {
          return "MCP tool input was invalid. Correct the arguments to match the tool schema.";
        }
        if (error instanceof Error && error.name === "AbortError") {
          return "MCP tool call was cancelled.";
        }
        entry.error = connectionError(server.name, error);
        entry.retryAt = 0;
        return "MCP tool failed. Its connection will be refreshed when its tools are next loaded. The action was not retried.";
      };
      connection.manager = await connectMcpServers([server], {
        connectTimeoutMs: 10_000,
        dropFailed: true,
        strict: false,
      });
      const connectError = connection.manager.errors.get(server);
      if (connectError) {
        connection.error = connectionError(server.name, connectError);
        connection.retryAt = this.now() + RETRY_DELAY_MS;
        return connection;
      }
    }
    try {
      // The SDK caches tool lists and invalidates them when the server changes them.
      await connection.server.listTools();
    } catch (error) {
      connection.error = connectionError(connection.server.name, error);
      connection.retryAt = this.now() + RETRY_DELAY_MS;
      await connection.manager?.close();
    }
    return connection;
  }

  close() {
    this.closed = true;
    return this.enqueue(async () => {
      await Promise.all(
        [...this.connections.values()].map((connection) =>
          connection.manager?.close()
        )
      );
      this.connections.clear();
    });
  }
}
