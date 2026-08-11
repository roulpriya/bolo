import assert from "node:assert/strict";
import { test } from "vitest";
import { RemindersService } from "../src/main/services/reminders.ts";

test("creates a reminder with argv and opens Reminders", async () => {
  const calls: unknown[][] = [];
  const service = new RemindersService({
    execute: (...args) => {
      calls.push(args);
      return calls.length === 1 ? "reminder-id" : "";
    },
  });
  const result = await service.create({
    scheduledFor: "2026-08-11T21:00:00+05:30",
    title: 'Call "Maya"',
  });
  assert.equal(result.status, "created");
  assert.equal(result.title, 'Call "Maya"');
  assert.equal(calls[0][0], "/usr/bin/osascript");
  assert.equal(calls[0][1].at(-2), 'Call "Maya"');
  assert.match(calls[0][1][3], /make new reminder/);
  assert.deepEqual(calls[1].slice(0, 2), [
    "/usr/bin/open",
    ["-a", "Reminders"],
  ]);
});

test("rejects an invalid reminder date before executing a command", async () => {
  const service = new RemindersService({
    execute: async () => assert.fail("should not execute"),
  });
  await assert.rejects(
    () => service.create({ scheduledFor: "tonight", title: "Call Maya" }),
    /valid ISO/i
  );
});
