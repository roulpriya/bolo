import { Plus, Save, Trash2 } from "lucide-react";
import { type ChangeEvent, useCallback, useEffect, useState } from "react";

interface McpServer {
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

const emptyServer = (): McpServer => ({
  args: [],
  command: "",
  enabled: true,
  env: {},
  headers: {},
  id: crypto.randomUUID(),
  name: "",
  transport: "stdio",
  url: "",
});
const envToText = (env: Record<string, string>) =>
  Object.entries(env)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
const textToEnv = (text: string): Record<string, string> =>
  Object.fromEntries(
    text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const separator = line.indexOf("=");
        if (separator < 1) {
          throw new Error(
            "Environment variables must use NAME=value, one per line."
          );
        }
        return [line.slice(0, separator).trim(), line.slice(separator + 1)];
      })
  );

function ServerCard({
  server,
  environment,
  headers,
  onHeadersChange,
  onOAuth,
  onEnvChange,
  onRemove,
  onUpdate,
}: {
  server: McpServer;
  environment: string;
  headers: string;
  onHeadersChange: (id: string, value: string) => void;
  onOAuth: (id: string) => void;
  onEnvChange: (id: string, value: string) => void;
  onRemove: (id: string) => void;
  onUpdate: (id: string, changes: Partial<McpServer>) => void;
}) {
  const onEnabled = useCallback(
    (event: ChangeEvent<HTMLInputElement>) =>
      onUpdate(server.id, { enabled: event.target.checked }),
    [onUpdate, server.id]
  );
  const onName = useCallback(
    (event: ChangeEvent<HTMLInputElement>) =>
      onUpdate(server.id, { name: event.target.value }),
    [onUpdate, server.id]
  );
  const onCommand = useCallback(
    (event: ChangeEvent<HTMLInputElement>) =>
      onUpdate(server.id, { command: event.target.value }),
    [onUpdate, server.id]
  );
  const onArgs = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) =>
      onUpdate(server.id, {
        args: event.target.value.split("\n").filter((item) => item.length > 0),
      }),
    [onUpdate, server.id]
  );
  const onEnvironment = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) =>
      onEnvChange(server.id, event.target.value),
    [onEnvChange, server.id]
  );
  const onDelete = useCallback(
    () => onRemove(server.id),
    [onRemove, server.id]
  );
  const onTransport = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) =>
      onUpdate(server.id, {
        transport: event.target.value as McpServer["transport"],
      }),
    [onUpdate, server.id]
  );
  const onUrl = useCallback(
    (event: ChangeEvent<HTMLInputElement>) =>
      onUpdate(server.id, { url: event.target.value }),
    [onUpdate, server.id]
  );
  const onHeaders = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) =>
      onHeadersChange(server.id, event.target.value),
    [onHeadersChange, server.id]
  );
  const onConnectOAuth = useCallback(
    () => onOAuth(server.id),
    [onOAuth, server.id]
  );
  return (
    <article className="server-card">
      <div className="server-card-header">
        <label className="toggle-label">
          <input
            checked={server.enabled}
            onChange={onEnabled}
            type="checkbox"
          />
          Enabled
        </label>
        <button
          aria-label={`Remove ${server.name || "MCP server"}`}
          className="remove-button"
          onClick={onDelete}
          type="button"
        >
          <Trash2 aria-hidden="true" />
        </button>
      </div>
      <label>
        Name
        <input
          maxLength={100}
          onChange={onName}
          placeholder="Filesystem"
          value={server.name}
        />
      </label>
      <label>
        Transport
        <select onChange={onTransport} value={server.transport}>
          <option value="stdio">Local stdio</option>
          <option value="streamable-http">Remote Streamable HTTP</option>
          <option value="sse">Remote SSE</option>
        </select>
      </label>
      {server.transport === "stdio" ? (
        <>
          <label>
            Command
            <input
              maxLength={1000}
              onChange={onCommand}
              placeholder="npx"
              spellCheck={false}
              value={server.command}
            />
          </label>
          <label>
            Arguments <span>one per line</span>
            <textarea
              className="settings-textarea"
              onChange={onArgs}
              placeholder={
                "-y\n@modelcontextprotocol/server-filesystem\n/Users/me/Documents"
              }
              spellCheck={false}
              value={server.args.join("\n")}
            />
          </label>
          <button
            className="settings-action"
            onClick={onConnectOAuth}
            type="button"
          >
            Connect with OAuth
          </button>
        </>
      ) : (
        <>
          <label>
            Server URL
            <input
              onChange={onUrl}
              placeholder="https://mcp.example.com/mcp"
              spellCheck={false}
              type="url"
              value={server.url}
            />
          </label>
          <label>
            Request headers <span>NAME=value, one per line</span>
            <textarea
              className="settings-textarea"
              onChange={onHeaders}
              placeholder="Authorization=Bearer …"
              spellCheck={false}
              value={headers}
            />
          </label>
        </>
      )}
      {server.transport === "stdio" ? (
        <label>
          Environment <span>NAME=value, one per line</span>
          <textarea
            className="settings-textarea"
            onChange={onEnvironment}
            placeholder="API_BASE_URL=https://example.com"
            spellCheck={false}
            value={environment}
          />
        </label>
      ) : null}
    </article>
  );
}

