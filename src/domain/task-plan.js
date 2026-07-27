import crypto from "node:crypto";
import { z } from "zod";
import {
  APPROVAL_MODES,
  RISK_LEVELS,
  approvalModeForRisk,
} from "./risk.js";

export const TaskStepSchema = z.object({
  id: z.string().min(1).max(80),
  title: z.string().min(1).max(200),
  capability: z.string().min(1).max(120),
  action: z.string().min(1).max(120),
  arguments: z.record(z.string(), z.unknown()).default({}),
  dependsOn: z.array(z.string()).default([]),
  inputsFrom: z.array(z.string()).default([]),
  risk: z.enum(Object.values(RISK_LEVELS)),
  approval: z.enum(Object.values(APPROVAL_MODES)),
  successCriteria: z.array(z.string().min(1)).min(1),
  fallbackCapabilities: z.array(z.string()).default([]),
  targetLatencyMs: z.number().int().positive().max(120_000).default(15_000),
});

export const TaskPlanSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  version: z.number().int().positive(),
  goal: z.string().min(1).max(500),
  title: z.string().min(1).max(200),
  task: z.string().min(1).max(4_000),
  application: z.string().min(1).max(200),
  locale: z.string().min(2).max(35),
  timezone: z.string().min(1).max(100),
  status: z.enum(["draft", "awaiting_approval", "approved"]),
  requiresConfirmation: z.boolean(),
  steps: z.array(TaskStepSchema).min(1).max(20),
});

function assertAcyclic(steps) {
  const ids = new Set(steps.map((step) => step.id));
  if (ids.size !== steps.length) {
    throw new Error("Every plan step must have a unique id.");
  }
  for (const step of steps) {
    for (const dependency of step.dependsOn) {
      if (!ids.has(dependency)) {
        throw new Error(
          `Plan step "${step.id}" depends on unknown step "${dependency}".`,
        );
      }
      if (dependency === step.id) {
        throw new Error(`Plan step "${step.id}" cannot depend on itself.`);
      }
    }
  }

  const visiting = new Set();
  const visited = new Set();
  const byId = new Map(steps.map((step) => [step.id, step]));
  function visit(id) {
    if (visiting.has(id)) throw new Error("The task plan contains a cycle.");
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id).dependsOn) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  }
  for (const step of steps) visit(step.id);
}

export function validateTaskPlan(value) {
  const plan = TaskPlanSchema.parse(value);
  assertAcyclic(plan.steps);
  return plan;
}

export function createTaskPlan({
  id = crypto.randomUUID(),
  version = 1,
  goal,
  title,
  task,
  application,
  locale = "en-IN",
  timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  steps,
  status = "awaiting_approval",
}) {
  return validateTaskPlan({
    schemaVersion: 1,
    id,
    version,
    goal,
    title,
    task,
    application,
    locale,
    timezone,
    status,
    requiresConfirmation: true,
    steps: steps.map((step) => ({
      ...step,
      approval: step.approval || approvalModeForRisk(step.risk),
    })),
  });
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

export function planHash(plan) {
  const validated = validateTaskPlan(plan);
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(canonicalize(validated)))
    .digest("hex");
}
