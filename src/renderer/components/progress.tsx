import { Terminal } from "lucide-react";
import { type ToggleEvent, useCallback, useEffect, useState } from "react";
import type { Run, ToolActivity } from "../types";

function ToolCall({ item }: { item: ToolActivity }) {
  const [isOpen, setIsOpen] = useState(false);
  const handleToggle = useCallback((event: ToggleEvent<HTMLDetailsElement>) => {
    setIsOpen(event.currentTarget.open);
  }, []);
  if (item.kind !== "tool_call") {
    return (
      <div className="tool-activity">
        <span aria-hidden="true" className="tool-status-dot" />
        {item.detail}
      </div>
    );
  }
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
        {Boolean(item.input) && (
          <section>
            <span>{item.tool === "bash" ? "Command" : "Input"}</span>
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
      <strong>{run?.progress || "Working"}</strong>
    </>
  );
  const toolTimeline = Boolean(run?.toolActivity?.length) && (
    <section aria-label="Tool calls" className="tool-timeline">
      {run.toolActivity?.map((item, index) => (
        <ToolCall item={item} key={item.id || `${item.tool}-${index}`} />
      ))}
    </section>
  );
  if (run?.finished) {
    return (
      <details
        className="progress-card progress-complete"
        onToggle={handleCompleteToggle}
        open={isCompleteOpen}
      >
        <summary className="progress-row">{progressRow}</summary>
        {toolTimeline}
      </details>
    );
  }
  return (
    <div className="progress-card">
      <div className="progress-row">{progressRow}</div>
      {toolTimeline}
    </div>
  );
}
