import { APPROVAL_MODES, RISK_LEVELS } from "../domain/risk.js";

export const DEFAULT_ALLOWED_APPLICATIONS = Object.freeze([
  "Calculator",
  "Calendar",
  "Contacts",
  "Finder",
  "Mail",
  "Maps",
  "Messages",
  "Music",
  "Notes",
  "Preview",
  "Reminders",
  "Safari",
  "System Settings",
  "TextEdit",
]);

const NEVER_CONTROL = new Set([
  "Keychain Access",
  "Passwords",
  "SecurityAgent",
]);

export function configuredApplicationAllowlist(
  configured = process.env.BOLO_ALLOWED_APPLICATIONS,
) {
  const additions = String(configured || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return new Set([...DEFAULT_ALLOWED_APPLICATIONS, ...additions]);
}

export class PolicyEngine {
  constructor({ allowedApplications = configuredApplicationAllowlist() } = {}) {
    this.allowedApplications = allowedApplications;
  }

  authorize({ step, capability }) {
    if (
      step.risk === RISK_LEVELS.DESTRUCTIVE ||
      capability.approval === APPROVAL_MODES.UNSUPPORTED
    ) {
      return { allowed: false, reason: "Destructive actions are unsupported." };
    }

    const application = String(step.arguments.application || "").trim();
    if (application && NEVER_CONTROL.has(application)) {
      return {
        allowed: false,
        reason: `${application} cannot be controlled by Bolo.`,
      };
    }
    if (
      application &&
      ["mac.application.open", "computer.general"].includes(step.capability) &&
      !this.allowedApplications.has(application)
    ) {
      return {
        allowed: false,
        reason: `${application} is not in the configured application allowlist.`,
      };
    }

    const instruction = String(step.arguments.task || "");
    if (
      step.capability === "browser.general" &&
      /\b(?:buy|purchase|checkout|wire money|bank transfer|enter password|change password|delete account)\b/i.test(
        instruction,
      )
    ) {
      return {
        allowed: false,
        reason: "Financial, credential, and destructive browser actions are unsupported.",
      };
    }
    return { allowed: true };
  }
}

export const defaultPolicyEngine = new PolicyEngine();
