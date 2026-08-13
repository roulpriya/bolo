const REMINDER_PATTERN =
  /\b(?:set(?:\s+up)?|create|add)\s+(?:a\s+)?reminder\b/i;
const TIME_PATTERN =
  /\b(?:at|for)\s+(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i;
const PM_PATTERN = /p/i;

export function reminderIntent(input: unknown, now: Date = new Date()) {
  const text = String(input || "").trim();
  if (!REMINDER_PATTERN.test(text)) {
    return null;
  }
  const match = text.match(TIME_PATTERN);
  if (!match) {
    return null;
  }

  let hours = Number(match[1]) % 12;
  if (PM_PATTERN.test(match[3])) {
    hours += 12;
  }
  const date = new Date(now);
  date.setHours(hours, Number(match[2] || 0), 0, 0);
  if (date.getTime() <= now.getTime()) {
    date.setDate(date.getDate() + 1);
  }
  const displayHour = hours % 12 || 12;
  const displayMinute = String(Number(match[2] || 0)).padStart(2, "0");
  const meridiem = hours >= 12 ? "PM" : "AM";
  const timeLabel = `${displayHour}:${displayMinute} ${meridiem}`;
  return { scheduledFor: date.toISOString(), timeLabel, title: null };
}
