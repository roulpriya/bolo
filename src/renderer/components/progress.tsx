import { Terminal } from "lucide-react";
import { type ToggleEvent, useCallback, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Run, ToolActivity } from "../types";

interface TerminalResult {
  outcome?: { exitCode?: number | null; type?: string };
  stderr?: string;
  stdout?: string;
}

function terminalResults(output?: string): TerminalResult[] | null {
  if (!output) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(output);
    if (
      typeof parsed === "object" &&
      parsed &&
      "output" in parsed &&
      Array.isArray(parsed.output)
    ) {
      return parsed.output as TerminalResult[];
    }
    if (
      typeof parsed === "object" &&
      parsed &&
      ("stdout" in parsed || "stderr" in parsed)
    ) {
      return [parsed as TerminalResult];
    }
  } catch {
    // Some tool failures are plain text rather than JSON.
  }
  return null;
}

function AgentResponse({ children }: { children: string }) {
  return (
    <div className="agent-response">
      <ReactMarkdown
        components={{
          a: ({ children: linkChildren, href }) => (
            <a href={href} rel="noopener noreferrer" target="_blank">
              {linkChildren}
            </a>
          ),
        }}
        remarkPlugins={[remarkGfm]}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

function TerminalPanel({
  command,
  output,
  state,
}: {
  command: string;
  output?: string;
  state: string;
}) {
  const results = terminalResults(output);
  return (
    <section className="terminal-panel">
      <div className="terminal-command">
        <span aria-hidden="true">$</span>
        <code>{command}</code>
      </div>
      {results?.map((result) => (
        <div
          className="terminal-result"
          key={`${result.outcome?.exitCode}-${result.stdout}-${result.stderr}`}
        >
          {Boolean(result.stdout) && (
            <pre className="terminal-stdout">{result.stdout}</pre>
          )}
          {Boolean(result.stderr) && (
            <pre className="terminal-stderr">{result.stderr}</pre>
          )}
          {result.outcome?.type === "exit" && (
            <span className="terminal-exit">
              Exit {result.outcome.exitCode ?? "unknown"}
            </span>
          )}
        </div>
      ))}
      {Boolean(output) && !results && (
        <pre className="terminal-stderr">{output}</pre>
      )}
      {state === "running" && (
        <p className="tool-pending">Awaiting command output…</p>
      )}
    </section>
  );
}

function ToolContent({
  command,
  isBash,
  item,
  state,
}: {
  command: string;
  isBash: boolean;
  item: ToolActivity;
  state: string;
}) {
  if (isBash) {
    return (
      <TerminalPanel command={command} output={item.output} state={state} />
    );
  }
  return (
    <>
      {Boolean(item.input) && (
        <section>
          <span>Input</span>
          <pre>{item.input}</pre>
        </section>
      )}
      {Boolean(item.output) && (
        <section>
          <span>{state === "failed" ? "Error" : "Output"}</span>
          <pre>{item.output}</pre>
        </section>
      )}
      {state === "running" && (
        <p className="tool-pending">Awaiting tool output…</p>
      )}
    </>
  );
}

function ToolCall({ item }: { item: ToolActivity & { kind: "tool_call" } }) {
  const [isOpen, setIsOpen] = useState(false);
  const handleToggle = useCallback((event: ToggleEvent<HTMLDetailsElement>) => {
    setIsOpen(event.currentTarget.open);
  }, []);
  const state = item.status || "running";
  const isBash = item.tool === "bash";
  let input: unknown = item.input;
  try {
    input = item.input ? JSON.parse(item.input) : null;
  } catch {
    // Tool inputs may be plain text rather than serialized JSON.
  }
  const labels: Record<string, string> = {
    ask_user_question: "Asked a question",
    bash: "Ran command",
    browser_use: "Used browser",
    computer_use: "Used computer",
    create_reminder: "Created reminder",
    edit: "Edited file",
    read: "Read file",
    web_search: "Searched the web",
    write: "Wrote file",
  };
  const stateLabel =
    { completed: "Done", failed: "Failed", running: "Working" }[state] ||
    "Done";
  const preview =
    typeof input === "object" && input
      ? (input as Record<string, unknown>).command ||
        (input as Record<string, unknown>).path ||
        (input as Record<string, unknown>).query ||
        (input as Record<string, unknown>).task ||
        (input as Record<string, unknown>).title ||
        JSON.stringify(input)
      : String(input || "");
  const command =
    typeof input === "object" && input && "command" in input
      ? String((input as { command: unknown }).command)
      : String(preview);
  return (
    <details
      className={`tool-call ${state}`}
      onToggle={handleToggle}
      open={isOpen}
    >
      <summary>
        {isBash ? (
          <Terminal aria-hidden="true" className="tool-icon" />
        ) : (
          <span aria-hidden="true" className="tool-status-dot" />
        )}
        <span className="tool-call-main">
          <strong>
            {isBash ? "Terminal" : labels[item.tool] || `Used ${item.tool}`}
          </strong>
          {Boolean(preview) && (
            <code title={String(preview)}>{String(preview)}</code>
          )}
        </span>
        <span className="tool-call-state">{stateLabel}</span>
      </summary>
      <div className="tool-call-content">
        <ToolContent
          command={command}
          isBash={isBash}
          item={item}
          state={state}
        />
      </div>
    </details>
  );
}

export function Progress({ run }: { run: Run | null }) {
  const [isCompleteOpen, setIsCompleteOpen] = useState(true);
  useEffect(() => {
    if (run?.finished) {
      setIsCompleteOpen(false);
    }
  }, [run?.finished]);
  const handleCompleteToggle = useCallback(
    (event: ToggleEvent<HTMLDetailsElement>) => {
      setIsCompleteOpen(event.currentTarget.open);
    },
    []
  );
  const progressRow = (
    <>
      {!run?.finished && <span aria-hidden="true" className="spinner" />}
      <strong>
        {run?.progress === "Starting agent"
          ? "Working"
          : run?.progress || "Working"}
      </strong>
    </>
  );
  const toolCalls = run?.toolActivity?.filter(
    (item): item is ToolActivity & { kind: "tool_call" } =>
      item.kind === "tool_call"
  );
  const toolTimeline = Boolean(toolCalls.length) && (
    <section aria-label="Tool calls" className="tool-timeline">
      {toolCalls.map((item) => (
        <ToolCall item={item} key={item.id || `${item.tool}-${item.at}`} />
      ))}
    </section>
  );
  if (run?.finished) {
    const response = run.response || run.result;
    return (
      <div className="progress-card progress-complete">
        {Boolean(response) && <AgentResponse>{response}</AgentResponse>}
        {toolTimeline ? (
          <details
            className="progress-tools"
            onToggle={handleCompleteToggle}
            open={isCompleteOpen}
          >
            <summary className="progress-row">{progressRow}</summary>
            {toolTimeline}
          </details>
        ) : (
          <div className="progress-row">{progressRow}</div>
        )}
      </div>
    );
  }
  return (
    <div className="progress-card">
      <div className="progress-row">{progressRow}</div>
      {toolTimeline}
    </div>
  );
}
