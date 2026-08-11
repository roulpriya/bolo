import { Mic, Send, Square } from "lucide-react";
import type {
  ChangeEventHandler,
  FormEventHandler,
  KeyboardEventHandler,
  RefObject,
} from "react";

export function Composer({
  canAnswer,
  canInput,
  input,
  inputRef,
  onChange,
  onKeyDown,
  onRecord,
  onStop,
  onSubmit,
  showStop,
}: {
  canAnswer: boolean;
  canInput: boolean;
  input: string;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  onChange: ChangeEventHandler<HTMLTextAreaElement>;
  onKeyDown: KeyboardEventHandler<HTMLTextAreaElement>;
  onRecord: () => void;
  onStop: () => void;
  onSubmit: FormEventHandler<HTMLFormElement>;
  showStop: boolean;
}) {
  return (
    <form className="composer" onSubmit={onSubmit}>
      <span aria-hidden="true" className="composer-orb">
        <i />
      </span>
      <textarea
        aria-label="Task or answer"
        disabled={!canInput}
        maxLength={4000}
        onChange={onChange}
        onKeyDown={onKeyDown}
        placeholder={
          canAnswer ? "Type your answer…" : "What do you want to get done?"
        }
        ref={inputRef}
        rows={1}
        value={input}
      />
      <button
        aria-label="Start a voice request"
        className="icon-button"
        disabled={!canInput}
        onClick={onRecord}
        title="Start voice"
        type="button"
      >
        <Mic aria-hidden="true" />
      </button>
      {showStop ? (
        <button
          aria-label="Stop task"
          className="stop-button composer-stop-button"
          onClick={onStop}
          title="Stop task"
          type="button"
        >
          <Square aria-hidden="true" />
          Stop
        </button>
      ) : null}
      <button
        aria-label={canAnswer ? "Send answer" : "Run task"}
        className="send-button"
        hidden={!(input.trim() && canInput)}
        type="submit"
      >
        <Send aria-hidden="true" />
      </button>
    </form>
  );
}
