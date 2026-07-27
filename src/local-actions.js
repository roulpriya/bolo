import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { sendAppleEvent } from "./apple-events-cli.js";
import { configuredApplicationAllowlist } from "./orchestration/policy-engine.js";

const execFileAsync = promisify(execFile);

export async function safeFinderPath(value) {
  const requested = String(value || "").trim();
  if (!path.isAbsolute(requested) || requested.includes("\0")) {
    throw new Error("Finder requires an absolute local path.");
  }
  const resolved = await realpath(requested);
  const home = await realpath(os.homedir());
  const relative = path.relative(home, resolved);
  if (
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    /^(?:\.ssh|\.gnupg|Library\/Keychains|Library\/Safari)(?:\/|$)/.test(
      relative,
    )
  ) {
    throw new Error("That path is outside Bolo's allowed Finder scope.");
  }
  return resolved;
}

export async function openUrlInDefaultBrowser(rawUrl, allowedHosts) {
  const url = new URL(rawUrl);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !allowedHosts.includes(url.hostname)
  ) {
    throw new Error("The resolved URL is not an allowed HTTPS destination.");
  }
  await execFileAsync("open", [url.toString()], { timeout: 10_000 });
}

function calendarStamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("The calendar date is invalid.");
  const part = (number) => String(number).padStart(2, "0");
  return [
    date.getFullYear(),
    part(date.getMonth() + 1),
    part(date.getDate()),
    "T",
    part(date.getHours()),
    part(date.getMinutes()),
    "00",
  ].join("");
}

export function buildReminderAppleEvent(details = {}) {
  const title = String(details.title || "").trim();
  const due = new Date(details.due);
  if (!title || Number.isNaN(due.getTime())) {
    throw new Error("A reminder title and valid due date are required.");
  }
  return {
    type: "reminder.add",
    title,
    list: details.list ? String(details.list).trim() : null,
    due: due.toISOString(),
    notes: details.notes ? String(details.notes).trim() : null,
    open: true,
  };
}

export function buildNoteAppleEvent(details = {}) {
  const title = String(details.title || "Shopping List").trim();
  const items = Array.isArray(details.items)
    ? details.items.map((item) => String(item).trim()).filter(Boolean)
    : [];
  if (!title || !items.length || items.length > 200) {
    throw new Error("A note title and between 1 and 200 items are required.");
  }
  return {
    type: "note.shopping",
    title,
    items,
    folder: details.folder ? String(details.folder).trim() : null,
    open: true,
  };
}

export function buildCalendarAppleEvent(details = {}) {
  const title = String(details.title || "").trim();
  const calendar = String(details.calendar || "").trim();
  const start = new Date(details.start);
  const duration = Number(details.durationMinutes);
  const invitees = Array.isArray(details.invitees)
    ? details.invitees.map((value) => String(value).trim()).filter(Boolean)
    : [];
  if (
    !title ||
    !calendar ||
    Number.isNaN(start.getTime()) ||
    !Number.isFinite(duration) ||
    duration <= 0
  ) {
    throw new Error(
      "An event title, Apple Calendar name, valid start, and positive duration are required.",
    );
  }
  for (const invitee of invitees) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(invitee)) {
      throw new Error(`Invalid calendar invitee email: ${invitee}`);
    }
  }
  return {
    type: "calendar.create",
    title,
    start: start.toISOString(),
    end: new Date(start.getTime() + duration * 60_000).toISOString(),
    calendar,
    location: details.location ? String(details.location).trim() : null,
    notes: details.notes ? String(details.notes).trim() : null,
    invitees,
    open: true,
  };
}

export function buildBrowserSearchUrl(details = {}) {
  const query = String(details.query || "").trim();
  if (!query || query.length > 500) {
    throw new Error("A browser search query between 1 and 500 characters is required.");
  }
  const url = new URL("https://www.google.com/search");
  url.searchParams.set("q", query);
  return url.toString();
}

export function buildOpenApplicationEvent(details = {}) {
  const application = String(details.application || "").trim();
  if (!application || application.length > 100 || /[\r\n\0]/.test(application)) {
    throw new Error("A valid macOS application name is required.");
  }
  if (!configuredApplicationAllowlist().has(application)) {
    throw new Error(
      `${application} is not in the configured application allowlist.`,
    );
  }
  return {
    type: "open",
    application,
  };
}

