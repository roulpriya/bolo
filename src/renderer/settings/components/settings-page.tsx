import { Pencil, Plug, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "../../ui/button";
import { SegmentedControl } from "../../ui/segmented-control";
import { Sheet } from "../../ui/sheet";
import { Switch } from "../../ui/switch";
import { TextField } from "../../ui/text-field";

interface McpServer {
  args: string[];
  command: string;
  enabled: boolean;
  env: Record<string, string>;
  headers: Record<string, string>;
  id: string;
  name: string;
  oauthClientId: string;
  oauthClientSecret: string;
  transport: "stdio" | "streamable-http" | "sse";
  url: string;
}

interface KeyValueEntry {
  id: string;
  key: string;
  value: string;
}

const TRANSPORT_OPTIONS: { label: string; value: McpServer["transport"] }[] = [
  { label: "Local", value: "stdio" },
  { label: "HTTP", value: "streamable-http" },
  { label: "SSE", value: "sse" },
];

const emptyServer = (): McpServer => ({
  args: [],
  command: "",
  enabled: true,
  env: {},
  headers: {},
  id: crypto.randomUUID(),
  name: "",
  oauthClientId: "",
  oauthClientSecret: "",
  transport: "stdio",
  url: "",
});
const recordToEntries = (record: Record<string, string>): KeyValueEntry[] =>
  Object.entries(record).map(([key, value]) => ({
    id: crypto.randomUUID(),
    key,
    value,
  }));
const entriesToRecord = (entries: KeyValueEntry[]): Record<string, string> =>
  Object.fromEntries(
    entries
      .map((entry) => [entry.key.trim(), entry.value] as const)
      .filter(([key]) => key.length > 0)
  );

function KvRow({
  fieldKey,
  fieldValue,
  id,
  keyPlaceholder,
  onChangeRow,
  onRemoveRow,
  valuePlaceholder,
}: {
  fieldKey: string;
  fieldValue: string;
  id: string;
  keyPlaceholder: string;
  onChangeRow: (id: string, field: "key" | "value", value: string) => void;
  onRemoveRow: (id: string) => void;
  valuePlaceholder: string;
}) {
  const onKey = useCallback(
    (value: string) => onChangeRow(id, "key", value),
    [onChangeRow, id]
  );
  const onValue = useCallback(
    (value: string) => onChangeRow(id, "value", value),
    [onChangeRow, id]
  );
  const onRemove = useCallback(() => onRemoveRow(id), [onRemoveRow, id]);
  return (
    <div className="kv-row">
      <TextField
        aria-label={keyPlaceholder}
        monospace
        onChange={onKey}
        placeholder={keyPlaceholder}
        size="sm"
        spellCheck={false}
        value={fieldKey}
      />
      <TextField
        aria-label={valuePlaceholder}
        monospace
        onChange={onValue}
        placeholder={valuePlaceholder}
        size="sm"
        spellCheck={false}
        value={fieldValue}
      />
      <Button
        aria-label="Remove entry"
        onPress={onRemove}
        size="sm"
        variant="icon-only"
      >
        <Trash2 aria-hidden="true" />
      </Button>
    </div>
  );
}

function KeyValueList({
  addLabel,
  keyPlaceholder,
  onChange,
  rows,
  valuePlaceholder,
}: {
  addLabel: string;
  keyPlaceholder: string;
  onChange: (rows: KeyValueEntry[]) => void;
  rows: KeyValueEntry[];
  valuePlaceholder: string;
}) {
  const onChangeRow = useCallback(
    (id: string, field: "key" | "value", value: string) =>
      onChange(
        rows.map((row) => (row.id === id ? { ...row, [field]: value } : row))
      ),
    [onChange, rows]
  );
  const onRemoveRow = useCallback(
    (id: string) => onChange(rows.filter((row) => row.id !== id)),
    [onChange, rows]
  );
  const onAddRow = useCallback(
    () => onChange([...rows, { id: crypto.randomUUID(), key: "", value: "" }]),
    [onChange, rows]
  );
  return (
    <div className="kv-list">
      {rows.map((row) => (
        <KvRow
          fieldKey={row.key}
          fieldValue={row.value}
          id={row.id}
          key={row.id}
          keyPlaceholder={keyPlaceholder}
          onChangeRow={onChangeRow}
          onRemoveRow={onRemoveRow}
          valuePlaceholder={valuePlaceholder}
        />
      ))}
      <Button onPress={onAddRow} variant="list-add">
        <Plus aria-hidden="true" /> {addLabel}
      </Button>
    </div>
  );
}

function ArgRow({
  index,
  onChangeArg,
  onRemoveArg,
  value,
}: {
  index: number;
  onChangeArg: (index: number, value: string) => void;
  onRemoveArg: (index: number) => void;
  value: string;
}) {
  const onChange = useCallback(
    (nextValue: string) => onChangeArg(index, nextValue),
    [onChangeArg, index]
  );
  const onRemove = useCallback(() => onRemoveArg(index), [onRemoveArg, index]);
  return (
    <div className="kv-row arg-row">
      <TextField
        aria-label={`Argument ${index + 1}`}
        monospace
        onChange={onChange}
        placeholder="--flag or value"
        size="sm"
        spellCheck={false}
        value={value}
      />
      <Button
        aria-label={`Remove argument ${index + 1}`}
        onPress={onRemove}
        size="sm"
        variant="icon-only"
      >
        <Trash2 aria-hidden="true" />
      </Button>
    </div>
  );
}

function ArgumentList({
  args,
  onChange,
}: {
  args: string[];
  onChange: (args: string[]) => void;
}) {
  const onChangeArg = useCallback(
    (index: number, value: string) =>
      onChange(args.map((arg, position) => (position === index ? value : arg))),
    [onChange, args]
  );
  const onRemoveArg = useCallback(
    (index: number) =>
      onChange(args.filter((_, position) => position !== index)),
    [onChange, args]
  );
  const onAddArg = useCallback(() => onChange([...args, ""]), [onChange, args]);
  return (
    <div className="kv-list">
      {args.map((arg, index) => (
        <ArgRow
          index={index}
          // biome-ignore lint/suspicious/noArrayIndexKey: arguments are positional and have no stable identity
          key={index}
          onChangeArg={onChangeArg}
          onRemoveArg={onRemoveArg}
          value={arg}
        />
      ))}
      <Button onPress={onAddArg} variant="list-add">
        <Plus aria-hidden="true" /> Add argument
      </Button>
    </div>
  );
}

function ServerRow({
  onEdit,
  onRemove,
  onToggle,
  server,
}: {
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
  onToggle: (id: string, enabled: boolean) => void;
  server: McpServer;
}) {
  const label = server.name || "Untitled server";
  const transportLabel =
    TRANSPORT_OPTIONS.find((option) => option.value === server.transport)
      ?.label ?? server.transport;
  const onEditClick = useCallback(() => onEdit(server.id), [onEdit, server.id]);
  const onToggleChange = useCallback(
    (isSelected: boolean) => onToggle(server.id, isSelected),
    [onToggle, server.id]
  );
  const onRemoveClick = useCallback(
    () => onRemove(server.id),
    [onRemove, server.id]
  );
  return (
    <div className="setting-row server-row">
      <Button className="server-row-main" onPress={onEditClick} variant="row">
        <span className="server-row-name">{label}</span>
        <span className="server-row-transport">{transportLabel}</span>
      </Button>
      <div className="setting-row-controls">
        <Switch
          aria-label={`Enable ${label}`}
          isSelected={server.enabled}
          onChange={onToggleChange}
        />
        <Button
          aria-label={`Edit ${label}`}
          onPress={onEditClick}
          variant="icon"
        >
          <Pencil aria-hidden="true" />
        </Button>
        <Button
          aria-label={`Remove ${label}`}
          onPress={onRemoveClick}
          variant="icon-only"
        >
          <Trash2 aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

function ServerForm({
  envRows,
  headerRows,
  onEnvChange,
  onHeadersChange,
  onOAuth,
  onUpdate,
  server,
}: {
  envRows: KeyValueEntry[];
  headerRows: KeyValueEntry[];
  onEnvChange: (rows: KeyValueEntry[]) => void;
  onHeadersChange: (rows: KeyValueEntry[]) => void;
  onOAuth: () => void;
  onUpdate: (changes: Partial<McpServer>) => void;
  server: McpServer;
}) {
  const onEnabled = useCallback(
    (isSelected: boolean) => onUpdate({ enabled: isSelected }),
    [onUpdate]
  );
  const onName = useCallback(
    (value: string) => onUpdate({ name: value }),
    [onUpdate]
  );
  const onCommand = useCallback(
    (value: string) => onUpdate({ command: value }),
    [onUpdate]
  );
  const onArgsChange = useCallback(
    (args: string[]) => onUpdate({ args }),
    [onUpdate]
  );
  const onTransport = useCallback(
    (transport: McpServer["transport"]) => onUpdate({ transport }),
    [onUpdate]
  );
  const onUrl = useCallback(
    (value: string) => onUpdate({ url: value }),
    [onUpdate]
  );
  const onOAuthClientId = useCallback(
    (value: string) => onUpdate({ oauthClientId: value }),
    [onUpdate]
  );
  const onOAuthClientSecret = useCallback(
    (value: string) => onUpdate({ oauthClientSecret: value }),
    [onUpdate]
  );
  return (
    <section className="settings-group server-group">
      <div className="setting-row server-identity-row">
        <TextField
          aria-label="Server name"
          bare
          className="server-name-input"
          maxLength={100}
          onChange={onName}
          placeholder="Untitled server"
          size="lg"
          value={server.name}
          weight="bold"
        />
        <Switch
          aria-label={`Enable ${server.name || "MCP server"}`}
          isSelected={server.enabled}
          onChange={onEnabled}
        />
      </div>
      <div className="setting-row">
        <span className="setting-row-label">Transport</span>
        <SegmentedControl
          aria-label="Transport"
          onChange={onTransport}
          options={TRANSPORT_OPTIONS}
          value={server.transport}
        />
      </div>
      {server.transport === "stdio" ? (
        <>
          <div className="setting-row">
            <span className="setting-row-label">Command</span>
            <TextField
              align="end"
              aria-label="Command"
              className="setting-row-input"
              maxLength={1000}
              monospace
              onChange={onCommand}
              placeholder="npx"
              spellCheck={false}
              value={server.command}
            />
          </div>
          <div className="setting-row setting-row-stacked">
            <span className="setting-row-label">Arguments</span>
            <ArgumentList args={server.args} onChange={onArgsChange} />
          </div>
          <div className="setting-row setting-row-stacked">
            <span className="setting-row-label">Environment</span>
            <KeyValueList
              addLabel="Add variable"
              keyPlaceholder="NAME"
              onChange={onEnvChange}
              rows={envRows}
              valuePlaceholder="value"
            />
          </div>
        </>
      ) : (
        <>
          <div className="setting-row">
            <span className="setting-row-label">Server URL</span>
            <TextField
              align="end"
              aria-label="Server URL"
              className="setting-row-input"
              monospace
              onChange={onUrl}
              placeholder="https://mcp.example.com/mcp"
              spellCheck={false}
              type="url"
              value={server.url}
            />
          </div>
          <div className="setting-row setting-row-stacked">
            <span className="setting-row-label">Request headers</span>
            <KeyValueList
              addLabel="Add header"
              keyPlaceholder="Header-Name"
              onChange={onHeadersChange}
              rows={headerRows}
              valuePlaceholder="value"
            />
          </div>
          <div className="setting-row">
            <span className="setting-row-label">
              OAuth client ID <em>optional</em>
            </span>
            <TextField
              align="end"
              aria-label="OAuth client ID"
              autoComplete="off"
              className="setting-row-input"
              monospace
              onChange={onOAuthClientId}
              placeholder="Required when the server cannot register Bolo"
              spellCheck={false}
              value={server.oauthClientId}
            />
          </div>
          <div className="setting-row">
            <span className="setting-row-label">
              OAuth client secret <em>optional</em>
            </span>
            <TextField
              align="end"
              aria-label="OAuth client secret"
              autoComplete="off"
              className="setting-row-input"
              monospace
              onChange={onOAuthClientSecret}
              placeholder="Stored locally with private permissions"
              spellCheck={false}
              type="password"
              value={server.oauthClientSecret}
            />
          </div>
          <div className="setting-row setting-row-action">
            <Button onPress={onOAuth} variant="action">
              Connect with OAuth
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

export function SettingsPage() {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [envRows, setEnvRows] = useState<Record<string, KeyValueEntry[]>>({});
  const [headerRows, setHeaderRows] = useState<Record<string, KeyValueEntry[]>>(
    {}
  );
  const [message, setMessage] = useState("Loading MCP servers…");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    window.boloDesktop
      .getMcpServers()
      .then((items) => {
        setServers(items);
        setEnvRows(
          Object.fromEntries(
            items.map((item) => [item.id, recordToEntries(item.env)])
          )
        );
        setHeaderRows(
          Object.fromEntries(
            items.map((item) => [item.id, recordToEntries(item.headers)])
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
  useEffect(
    () =>
      window.boloDesktop.onMcpOAuthEvent((event) => {
        setMessage(
          event.status === "connected"
            ? "MCP OAuth connected."
            : (event.error ?? "MCP OAuth failed.")
        );
      }),
    []
  );
  const update = useCallback(
    (id: string, changes: Partial<McpServer>) =>
      setServers((items) =>
        items.map((server) =>
          server.id === id ? { ...server, ...changes } : server
        )
      ),
    []
  );
  const toggleEnabled = useCallback(
    (id: string, enabled: boolean) => update(id, { enabled }),
    [update]
  );
  const startOAuth = useCallback((id: string) => {
    window.boloDesktop
      .startMcpOAuth(id)
      .then((result) =>
        setMessage(
          result.status === "connected"
            ? "MCP OAuth is already connected."
            : "Complete sign-in in your browser, then return to Bolo."
        )
      )
      .catch((error: unknown) =>
        setMessage(
          error instanceof Error ? error.message : "Could not start MCP OAuth."
        )
      );
  }, []);
  const [draft, setDraft] = useState<McpServer>(emptyServer);
  const [draftEnv, setDraftEnv] = useState<KeyValueEntry[]>([]);
  const [draftHeaders, setDraftHeaders] = useState<KeyValueEntry[]>([]);
  const [isSheetOpen, setSheetOpen] = useState(false);
  const isEditingExisting = servers.some((item) => item.id === draft.id);
  const openAddSheet = useCallback(() => {
    setDraft(emptyServer());
    setDraftEnv([]);
    setDraftHeaders([]);
    setSheetOpen(true);
  }, []);
  const openEditSheet = useCallback(
    (id: string) => {
      const server = servers.find((item) => item.id === id);
      if (!server) {
        return;
      }
      setDraft(server);
      setDraftEnv(envRows[id] ?? []);
      setDraftHeaders(headerRows[id] ?? []);
      setSheetOpen(true);
    },
    [envRows, headerRows, servers]
  );
  const updateDraft = useCallback(
    (changes: Partial<McpServer>) =>
      setDraft((current) => ({ ...current, ...changes })),
    []
  );
  const oauthForDraft = useCallback(
    () => startOAuth(draft.id),
    [startOAuth, draft.id]
  );
  const closeSheet = useCallback(() => setSheetOpen(false), []);
  const commitDraft = useCallback(() => {
    setServers((items) => {
      const exists = items.some((item) => item.id === draft.id);
      return exists
        ? items.map((item) => (item.id === draft.id ? draft : item))
        : [...items, draft];
    });
    setEnvRows((items) => ({ ...items, [draft.id]: draftEnv }));
    setHeaderRows((items) => ({ ...items, [draft.id]: draftHeaders }));
    setMessage("");
    setSheetOpen(false);
  }, [draft, draftEnv, draftHeaders]);
  const removeServer = useCallback((id: string) => {
    setServers((items) => items.filter((server) => server.id !== id));
    setEnvRows((items) => {
      const { [id]: _removed, ...remaining } = items;
      return remaining;
    });
    setHeaderRows((items) => {
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
          env: entriesToRecord(envRows[server.id] ?? []),
          headers: entriesToRecord(headerRows[server.id] ?? []),
        }))
      );
      setServers(saved);
      setEnvRows(
        Object.fromEntries(
          saved.map((server) => [server.id, recordToEntries(server.env)])
        )
      );
      setHeaderRows(
        Object.fromEntries(
          saved.map((server) => [server.id, recordToEntries(server.headers)])
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
  }, [envRows, headerRows, servers]);
  return (
    <main className="settings-page">
      <div className="settings-drag-region" />
      <div className="settings-content">
        <header className="settings-header">
          <div aria-hidden="true" className="settings-icon">
            <Plug />
          </div>
          <div className="settings-heading">
            <h1>MCP Servers</h1>
            <p>
              Connect local or remote MCP servers Bolo can use as tools in new
              tasks. Only add servers you trust — credentials are stored locally
              in Bolo's app data.
            </p>
          </div>
        </header>
        <section aria-label="MCP servers" className="server-list">
          {servers.length === 0 ? (
            <div className="settings-empty">
              <Plug aria-hidden="true" />
              <p>No MCP servers added yet.</p>
            </div>
          ) : (
            <div className="settings-group">
              {servers.map((server) => (
                <ServerRow
                  key={server.id}
                  onEdit={openEditSheet}
                  onRemove={removeServer}
                  onToggle={toggleEnabled}
                  server={server}
                />
              ))}
            </div>
          )}
        </section>
        <Button onPress={openAddSheet} variant="add-server">
          <Plus aria-hidden="true" /> Add MCP Server
        </Button>
        <footer className="settings-footer">
          <span aria-live="polite">{message}</span>
          <Button isDisabled={saving} onPress={save} variant="action-primary">
            {saving ? "Saving…" : "Save Changes"}
          </Button>
        </footer>
      </div>
      <Sheet
        description="Configure how Bolo connects to this MCP server."
        footer={
          <>
            <Button onPress={closeSheet} variant="action">
              Cancel
            </Button>
            <Button onPress={commitDraft} variant="action-primary">
              Done
            </Button>
          </>
        }
        isOpen={isSheetOpen}
        onOpenChange={setSheetOpen}
        title={
          isEditingExisting ? draft.name || "Edit server" : "Add MCP Server"
        }
      >
        <ServerForm
          envRows={draftEnv}
          headerRows={draftHeaders}
          onEnvChange={setDraftEnv}
          onHeadersChange={setDraftHeaders}
          onOAuth={oauthForDraft}
          onUpdate={updateDraft}
          server={draft}
        />
      </Sheet>
    </main>
  );
}
