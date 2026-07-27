import assert from "node:assert/strict";
import test from "node:test";
import { parseCommand, sendAppleEvent } from "../src/apple-events-cli.js";

test("parses a reminder without interpolating values into code", () => {
  const parsed = parseCommand([
    "reminder",
    "add",
    'Milk "and" eggs',
    "--list",
    "Shopping",
    "--due",
    "2026-07-27T18:00:00+05:30",
  ]);

  assert.deepEqual(parsed.action, {
    type: "reminder.add",
    title: 'Milk "and" eggs',
    list: "Shopping",
    due: "2026-07-27T12:30:00.000Z",
    notes: null,
    open: false,
  });
});

test("parses repeated shopping items", () => {
  const parsed = parseCommand([
    "note",
    "shopping",
    "--title",
    "Weekly shop",
    "--item",
    "milk",
    "--item",
    "bread & eggs",
  ]);

  assert.deepEqual(parsed.action.items, ["milk", "bread & eggs"]);
  assert.equal(parsed.action.title, "Weekly shop");
});

test("computes a calendar end time from duration and validates invitees", () => {
  const parsed = parseCommand([
    "calendar",
    "create",
    "Bolo demo",
    "--start",
    "2026-07-28T11:00:00+05:30",
    "--duration",
    "30",
    "--calendar",
    "Work",
    "--invite",
    "teammate@example.com",
  ]);

  assert.equal(parsed.action.start, "2026-07-28T05:30:00.000Z");
  assert.equal(parsed.action.end, "2026-07-28T06:00:00.000Z");
  assert.deepEqual(parsed.action.invitees, ["teammate@example.com"]);
  assert.equal(parsed.action.calendar, "Work");
});

test("rejects ambiguous or malformed calendar arguments", () => {
  assert.throws(
    () =>
      parseCommand([
        "calendar",
        "create",
        "Demo",
        "--start",
        "2026-07-28T11:00:00+05:30",
        "--duration",
        "30",
        "--calendar",
        "Work",
        "--end",
        "2026-07-28T12:00:00+05:30",
      ]),
    /exactly one/i,
  );
  assert.throws(
    () =>
      parseCommand([
        "calendar",
        "create",
        "Demo",
        "--start",
        "not-a-date",
        "--duration",
        "30",
        "--calendar",
        "Work",
      ]),
    /valid ISO 8601 date/i,
  );
});

test("requires an explicit calendar and supports listing writable choices", () => {
  assert.deepEqual(parseCommand(["calendar", "list"]).action, {
    type: "calendar.list",
  });
  assert.throws(
    () =>
      parseCommand([
        "calendar",
        "create",
        "Demo",
        "--start",
        "2026-07-28T11:00:00+05:30",
        "--duration",
        "30",
      ]),
    /--calendar is required/i,
  );
});

test("passes one serialized payload to the fixed JXA program", async () => {
  const calls = [];
  const action = { type: "open", application: 'Notes"; malicious()' };
  const result = await sendAppleEvent(action, async (...args) => {
    calls.push(args);
    return { stdout: '{"ok":true,"message":"done"}\n', stderr: "" };
  });

  assert.equal(result.ok, true);
  assert.equal(calls[0][0], "/usr/bin/osascript");
  assert.equal(calls[0][1][0], "-l");
  assert.equal(calls[0][1][1], "JavaScript");
  assert.deepEqual(JSON.parse(calls[0][1][3]), action);
});
