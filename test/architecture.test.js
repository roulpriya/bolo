import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { ApprovalService } from "../src/orchestration/approval-service.js";
import {
  CapabilityRegistry,
  defaultCapabilityRegistry,
} from "../src/orchestration/capability-registry.js";
import { TaskOrchestrator } from "../src/orchestration/orchestrator.js";
import { createTaskPlan, planHash } from "../src/domain/task-plan.js";
import { RISK_LEVELS } from "../src/domain/risk.js";
import { PolicyEngine } from "../src/orchestration/policy-engine.js";

function step({
  id,
  capability = "test.read",
  dependsOn = [],
  risk = RISK_LEVELS.READ_ONLY,
}) {
  return {
    id,
    title: id,
    capability,
    action: "test",
    arguments: {},
    dependsOn,
    inputsFrom: dependsOn,
    risk,
    successCriteria: [`${id} completes`],
    fallbackCapabilities: [],
  };
}

function plan(steps) {
  return createTaskPlan({
    id: "plan-1",
    goal: "Test orchestration",
    title: "Test",
    task: "Run the test plan.",
    application: "Test",
    steps,
  });
}

function testRegistry() {
  return new CapabilityRegistry()
    .register({
      id: "test.read",
      argumentsSchema: z.object({}),
      risk: RISK_LEVELS.READ_ONLY,
      executor: "test",
    })
    .register({
      id: "test.write",
      argumentsSchema: z.object({}),
      risk: RISK_LEVELS.LOCAL_REVERSIBLE,
      executor: "test",
    });
}

test("plan hashes are stable across object key order", () => {
  const value = plan([step({ id: "one" })]);
  const reordered = {
    steps: value.steps,
    status: value.status,
    timezone: value.timezone,
    locale: value.locale,
    application: value.application,
    task: value.task,
    title: value.title,
    goal: value.goal,
    version: value.version,
    id: value.id,
    schemaVersion: value.schemaVersion,
    requiresConfirmation: value.requiresConfirmation,
  };
  assert.equal(planHash(value), planHash(reordered));
});

test("approval tokens are plan-bound and single-use", () => {
  const service = new ApprovalService({ secret: "test-secret" });
  const approved = plan([step({ id: "one" })]);
  const changed = plan([step({ id: "different" })]);
  const token = service.issue(approved);

  assert.equal(service.verify(changed, token), false);
  assert.equal(service.verify(approved, token, { consume: true }), true);
  assert.equal(service.verify(approved, token), false);
});

test("capability registry validates arguments", () => {
  assert.equal(
    defaultCapabilityRegistry.parseArguments("local.browser.search", {
      query: "Bolo",
    }).query,
    "Bolo",
  );
  assert.throws(
    () =>
      defaultCapabilityRegistry.parseArguments("local.browser.search", {
        query: "",
      }),
    /too small/i,
  );
});

test("plan validation rejects dependency cycles", () => {
  assert.throws(
    () =>
      plan([
        step({ id: "one", dependsOn: ["two"] }),
        step({ id: "two", dependsOn: ["one"] }),
      ]),
    /cycle/i,
  );
});

test("orchestrator runs independent reads before a dependent mutation", async () => {
  const events = [];
  const orchestrator = new TaskOrchestrator({
    registry: testRegistry(),
    async executeStep({ step: taskStep, dependencyResults }) {
      events.push({
        id: taskStep.id,
        dependencies: Object.keys(dependencyResults),
      });
      return {
        status: "verified",
        evidence: `${taskStep.id} done.`,
        confidence: 1,
      };
    },
  });
  const result = await orchestrator.execute(
    plan([
      step({ id: "read-a" }),
      step({ id: "read-b" }),
      step({
        id: "write",
        capability: "test.write",
        dependsOn: ["read-a", "read-b"],
        risk: RISK_LEVELS.LOCAL_REVERSIBLE,
      }),
    ]),
  );

  assert.equal(result.status, "verified");
  assert.deepEqual(
    new Set(events.slice(0, 2).map((event) => event.id)),
    new Set(["read-a", "read-b"]),
  );
  assert.deepEqual(events[2], {
    id: "write",
    dependencies: ["read-a", "read-b"],
  });
});

test("orchestrator resolves explicit dependency output references", async () => {
  const registry = testRegistry();
  registry.register({
    id: "test.write-value",
    argumentsSchema: z.object({ value: z.string() }),
    risk: RISK_LEVELS.LOCAL_REVERSIBLE,
    executor: "test",
  });
  let received;
  const orchestrator = new TaskOrchestrator({
    registry,
    async executeStep({ step: taskStep }) {
      if (taskStep.id === "read") {
        return {
          status: "verified",
          evidence: "Found it.",
          confidence: 1,
          data: { value: "resolved-value" },
        };
      }
      received = taskStep.arguments.value;
      return { status: "verified", evidence: "Used it.", confidence: 1 };
    },
  });
  const taskPlan = plan([
    step({ id: "read" }),
    {
      ...step({
        id: "write",
        capability: "test.write-value",
        dependsOn: ["read"],
        risk: RISK_LEVELS.LOCAL_REVERSIBLE,
      }),
      arguments: { value: "$steps.read.data.value" },
    },
  ]);

  assert.equal((await orchestrator.execute(taskPlan)).status, "verified");
  assert.equal(received, "resolved-value");
});

test("orchestrator stops dependent execution after an uncertain result", async () => {
  const executed = [];
  const orchestrator = new TaskOrchestrator({
    registry: testRegistry(),
    async executeStep({ step: taskStep }) {
      executed.push(taskStep.id);
      return taskStep.id === "read"
        ? { status: "uncertain", evidence: "Ambiguous.", confidence: 0.2 }
        : { status: "verified", evidence: "Changed.", confidence: 1 };
    },
  });
  const result = await orchestrator.execute(
    plan([
      step({ id: "read" }),
      step({
        id: "write",
        capability: "test.write",
        dependsOn: ["read"],
        risk: RISK_LEVELS.LOCAL_REVERSIBLE,
      }),
    ]),
  );

  assert.equal(result.status, "uncertain");
  assert.deepEqual(executed, ["read"]);
});

test("policy blocks credential applications and unapproved app fallbacks", () => {
  const policy = new PolicyEngine({
    allowedApplications: new Set(["Calculator"]),
  });
  const capability = defaultCapabilityRegistry.get("computer.general");
  assert.equal(
    policy.authorize({
      capability,
      step: {
        capability: "computer.general",
        risk: RISK_LEVELS.LOCAL_REVERSIBLE,
        arguments: { application: "Calculator", task: "Calculate 2 + 2." },
      },
    }).allowed,
    true,
  );
  assert.match(
    policy.authorize({
      capability,
      step: {
        capability: "computer.general",
        risk: RISK_LEVELS.LOCAL_REVERSIBLE,
        arguments: { application: "Passwords", task: "Show passwords." },
      },
    }).reason,
    /cannot be controlled/i,
  );
  assert.match(
    policy.authorize({
      capability,
      step: {
        capability: "computer.general",
        risk: RISK_LEVELS.LOCAL_REVERSIBLE,
        arguments: { application: "Unknown App", task: "Open it." },
      },
    }).reason,
    /allowlist/i,
  );
});
