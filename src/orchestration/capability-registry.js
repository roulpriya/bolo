import { z } from "zod";
import {
  APPROVAL_MODES,
  RISK_LEVELS,
  approvalModeForRisk,
} from "../domain/risk.js";

export class CapabilityRegistry {
  constructor() {
    this.capabilities = new Map();
  }

  register(definition) {
    const defaultLatency = {
      local: 1_000,
      apple_events: 2_500,
      browser: 15_000,
      computer: 20_000,
    }[definition.executor] || 15_000;
    const normalized = {
      available: () => true,
      timeoutMs: 120_000,
      retryLimit: 0,
      targetLatencyMs: defaultLatency,
      ...definition,
    };
    if (!normalized.id || this.capabilities.has(normalized.id)) {
      throw new Error(
        normalized.id
          ? `Capability "${normalized.id}" is already registered.`
          : "A capability id is required.",
      );
    }
    if (!(normalized.argumentsSchema instanceof z.ZodType)) {
      throw new Error(`Capability "${normalized.id}" needs an argument schema.`);
    }
    if (!Object.values(RISK_LEVELS).includes(normalized.risk)) {
      throw new Error(`Capability "${normalized.id}" has an invalid risk.`);
    }
    normalized.approval =
      normalized.approval || approvalModeForRisk(normalized.risk);
    if (normalized.approval === APPROVAL_MODES.UNSUPPORTED) {
      normalized.available = () => false;
    }
    this.capabilities.set(normalized.id, Object.freeze(normalized));
    return this;
  }

  get(id) {
    const capability = this.capabilities.get(id);
    if (!capability) throw new Error(`Unknown capability: ${id}`);
    return capability;
  }

  parseArguments(id, value) {
    return this.get(id).argumentsSchema.parse(value);
  }

  async isAvailable(id, context) {
    return Boolean(await this.get(id).available(context));
  }

  list() {
    return [...this.capabilities.values()];
  }
}

const text = (max = 1_000) => z.string().trim().min(1).max(max);
const dateTime = z.string().datetime({ offset: true });

