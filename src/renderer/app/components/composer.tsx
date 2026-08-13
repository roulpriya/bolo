import { Mic, Send, Settings, Square } from "lucide-react";
import type { FormEventHandler, KeyboardEventHandler, RefObject } from "react";
import { Button } from "../../ui/button";
import { TextArea } from "../../ui/text-area";

export function Composer({
  canAnswer,
  canInput,
  input,
  inputRef,
  onChange,
  onKeyDown,
  onRecord,
  onSettings,
  onStop,
  onSubmit,
  showStop,
}: {
  canAnswer: boolean;
  canInput: boolean;
  input: string;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  onChange: (value: string) => void;
  onKeyDown: KeyboardEventHandler<HTMLTextAreaElement>;
  onRecord: () => void;
  onSettings: () => void;
  onStop: () => void;
  onSubmit: FormEventHandler<HTMLFormElement>;
  showStop: boolean;
}) {
  return (
    <form className="composer" onSubmit={onSubmit}>
      <span aria-hidden="true" className="composer-orb">
        <i />
      </span>
      <TextArea
        aria-label="Task or answer"
        isDisabled={!canInput}
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
      <Button
        aria-label="Open settings"
        onPress={onSettings}
        title="Settings"
        variant="icon"
      >
        <Settings aria-hidden="true" />
      </Button>
      <Button
        aria-label="Start a voice request"
        isDisabled={!canInput}
        onPress={onRecord}
        title="Start voice"
        variant="icon"
      >
        <Mic aria-hidden="true" />
      </Button>
      {showStop ? (
        <Button
          aria-label="Stop task"
          className="composer-stop-button"
          onPress={onStop}
          title="Stop task"
          variant="stop"
        >
          <Square aria-hidden="true" />
          Stop
        </Button>
      ) : null}
      <Button
        aria-label={canAnswer ? "Send answer" : "Run task"}
        hidden={!(input.trim() && canInput)}
        type="submit"
        variant="send"
      >
        <Send aria-hidden="true" />
      </Button>
    </form>
  );
}
