import type { ThreadSummary } from "../../../shared/threads.ts";
import { Button } from "../../ui/button";

export function BackgroundRequest({
  thread,
  disabled,
  onOpen,
  onStop,
}: {
  thread: ThreadSummary;
  disabled: boolean;
  onOpen: () => void;
  onStop: () => void;
}) {
  const statuses = {
    running: "Working",
    stopping: "Finishing cleanup",
    waiting_for_user: "Needs your answer",
  };
  const status = statuses[thread.activeTurnState ?? "running"];
  return (
    <aside aria-label="Background request" className="background-request">
      <p aria-live="polite">
        <strong>{status}</strong>
        <span>{thread.title}</span>
      </p>
      <div className="background-request-actions">
        <Button isDisabled={disabled} onPress={onOpen} variant="quiet">
          Open conversation
        </Button>
        <Button isDisabled={disabled} onPress={onStop} variant="quiet">
          Stop
        </Button>
      </div>
      <small>
        You can draft here. Send becomes available when this request ends.
      </small>
    </aside>
  );
}
