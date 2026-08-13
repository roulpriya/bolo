import assert from "node:assert/strict";
import { test } from "vitest";
import { reminderIntent } from "../src/main/intents/reminder-intent.ts";

test("recognizes a reminder time and uses tomorrow when today's time has passed", () => {
  const intent = reminderIntent(
    "Set a reminder for 9 PM",
    new Date("2026-08-11T22:00:00+05:30")
  );
  assert.ok(intent);
  assert.equal(intent.timeLabel, "9:00 PM");
  assert.equal(intent.scheduledFor, "2026-08-12T15:30:00.000Z");
});

test("does not classify unrelated tasks as reminders", () => {
  assert.equal(reminderIntent("Open Reminders"), null);
});
