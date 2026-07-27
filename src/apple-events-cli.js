#!/usr/bin/env node

import { execFile } from "node:child_process";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import path from "node:path";

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(import.meta.dirname, "..");
const jxaProgram = path.join(projectRoot, "scripts", "bolo-apple-events.jxa");

export const HELP = `Bolo Mac — control common macOS apps with Apple Events

Usage:
  bolo-mac open <application>
  bolo-mac reminder add <title> [--list <name>] [--due <date>] [--notes <text>] [--open]
  bolo-mac note shopping [--title <title>] --item <item> [--item <item> ...]
                         [--folder <name>] [--open]
  bolo-mac calendar list
  bolo-mac calendar create <title> --calendar <name-or-selector> --start <date>
                           (--end <date> | --duration <minutes>)
                           [--location <text>] [--notes <text>]
                           [--invite <email> ...] [--open]

Global options:
  --dry-run   Validate and print the Apple Event request without sending it
  --json      Print machine-readable JSON
  -h, --help  Show this help

Dates:
  Use ISO 8601. An explicit offset is recommended, for example:
  2026-07-27T11:00:00+05:30

Examples:
  bolo-mac open Reminders
  bolo-mac reminder add "Buy milk" --list Shopping --due "2026-07-27T18:00:00+05:30"
  bolo-mac note shopping --title "Weekly shop" --item milk --item bread --item eggs
  bolo-mac calendar list
  bolo-mac calendar create "Bolo demo" --calendar Work \\
    --start "2026-07-28T11:00:00+05:30" --duration 30 \\
    --invite teammate@example.com
`;

function fail(message) {
  throw new Error(message);
}

function readOptions(args, repeatable = new Set()) {
  const positionals = [];
  const options = {};
  const booleans = new Set(["dry-run", "json", "open", "help"]);

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === "-h") {
      options.help = true;
      continue;
    }
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const key = token.slice(2);
    if (booleans.has(key)) {
      options[key] = true;
      continue;
    }
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) {
      fail(`Option --${key} needs a value.`);
    }
    index += 1;
    if (repeatable.has(key)) {
      options[key] ||= [];
      options[key].push(value);
    } else if (Object.hasOwn(options, key)) {
      fail(`Option --${key} can only be used once.`);
    } else {
      options[key] = value;
    }
  }
  return { positionals, options };
}

function onlyOptions(options, allowed) {
  for (const key of Object.keys(options)) {
    if (!allowed.has(key)) fail(`Unknown option --${key}.`);
  }
}

function text(value, label) {
  const result = String(value ?? "").trim();
  if (!result) fail(`${label} is required.`);
  return result;
}

function isoDate(value, label) {
  const source = text(value, label);
  const date = new Date(source);
  if (Number.isNaN(date.getTime())) fail(`${label} must be a valid ISO 8601 date.`);
  return date.toISOString();
}

function email(value) {
  const result = text(value, "Invitee email");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) {
    fail(`Invalid invitee email: ${result}`);
  }
  return result;
}