export async function executeLocalAction(plan) {
  const action = plan.action;
  const details = plan.details || {};

  if (action === "youtube") {
    await openUrlInDefaultBrowser("https://www.youtube.com", [
      "youtube.com",
      "www.youtube.com",
    ]);
    return {
      status: "verified",
      evidence: "YouTube was opened in the default browser.",
      confidence: 1,
    };
  }

  if (action === "browser-search") {
    const url = buildBrowserSearchUrl(details);
    await openUrlInDefaultBrowser(url, ["www.google.com"]);
    return {
      status: "verified",
      evidence: `Opened the default browser with search results for “${details.query.trim()}”.`,
      confidence: 1,
    };
  }

  if (action === "website-open") {
    const url = new URL(String(details.url || ""));
    const host = String(details.host || "").trim().toLowerCase();
    if (
      url.protocol !== "https:" ||
      url.hostname !== host ||
      url.username ||
      url.password ||
      url.port
    ) {
      throw new Error("A matching safe HTTPS website and hostname are required.");
    }
    await openUrlInDefaultBrowser(url.toString(), [host]);
    return {
      status: "verified",
      evidence: `Opened ${host} in the default browser.`,
      confidence: 1,
    };
  }

  if (action === "app-open") {
    const appleEvent = buildOpenApplicationEvent(details);
    const result = await sendAppleEvent(appleEvent);
    return {
      status: "verified",
      evidence: result.message,
      confidence: 1,
    };
  }

  if (action === "notes-shopping-list") {
    const appleEvent = buildNoteAppleEvent(details);
    const result = await sendAppleEvent(appleEvent);
    if (result.verified !== true) {
      throw new Error("Apple Notes did not verify the created note.");
    }
    return {
      status: "verified",
      evidence: result.message,
      confidence: 1,
      createdResourceIds: result.resourceId ? [result.resourceId] : [],
    };
  }

  if (action === "apple-reminder") {
    const appleEvent = buildReminderAppleEvent(details);
    const result = await sendAppleEvent(appleEvent);
    if (result.verified !== true) {
      throw new Error("Apple Reminders did not verify the created reminder.");
    }
    const due = new Date(appleEvent.due);
    return {
      status: "verified",
      evidence: `${result.message} It is due ${due.toLocaleString("en-IN")}.`,
      confidence: 1,
      createdResourceIds: result.resourceId ? [result.resourceId] : [],
    };
  }

  if (action === "apple-calendar-event") {
    const appleEvent = buildCalendarAppleEvent(details);
    const result = await sendAppleEvent(appleEvent);
    if (result.verified !== true) {
      throw new Error("Apple Calendar did not verify the created event.");
    }
    return {
      status: "verified",
      evidence: result.message,
      confidence: 1,
      createdResourceIds: result.resourceId ? [result.resourceId] : [],
    };
  }

  if (
    ["reminders-search", "notes-search", "contacts-search"].includes(action)
  ) {
    const query = String(details.query || "").trim();
    if (!query || query.length > 500) {
      throw new Error("A search query between 1 and 500 characters is required.");
    }
    const type = {
      "reminders-search": "reminder.search",
      "notes-search": "note.search",
      "contacts-search": "contact.search",
    }[action];
    const result = await sendAppleEvent({ type, query });
    return {
      status: "verified",
      evidence: result.message,
      confidence: 1,
      data: { results: result.results || [] },
    };
  }

  if (action === "music-control") {
    const command = String(details.command || "");
    if (!["play", "pause", "playpause", "next", "previous"].includes(command)) {
      throw new Error("A supported Apple Music command is required.");
    }
    const result = await sendAppleEvent({ type: "music.control", command });
    if (result.verified !== true) {
      throw new Error("Apple Music did not verify the requested playback state.");
    }
    return {
      status: "verified",
      evidence: result.message,
      confidence: 1,
      data: { playerState: result.playerState || null },
    };
  }

  if (action === "finder-reveal") {
    const filePath = await safeFinderPath(details.path);
    const result = await sendAppleEvent({
      type: "finder.reveal",
      path: filePath,
    });
    if (result.verified !== true) {
      throw new Error("Finder did not verify the revealed item.");
    }
    return {
      status: "verified",
      evidence: result.message,
      confidence: 1,
      data: { path: result.path },
    };
  }

  if (action === "google-calendar") {
    const title = String(details.title || "").trim();
    const start = new Date(details.start);
    const duration = Number(details.durationMinutes);
    if (
      !title ||
      Number.isNaN(start.getTime()) ||
      !Number.isFinite(duration) ||
      duration <= 0
    ) {
      throw new Error("Complete Google Calendar event details are required.");
    }
    const end = new Date(start.getTime() + duration * 60_000);
    const url = new URL("https://calendar.google.com/calendar/render");
    url.searchParams.set("action", "TEMPLATE");
    url.searchParams.set("text", title);
    url.searchParams.set(
      "dates",
      `${calendarStamp(start)}/${calendarStamp(end)}`,
    );
    url.searchParams.set("ctz", Intl.DateTimeFormat().resolvedOptions().timeZone);
    url.searchParams.set("details", "Created with Bolo");
    await execFileAsync("open", [url.toString()], { timeout: 10_000 });
    return {
      status: "verified",
      evidence: `Opened a pre-filled “${title}” event in Google Calendar. Review it and click Save.`,
      confidence: 1,
    };
  }

  throw new Error("That local action is not allowed.");
}

export const LOCAL_ACTIONS = new Set([
  "youtube",
  "notes-shopping-list",
  "google-calendar",
  "apple-reminder",
  "apple-calendar-event",
  "browser-search",
  "website-open",
  "app-open",
  "reminders-search",
  "notes-search",
  "contacts-search",
  "music-control",
  "finder-reveal",
]);
