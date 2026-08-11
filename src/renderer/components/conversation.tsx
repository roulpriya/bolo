import type { RefObject } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Message, Run } from "../types";
import { Progress } from "./progress";

function AgentMarkdown({ children }: { children: string }) {
  return (
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
  );
}

function MessageContent({
  message,
  run,
}: {
  message: Message;
  run: Run | null;
}) {
  if (message.progress) {
    return <Progress run={run} />;
  }
  if (message.kind === "bot") {
    return <AgentMarkdown>{message.text}</AgentMarkdown>;
  }
  return message.text;
}

export function Conversation({
  messages,
  reference,
  run,
}: {
  messages: Message[];
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
              <MessageContent message={message} run={run} />
            </div>
          </article>
        ))}
        {run && !messages.some((message) => message.progress) && (
          <article className="message bot">
            <span className="message-label">Bolo</span>
            <div className="message-body">
              <Progress run={run} />
            </div>
          </article>
        )}
      </div>
    </section>
  );
}
