import { CapabilityResultSchema } from "../domain/result.js";
import { APPROVAL_MODES, RISK_LEVELS } from "../domain/risk.js";
import { validateTaskPlan } from "../domain/task-plan.js";

function abortError() {
  return new DOMException("The task was cancelled.", "AbortError");
}

function valueAtPath(value, path) {
  return path.reduce(
    (current, key) =>
      current && Object.prototype.hasOwnProperty.call(current, key)
        ? current[key]
        : undefined,
    value,
  );
}

function resolveArguments(value, dependencyResults) {
  if (Array.isArray(value)) {
    return value.map((entry) => resolveArguments(entry, dependencyResults));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        resolveArguments(entry, dependencyResults),
      ]),
    );
  }
  if (typeof value !== "string" || !value.startsWith("$steps.")) return value;
  const [, stepId, ...path] = value.split(".");
  if (!Object.prototype.hasOwnProperty.call(dependencyResults, stepId)) {
    throw new Error(`Step output reference uses unavailable step "${stepId}".`);
  }
  const resolved = valueAtPath(dependencyResults[stepId], path);
  if (resolved === undefined) {
    throw new Error(`Step output reference "${value}" could not be resolved.`);
  }
  return resolved;
}

export class TaskOrchestrator {
  constructor({ registry, executeStep, policyEngine }) {
    if (!registry || typeof executeStep !== "function") {
      throw new Error("TaskOrchestrator requires a registry and step executor.");
    }
    this.registry = registry;
    this.executeStep = executeStep;
    this.policyEngine = policyEngine;
  }

  async execute(
    rawPlan,
    {
      signal,
      onStepUpdate = () => {},
      justInTimeApprovals = new Set(),
      context = {},
    } = {},
  ) {
    const plan = validateTaskPlan(rawPlan);
    const pending = new Map(plan.steps.map((step) => [step.id, step]));
    const results = new Map();

    while (pending.size) {
      if (signal?.aborted) throw abortError();
      const ready = [...pending.values()].filter((step) =>
        step.dependsOn.every((dependency) => results.has(dependency)),
      );
      if (!ready.length) {
        throw new Error("The plan has unresolved step dependencies.");
      }

      const readOnly = ready.filter(
        (step) => step.risk === RISK_LEVELS.READ_ONLY,
      );
      const batch = readOnly.length ? readOnly : [ready[0]];
      const outcomes = await Promise.all(
        batch.map((step) =>
          this.executeOne(step, {
            plan,
            results,
            signal,
            onStepUpdate,
            justInTimeApprovals,
            context,
          }),
        ),
      );

      for (let index = 0; index < batch.length; index += 1) {
        const step = batch[index];
        const result = outcomes[index];
        results.set(step.id, result);
        pending.delete(step.id);
        if (result.status !== "verified") {
          return {
            status: result.status,
            evidence: result.evidence,
            confidence: result.confidence,
            failedStepId: step.id,
            stepResults: Object.fromEntries(results),
          };
        }
      }
    }

    const ordered = plan.steps.map((step) => results.get(step.id));
    return {
      status: "verified",
      evidence: ordered.map((result) => result.evidence).filter(Boolean).join(" "),
      confidence: Math.min(...ordered.map((result) => result.confidence)),
      stepResults: Object.fromEntries(results),
    };
  }

  async executeOne(
    step,
    {
      plan,
      results,
      signal,
      onStepUpdate,
      justInTimeApprovals,
      context,
    },
  ) {
    if (signal?.aborted) throw abortError();
    const capability = this.registry.get(step.capability);
    if (!(await this.registry.isAvailable(step.capability, context))) {
      return CapabilityResultSchema.parse({
        status: "failed",
        evidence: `Capability "${step.capability}" is unavailable.`,
        error: "capability_unavailable",
      });
    }
    if (
      capability.approval === APPROVAL_MODES.JUST_IN_TIME &&
      !justInTimeApprovals.has(step.id)
    ) {
      return CapabilityResultSchema.parse({
        status: "needs_approval",
        evidence: `Step “${step.title}” needs confirmation immediately before execution.`,
      });
    }

    const dependencyResults = Object.fromEntries(
      step.dependsOn.map((id) => [id, results.get(id)]),
    );
    const parsedArguments = this.registry.parseArguments(
      step.capability,
      resolveArguments(step.arguments, dependencyResults),
    );
    const scopedStep = { ...step, arguments: parsedArguments };
    const authorization = this.policyEngine?.authorize({
      step: scopedStep,
      capability,
      plan,
      context,
    });
    if (authorization && authorization.allowed !== true) {
      return CapabilityResultSchema.parse({
        status: "failed",
        evidence: authorization.reason || "The step is blocked by policy.",
        error: "policy_denied",
      });
    }
    onStepUpdate({ stepId: step.id, state: "executing", title: step.title });
    try {
      const result = CapabilityResultSchema.parse(
        await this.executeStep({
          plan,
          step: scopedStep,
          capability,
          dependencyResults,
          signal,
          context,
        }),
      );
      onStepUpdate({
        stepId: step.id,
        state: result.status,
        title: step.title,
        result,
      });
      return result;
    } catch (error) {
      if (signal?.aborted || error.name === "AbortError") throw abortError();
      const result = CapabilityResultSchema.parse({
        status: "failed",
        evidence: error.message,
        error: error.message,
      });
      onStepUpdate({
        stepId: step.id,
        state: "failed",
        title: step.title,
        result,
      });
      return result;
    }
  }
}
