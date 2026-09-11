import { useCallback, useState } from "react";
import type { ThreadSummary } from "../../../shared/threads.ts";
import { Button } from "../../ui/button";

function ThreadChoice({
  thread,
  selected,
  disabled,
  onSelect,
}: {
  thread: ThreadSummary;
  selected: boolean;
  disabled: boolean;
  onSelect: (id: string) => void;
}) {
  const select = useCallback(() => onSelect(thread.id), [onSelect, thread.id]);
  return (
    <li>
      <Button
        aria-current={selected ? "true" : undefined}
        isDisabled={disabled}
        onPress={select}
        variant="row"
      >
        {thread.title}
        {thread.activeTurnState === "waiting_for_user"
          ? " · Needs your answer"
          : ""}
        {thread.activeTurnState === "running" ? " · Working" : ""}
        {thread.activeTurnState === "stopping" ? " · Finishing cleanup" : ""}
      </Button>
    </li>
  );
}

export function ThreadPicker({
  threads,
  selectedId,
  disabled,
  onCreate,
  onSelect,
}: {
  threads: ThreadSummary[];
  selectedId?: string;
  disabled: boolean;
  onCreate: () => void;
  onSelect: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const toggle = useCallback(() => {
    setExpanded((value) => !value);
    window.boloDesktop.setExpanded(true);
  }, []);
  const select = useCallback(
    (id: string) => {
      setExpanded(false);
      onSelect(id);
    },
    [onSelect]
  );
  return (
    <nav aria-label="Conversations" className="thread-picker">
      <div className="thread-picker-actions">
        <Button
          aria-controls="thread-list"
          aria-expanded={expanded}
          isDisabled={disabled}
          onPress={toggle}
          variant="quiet"
        >
          Conversations
        </Button>
        <Button isDisabled={disabled} onPress={onCreate} variant="quiet">
          New conversation
        </Button>
      </div>
      <ul className="thread-list" hidden={!expanded} id="thread-list">
        {threads.map((thread) => (
          <ThreadChoice
            disabled={disabled}
            key={thread.id}
            onSelect={select}
            selected={thread.id === selectedId}
            thread={thread}
          />
        ))}
      </ul>
    </nav>
  );
}
