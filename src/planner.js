import crypto from "node:crypto";
import { createTaskPlan } from "./domain/task-plan.js";
import {
  capabilityForLegacyPlan,
  defaultCapabilityRegistry,
} from "./orchestration/capability-registry.js";

const EXECUTOR_LABELS = {
  browser: "Browser Use",
  computer: "Computer Use",
};

export function buildTaskPlan(interpretation) {
  if (
    interpretation.status !== "ready" ||
    !["browser", "computer"].includes(interpretation.executor) ||
    !String(interpretation.task || "").trim()
  ) {
    throw new Error("Bolo needs a complete task.");
  }

  const executor = interpretation.executor;
  const action = interpretation.action || null;
  const details = interpretation.details || null;
  const title =
    String(interpretation.title || "").trim() ||
    (executor === "browser" ? "Browser task" : "Computer task");
  const task = String(interpretation.task).trim();
  const application =
    String(interpretation.application || "").trim() ||
    (executor === "browser" ? "Web browser" : "This Mac");
  const legacyPlan = {
    action,
    details,
    executor,
  };
  const capability = capabilityForLegacyPlan(legacyPlan);
  const definition = defaultCapabilityRegistry.get(capability);
  const argumentsValue =
    details ||
    (capability === "browser.general" || capability === "computer.general"
      ? { task, application }
      : {});
  const parsedArguments = defaultCapabilityRegistry.parseArguments(
    capability,
    argumentsValue,
  );
  const successCriteria = [
    "The requested outcome is visibly complete",
    "The final state is checked before claiming success",
    "No unrelated action is performed",
  ];
  const contracted = createTaskPlan({
    id: crypto.randomUUID(),
    goal: task,
    title,
    task,
    application,
    steps: [
      {
        id: "step-1",
        title,
        capability,
        action: action || "perform",
        arguments: parsedArguments,
        dependsOn: [],
        inputsFrom: [],
        risk: definition.risk,
        approval: definition.approval,
        successCriteria,
        fallbackCapabilities: [],
        targetLatencyMs: definition.targetLatencyMs,
      },
    ],
  });
  return {
    ...contracted,
    goal: "perform_task",
    executor,
    action,
    details,
    successCriteria,
  };
}

export function buildMultiStepTaskPlan({
  title,
  task,
  application = "Multiple applications",
  locale = "en-IN",
  timezone,
  steps,
}) {
  if (!Array.isArray(steps) || steps.length < 2) {
    throw new Error("A multi-step plan requires at least two steps.");
  }
  const compiledSteps = steps.map((step, index) => {
    if (
      !["browser", "computer"].includes(step.executor) ||
      !String(step.task || "").trim()
    ) {
      throw new Error("Every multi-step plan step must be complete.");
    }
    const action = step.action || null;
    const details = step.details || null;
    const application =
      String(step.application || "").trim() ||
      (step.executor === "browser" ? "Web browser" : "This Mac");
    const capability = capabilityForLegacyPlan({
      action,
      executor: step.executor,
    });
    const definition = defaultCapabilityRegistry.get(capability);
    const rawArguments =
      details ||
      (["browser.general", "computer.general"].includes(capability)
        ? { task: step.task, application }
        : {});
    const hasReference = JSON.stringify(rawArguments).includes("$steps.");
    const argumentsValue = hasReference
      ? rawArguments
      : defaultCapabilityRegistry.parseArguments(capability, rawArguments);
    return {
      id: String(step.id || `step-${index + 1}`),
      title: String(step.title || `Step ${index + 1}`),
      capability,
      action: action || "perform",
      arguments: argumentsValue,
      dependsOn: Array.isArray(step.dependsOn) ? step.dependsOn : [],
      inputsFrom: Array.isArray(step.dependsOn) ? step.dependsOn : [],
      risk: definition.risk,
      approval: definition.approval,
      successCriteria: [
        "The requested step outcome is complete",
        "The result is verified before dependent steps run",
      ],
      fallbackCapabilities: [],
      targetLatencyMs: definition.targetLatencyMs,
    };
  });
  const contracted = createTaskPlan({
    goal: task,
    title,
    task,
    application,
    locale,
    timezone,
    steps: compiledSteps,
  });
  return {
    ...contracted,
    goal: "perform_task",
    executor: "orchestrator",
    action: null,
    details: null,
    successCriteria: [
      "Every required step completes in dependency order",
      "Every final state is verified before completion",
      "No unrelated action is performed",
    ],
  };
}

export function executorLabel(plan) {
  return EXECUTOR_LABELS[plan.executor] || "Agent";
}

export function confirmationText(plan) {
  return `I’ll ${plan.task} Please review the details before I start.`;
}

export function completionText(plan, verification) {
  const evidence = String(verification?.evidence || "").trim();
  return evidence
    ? `Done. ${evidence}`
    : `Done. I completed “${plan.title}”.`;
}
