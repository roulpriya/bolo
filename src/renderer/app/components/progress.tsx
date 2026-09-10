import {
  Bell,
  BookOpen,
  Globe,
  type LucideIcon,
  MessageCircleQuestionMark,
  PencilLine,
  Search,
  Terminal,
} from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Disclosure } from "../../ui/disclosure";
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
    <div className="terminal-panel">
      <div className="terminal-line">
        <span aria-hidden="true" className="terminal-prompt">
          $
        </span>
        {command}
      </div>
      {results?.map((result) => (
        <Fragment
          key={`${result.outcome?.exitCode}-${result.stdout}-${result.stderr}`}
        >
          {Boolean(result.stdout) && (
            <div className="terminal-line terminal-stdout">{result.stdout}</div>
          )}
          {Boolean(result.stderr) && (
            <div className="terminal-line terminal-stderr">{result.stderr}</div>
          )}
          {result.outcome?.type === "exit" && (
            <div className="terminal-line terminal-exit">
              exit {result.outcome.exitCode ?? "unknown"}
            </div>
          )}
        </Fragment>
      ))}
      {Boolean(output) && !results && (
        <div className="terminal-line terminal-stderr">{output}</div>
      )}
      {state === "running" && (
        <div className="terminal-line tool-pending">
          Awaiting command output…
        </div>
      )}
    </div>
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

const TOOL_VERBS: Record<string, string> = {
  ask_user_question: "Asked",
  bash: "Ran",
  browser_use: "Used browser for",
  create_reminder: "Created reminder",
  edit: "Edited",
  read: "Read",
  web_search: "Searched",
  write: "Wrote",
};
const TOOL_ICONS: Record<string, LucideIcon> = {
  ask_user_question: MessageCircleQuestionMark,
  bash: Terminal,
  browser_use: Globe,
  create_reminder: Bell,
  edit: PencilLine,
  read: BookOpen,
  web_search: Search,
  write: PencilLine,
};
const FILE_REF_TOOLS = new Set(["edit", "read", "write"]);

function ToolCall({ item }: { item: ToolActivity & { kind: "tool_call" } }) {
  const [isOpen, setIsOpen] = useState(false);
  const state = item.status || "running";
  const isBash = item.tool === "bash";
  let input: unknown = item.input;
  try {
    input = item.input ? JSON.parse(item.input) : null;
  } catch {
    // Tool inputs may be plain text rather than serialized JSON.
  }
  const verb = TOOL_VERBS[item.tool] || `Used ${item.tool}`;
  const Icon = TOOL_ICONS[item.tool] || Terminal;
  const isFileRef = FILE_REF_TOOLS.has(item.tool);
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
    <Disclosure
      className={`tool-call ${state}`}
      isExpanded={isOpen}
      onExpandedChange={setIsOpen}
      trigger={
        <>
          <Icon aria-hidden="true" className="tool-icon" />
          <span className="tool-call-line">
            <span className="tool-call-verb">{verb}</span>
            {Boolean(preview) && (
              <span
                className={
                  isFileRef
                    ? "tool-call-target tool-call-target-file"
                    : "tool-call-target"
                }
                title={String(preview)}
              >
                {String(preview)}
              </span>
            )}
          </span>
        </>
      }
      triggerClassName="tool-call-trigger"
    >
      <div className="tool-call-content">
        <ToolContent
          command={command}
          isBash={isBash}
          item={item}
          state={state}
        />
      </div>
    </Disclosure>
  );
}

export function Progress({ run }: { run: Run | null }) {
  const [isCompleteOpen, setIsCompleteOpen] = useState(true);
  useEffect(() => {
    if (run?.finished) {
      setIsCompleteOpen(false);
    }
  }, [run?.finished]);
  const progressLabel =
    run?.progress === "Starting agent" ? "Working" : run?.progress || "Working";
  const summaryRow = <span className="progress-summary">{progressLabel}</span>;
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
        {toolTimeline ? (
          <Disclosure
            className="progress-tools"
            isExpanded={isCompleteOpen}
            onExpandedChange={setIsCompleteOpen}
            trigger={summaryRow}
            triggerClassName="progress-row progress-row-muted"
          >
            {toolTimeline}
          </Disclosure>
        ) : (
          <div className="progress-row progress-row-muted">{summaryRow}</div>
        )}
        {Boolean(response) && <AgentResponse>{response}</AgentResponse>}
      </div>
    );
  }
  return (
    <div className="progress-card">
      <div className="progress-row progress-row-muted">{summaryRow}</div>
      {toolTimeline}
    </div>
  );
}
