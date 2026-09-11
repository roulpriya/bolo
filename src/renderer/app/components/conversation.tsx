import type { RefObject } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Thread } from "../../../shared/threads.ts";
import { Progress } from "./progress";

export function Conversation({
  thread,
  reference,
}: {
  thread: Thread | null;
  reference: RefObject<HTMLElement | null>;
}) {
  return (
    <section
      className="conversation"
      hidden={!thread?.turns.length}
      ref={reference}
    >
      <div aria-live="polite" className="chat-log">
        {thread?.turns.map((turn) => (
          <section aria-label="Turn" key={turn.id}>
            {turn.messages
              .filter((message) => message.kind !== "result")
              .map((message) => (
                <article
                  className={`message ${message.role === "user" ? "user" : "bot"}`}
                  key={message.id}
                >
                  {message.role === "user" ? (
                    <span className="message-label">You</span>
                  ) : null}
                  <div className="message-body">
                    <ReactMarkdown
                      components={{
                        a: ({ children, href }) => (
                          <a
                            href={href}
                            rel="noopener noreferrer"
                            target="_blank"
                          >
                            {children}
                          </a>
                        ),
                      }}
                      remarkPlugins={[remarkGfm]}
                    >
                      {message.text}
                    </ReactMarkdown>
                  </div>
                </article>
              ))}
            <article className="message bot">
              <div className="message-body">
                <Progress turn={turn} />
              </div>
            </article>
          </section>
        ))}
      </div>
    </section>
  );
}
