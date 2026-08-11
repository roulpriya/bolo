import type { RefObject } from "react";
import type { Message, Run } from "../types";
import { Progress } from "./progress";

export function Conversation({
  messages,
  onStop,
  reference,
  run,
}: {
  messages: Message[];
  onStop: () => void;
  reference: RefObject<HTMLElement | null>;
  run: Run | null;
}) {
  return (
    <section className="conversation" hidden={!messages.length} ref={reference}>
      <div aria-live="polite" className="chat-log">
        {messages.map((message) => (
          <article className={`message ${message.kind}`} key={message.id}>
            <span className="message-label">
              {message.kind === "user" ? "You" : "Bolo"}
            </span>
            <div className="message-body">
              {message.progress ? (
                <Progress onStop={onStop} run={run} />
              ) : (
                message.text
              )}
            </div>
          </article>
        ))}
        {run && !messages.some((message) => message.progress) && (
          <article className="message bot">
            <span className="message-label">Bolo</span>
            <div className="message-body">
              <Progress onStop={onStop} run={run} />
            </div>
          </article>
        )}
      </div>
    </section>
  );
}