export function SettingsPage() {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [envText, setEnvText] = useState<Record<string, string>>({});
  const [headerText, setHeaderText] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("Loading MCP servers…");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    window.boloDesktop
      .getMcpServers()
      .then((items) => {
        setServers(items);
        setEnvText(
          Object.fromEntries(
            items.map((item) => [item.id, envToText(item.env)])
          )
        );
        setHeaderText(
          Object.fromEntries(
            items.map((item) => [item.id, envToText(item.headers)])
          )
        );
        setMessage(items.length ? "" : "No MCP servers configured yet.");
      })
      .catch((error: unknown) =>
        setMessage(
          error instanceof Error ? error.message : "Could not load MCP servers."
        )
      );
  }, []);
  const update = useCallback(
    (id: string, changes: Partial<McpServer>) =>
      setServers((items) =>
        items.map((server) =>
          server.id === id ? { ...server, ...changes } : server
        )
      ),
    []
  );
  const updateEnvironment = useCallback(
    (id: string, value: string) =>
      setEnvText((items) => ({ ...items, [id]: value })),
    []
  );
  const updateHeaders = useCallback(
    (id: string, value: string) =>
      setHeaderText((items) => ({ ...items, [id]: value })),
    []
  );
  const startOAuth = useCallback((id: string) => {
    window.boloDesktop
      .startMcpOAuth(id)
      .then(() =>
        setMessage("Complete sign-in in your browser, then return to Bolo.")
      )
      .catch((error: unknown) =>
        setMessage(
          error instanceof Error ? error.message : "Could not start MCP OAuth."
        )
      );
  }, []);
  const addServer = useCallback(() => {
    const server = emptyServer();
    setServers((items) => [...items, server]);
    setEnvText((items) => ({ ...items, [server.id]: "" }));
    setHeaderText((items) => ({ ...items, [server.id]: "" }));
    setMessage("");
  }, []);
  const removeServer = useCallback((id: string) => {
    setServers((items) => items.filter((server) => server.id !== id));
    setEnvText((items) => {
      const { [id]: _removed, ...remaining } = items;
      return remaining;
    });
    setHeaderText((items) => {
      const { [id]: _removed, ...remaining } = items;
      return remaining;
    });
  }, []);
  const save = useCallback(async () => {
    try {
      setSaving(true);
      const saved = await window.boloDesktop.saveMcpServers(
        servers.map((server) => ({
          ...server,
          env: textToEnv(envText[server.id] ?? ""),
          headers: textToEnv(headerText[server.id] ?? ""),
        }))
      );
      setServers(saved);
      setEnvText(
        Object.fromEntries(
          saved.map((server) => [server.id, envToText(server.env)])
        )
      );
      setHeaderText(
        Object.fromEntries(
          saved.map((server) => [server.id, envToText(server.headers)])
        )
      );
      setMessage("Saved. Enabled servers are available in new agent tasks.");
    } catch (error: unknown) {
      setMessage(
        error instanceof Error ? error.message : "Could not save MCP servers."
      );
    } finally {
      setSaving(false);
    }
  }, [envText, headerText, servers]);
  return (
    <main className="settings-page">
      <header className="settings-header">
        <div>
          <h1>MCP Servers</h1>
          <p>Add local stdio servers for Bolo to use in new tasks.</p>
        </div>
        <button className="settings-action" onClick={addServer} type="button">
          <Plus aria-hidden="true" /> Add server
        </button>
      </header>
      <p className="settings-notice">
        Environment values are saved locally in Bolo’s app data. Only add
        servers you trust.
      </p>
      <section aria-label="MCP servers" className="server-list">
        {servers.map((server) => (
          <ServerCard
            environment={envText[server.id] ?? ""}
            headers={headerText[server.id] ?? ""}
            key={server.id}
            onEnvChange={updateEnvironment}
            onHeadersChange={updateHeaders}
            onOAuth={startOAuth}
            onRemove={removeServer}
            onUpdate={update}
            server={server}
          />
        ))}
      </section>
      <footer className="settings-footer">
        <span aria-live="polite">{message}</span>
        <button
          className="settings-action primary"
          disabled={saving}
          onClick={save}
          type="button"
        >
          <Save aria-hidden="true" /> {saving ? "Saving…" : "Save changes"}
        </button>
      </footer>
    </main>
  );
}
