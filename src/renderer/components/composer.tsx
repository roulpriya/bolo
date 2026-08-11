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
  onSubmit,
}: {
  canAnswer: boolean;
  canInput: boolean;
  input: string;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  onChange: ChangeEventHandler<HTMLTextAreaElement>;
  onKeyDown: KeyboardEventHandler<HTMLTextAreaElement>;
  onRecord: () => void;
  onSubmit: FormEventHandler<HTMLFormElement>;
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
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M12 14.5a3.5 3.5 0 0 0 3.5-3.5V6.5a3.5 3.5 0 1 0-7 0V11a3.5 3.5 0 0 0 3.5 3.5Zm6-3.5a6 6 0 0 1-12 0M12 17v3.5M8.5 20.5h7" />
        </svg>
      </button>
      <button
        aria-label={canAnswer ? "Send answer" : "Run task"}
        className="send-button"
        hidden={!(input.trim() && canInput)}
        type="submit"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="m5 12 14-7-4 14-3.5-5.5L5 12Z" />
        </svg>
      </button>
    </form>
  );
}
