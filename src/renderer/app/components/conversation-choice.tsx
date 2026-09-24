import { useCallback } from "react";
import type {
  ConversationChoice as Choice,
  PendingInput,
} from "../../../shared/input-routing.ts";
import { Button } from "../../ui/button";

export function ConversationChoice({
  pending,
  disabled,
  onChoose,
  onCancel,
}: {
  pending: PendingInput;
  disabled: boolean;
  onChoose: (choice: Choice) => void;
  onCancel: () => void;
}) {
  const checking = pending.state === "checking";
  const continueChat = useCallback(() => onChoose("continue"), [onChoose]);
  const newChat = useCallback(() => onChoose("new"), [onChoose]);
  return (
    <section aria-label="Choose a conversation" className="conversation-choice">
      <p aria-live="polite">
        {checking
          ? "Checking whether this continues your chat…"
          : "Continue this chat or start a new one?"}
      </p>
      <blockquote>{pending.text}</blockquote>
      {!checking && pending.reason !== "uncertain" ? (
        <small>
          Automatic detection is unavailable. Choose where to send your request.
        </small>
      ) : null}
      <div className="conversation-choice-actions">
        {checking ? null : (
          <>
            <Button
              isDisabled={disabled}
              onPress={continueChat}
              variant="action-primary"
            >
              Continue this chat
            </Button>
            <Button isDisabled={disabled} onPress={newChat} variant="action">
              Start new chat
            </Button>
          </>
        )}
        <Button onPress={onCancel} variant="quiet">
          Cancel request
        </Button>
      </div>
    </section>
  );
}
