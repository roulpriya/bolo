export function cleanText(
  value: string,
  maxLength: number,
  emptyMessage: string
): string {
  const text = value.trim();
  if (!text) {
    throw new Error(emptyMessage);
  }
  if (text.length > maxLength) {
    throw new Error("The supplied text is too long.");
  }
  return text;
}

export function safeError(error: unknown): string {
  const message = String(error instanceof Error ? error.message : error);
  return message
    .replace(/(?:sk|key|token|secret)[-_][A-Za-z0-9_-]{12,}/gi, "[redacted]")
    .slice(0, 1000);
}