export function createDefaultCapabilityRegistry() {
  return new CapabilityRegistry()
    .register({
      id: "local.youtube.open",
      description: "Open the YouTube home page.",
      argumentsSchema: z.object({}),
      risk: RISK_LEVELS.READ_ONLY,
      executor: "local",
      verification: "dispatch",
    })
    .register({
      id: "local.browser.search",
      description: "Open a web search in the default browser.",
      argumentsSchema: z.object({ query: text(500) }),
      risk: RISK_LEVELS.READ_ONLY,
      executor: "local",
      verification: "dispatch",
    })
    .register({
      id: "local.website.open",
      description: "Open a validated HTTPS website directly.",
      argumentsSchema: z.object({
        url: z.string().url(),
        host: text(253),
      }),
      risk: RISK_LEVELS.READ_ONLY,
      executor: "local",
      verification: "dispatch",
    })
    .register({
      id: "mac.application.open",
      description: "Open an allowlisted macOS application.",
      argumentsSchema: z.object({ application: text(100) }),
      risk: RISK_LEVELS.READ_ONLY,
      executor: "apple_events",
      verification: "read_back",
    })
    .register({
      id: "apple.notes.create-shopping-list",
      description: "Create a shopping-list note in Apple Notes.",
      argumentsSchema: z.object({
        title: text(200).default("Shopping List"),
        items: z.array(text(500)).min(1).max(200),
      }),
      risk: RISK_LEVELS.LOCAL_REVERSIBLE,
      executor: "apple_events",
      verification: "read_back",
    })
    .register({
      id: "apple.reminders.create",
      description: "Create a dated Apple Reminder.",
      argumentsSchema: z.object({
        title: text(500),
        due: dateTime,
        list: z.string().trim().max(200).nullable().default(null),
        notes: z.string().trim().max(4_000).nullable().default(null),
      }),
      risk: RISK_LEVELS.LOCAL_REVERSIBLE,
      executor: "apple_events",
      verification: "read_back",
    })
    .register({
      id: "apple.calendar.create",
      description: "Create an Apple Calendar event.",
      argumentsSchema: z.object({
        calendar: text(200),
        title: text(500),
        start: dateTime,
        durationMinutes: z.number().positive().max(7 * 24 * 60),
        invitees: z.array(z.string().email()).max(100).default([]),
        location: z.string().trim().max(1_000).nullable().default(null),
        notes: z.string().trim().max(4_000).nullable().default(null),
      }),
      risk: RISK_LEVELS.LOCAL_REVERSIBLE,
      executor: "apple_events",
      verification: "read_back",
    })
    .register({
      id: "apple.reminders.search",
      description: "Search Apple Reminders without modifying them.",
      argumentsSchema: z.object({ query: text(500) }),
      risk: RISK_LEVELS.READ_ONLY,
      executor: "apple_events",
      verification: "read_back",
    })
    .register({
      id: "apple.notes.search",
      description: "Search Apple Notes titles without modifying notes.",
      argumentsSchema: z.object({ query: text(500) }),
      risk: RISK_LEVELS.READ_ONLY,
      executor: "apple_events",
      verification: "read_back",
    })
    .register({
      id: "apple.contacts.search",
      description: "Look up contacts by name.",
      argumentsSchema: z.object({ query: text(500) }),
      risk: RISK_LEVELS.READ_ONLY,
      executor: "apple_events",
      verification: "read_back",
    })
    .register({
      id: "apple.music.control",
      description: "Control Apple Music playback.",
      argumentsSchema: z.object({
        command: z.enum(["play", "pause", "playpause", "next", "previous"]),
      }),
      risk: RISK_LEVELS.LOCAL_REVERSIBLE,
      executor: "apple_events",
      verification: "read_back",
    })
    .register({
      id: "apple.finder.reveal",
      description: "Reveal an existing non-sensitive file in Finder.",
      argumentsSchema: z.object({ path: text(2_000) }),
      risk: RISK_LEVELS.READ_ONLY,
      executor: "apple_events",
      verification: "read_back",
    })
    .register({
      id: "local.google-calendar.prefill",
      description: "Open a pre-filled Google Calendar event form.",
      argumentsSchema: z.object({
        title: text(500),
        start: dateTime,
        durationMinutes: z.number().positive().max(7 * 24 * 60),
      }),
      risk: RISK_LEVELS.READ_ONLY,
      executor: "local",
      verification: "dispatch",
    })
    .register({
      id: "browser.youtube.resolve",
      description: "Resolve a specific YouTube video and open it.",
      argumentsSchema: z.object({ videoQuery: text(500) }),
      risk: RISK_LEVELS.READ_ONLY,
      executor: "browser",
      verification: "browser",
    })
    .register({
      id: "browser.general",
      description: "Perform an approved task in a browser.",
      argumentsSchema: z.object({
        task: text(4_000),
        application: text(200),
      }),
      risk: RISK_LEVELS.READ_ONLY,
      executor: "browser",
      verification: "browser",
    })
    .register({
      id: "computer.general",
      description: "Perform an approved task in an allowlisted Mac app.",
      argumentsSchema: z.object({
        task: text(4_000),
        application: text(200),
      }),
      risk: RISK_LEVELS.LOCAL_REVERSIBLE,
      executor: "computer",
      verification: "screenshot",
    });
}

export const defaultCapabilityRegistry = createDefaultCapabilityRegistry();

const LEGACY_ACTION_CAPABILITIES = Object.freeze({
  youtube: "local.youtube.open",
  "browser-search": "local.browser.search",
  "website-open": "local.website.open",
  "app-open": "mac.application.open",
  "notes-shopping-list": "apple.notes.create-shopping-list",
  "apple-reminder": "apple.reminders.create",
  "apple-calendar-event": "apple.calendar.create",
  "reminders-search": "apple.reminders.search",
  "notes-search": "apple.notes.search",
  "contacts-search": "apple.contacts.search",
  "music-control": "apple.music.control",
  "finder-reveal": "apple.finder.reveal",
  "google-calendar": "local.google-calendar.prefill",
  "youtube-video": "browser.youtube.resolve",
});

export function capabilityForLegacyPlan(plan) {
  return (
    LEGACY_ACTION_CAPABILITIES[plan.action] ||
    (plan.executor === "browser" ? "browser.general" : "computer.general")
  );
}