export function parseCommand(argv) {
  const { positionals, options } = readOptions(
    argv,
    new Set(["item", "invite"]),
  );
  const global = {
    dryRun: Boolean(options["dry-run"]),
    json: Boolean(options.json),
  };
  if (options.help || argv.length === 0) return { help: true, global };

  const [resource, verb, ...names] = positionals;

  if (resource === "open") {
    onlyOptions(options, new Set(["dry-run", "json"]));
    if (!verb || names.length) fail("Usage: bolo-mac open <application>");
    return { action: { type: "open", application: text(verb, "Application") }, global };
  }

  if (resource === "reminder" && verb === "add") {
    onlyOptions(
      options,
      new Set(["dry-run", "json", "list", "due", "notes", "open"]),
    );
    if (names.length !== 1) fail("A reminder title is required.");
    return {
      action: {
        type: "reminder.add",
        title: text(names[0], "Reminder title"),
        list: options.list ? text(options.list, "Reminder list") : null,
        due: options.due ? isoDate(options.due, "Reminder due date") : null,
        notes: options.notes ? text(options.notes, "Reminder notes") : null,
        open: Boolean(options.open),
      },
      global,
    };
  }

  if (resource === "note" && verb === "shopping") {
    onlyOptions(
      options,
      new Set(["dry-run", "json", "title", "item", "folder", "open"]),
    );
    if (names.length) fail("Shopping note items must be passed with --item.");
    const items = (options.item || []).map((item) => text(item, "Shopping item"));
    if (!items.length) fail("At least one --item is required.");
    return {
      action: {
        type: "note.shopping",
        title: options.title ? text(options.title, "Note title") : "Shopping List",
        items,
        folder: options.folder ? text(options.folder, "Notes folder") : null,
        open: Boolean(options.open),
      },
      global,
    };
  }

  if (resource === "calendar" && verb === "list") {
    onlyOptions(options, new Set(["dry-run", "json"]));
    if (names.length) fail("Usage: bolo-mac calendar list");
    return { action: { type: "calendar.list" }, global };
  }

  if (resource === "calendar" && verb === "create") {
    onlyOptions(
      options,
      new Set([
        "dry-run",
        "json",
        "start",
        "end",
        "duration",
        "calendar",
        "location",
        "notes",
        "invite",
        "open",
      ]),
    );
    if (names.length !== 1) fail("A calendar event title is required.");
    if (!options.calendar) fail("--calendar is required. Use “bolo-mac calendar list” to see writable calendars.");
    if (!options.start) fail("--start is required.");
    if (Boolean(options.end) === Boolean(options.duration)) {
      fail("Use exactly one of --end or --duration.");
    }
    const start = isoDate(options.start, "Event start");
    let end;
    if (options.end) {
      end = isoDate(options.end, "Event end");
    } else {
      const minutes = Number(options.duration);
      if (!Number.isFinite(minutes) || minutes <= 0) {
        fail("--duration must be a positive number of minutes.");
      }
      end = new Date(new Date(start).getTime() + minutes * 60_000).toISOString();
    }
    if (new Date(end) <= new Date(start)) fail("Event end must be after its start.");
    return {
      action: {
        type: "calendar.create",
        title: text(names[0], "Event title"),
        start,
        end,
        calendar: text(options.calendar, "Calendar"),
        location: options.location ? text(options.location, "Location") : null,
        notes: options.notes ? text(options.notes, "Event notes") : null,
        invitees: (options.invite || []).map(email),
        open: Boolean(options.open),
      },
      global,
    };
  }

  fail(`Unknown command. Run "bolo-mac --help" for usage.`);
}

export async function sendAppleEvent(action, runner = execFileAsync) {
  try {
    const { stdout } = await runner(
      "/usr/bin/osascript",
      ["-l", "JavaScript", jxaProgram, JSON.stringify(action)],
      { timeout: 30_000, maxBuffer: 1024 * 1024 },
    );
    return JSON.parse(stdout.trim());
  } catch (error) {
    const detail = String(error.stderr || error.message || error).trim();
    if (/not authorized|not permitted|-1743/i.test(detail)) {
      throw new Error(
        "macOS blocked Automation access. Allow your terminal under System Settings → Privacy & Security → Automation, then retry.",
      );
    }
    throw new Error(`Apple Event failed: ${detail}`);
  }
}

export async function main(argv = process.argv.slice(2)) {
  const parsed = parseCommand(argv);
  if (parsed.help) {
    process.stdout.write(HELP);
    return;
  }

  const result = parsed.global.dryRun
    ? { ok: true, dryRun: true, action: parsed.action }
    : await sendAppleEvent(parsed.action);

  if (parsed.global.json || parsed.global.dryRun) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(`${result.message}\n`);
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    process.stderr.write(`bolo-mac: ${error.message}\n`);
    process.exitCode = 1;
  });
}
