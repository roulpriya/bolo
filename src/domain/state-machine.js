const RUN_TRANSITIONS = Object.freeze({
  pending: new Set(["executing", "cancelled"]),
  executing: new Set([
    "awaiting_approval",
    "awaiting_clarification",
    "completed",
    "failed",
    "cancelled",
  ]),
  awaiting_approval: new Set(["executing", "cancelled"]),
  awaiting_clarification: new Set(["executing", "cancelled"]),
  completed: new Set(),
  failed: new Set(),
  cancelled: new Set(),
});

export function transitionRun(run, nextState) {
  const current = run.state;
  if (!RUN_TRANSITIONS[current]?.has(nextState)) {
    throw new Error(`Invalid run transition: ${current} -> ${nextState}`);
  }
  run.state = nextState;
  run.updatedAt = Date.now();
  if (["completed", "failed", "cancelled"].includes(nextState)) {
    run.finishedAt = run.updatedAt;
  }
  return run;
}

export function isTerminalRunState(state) {
  return ["completed", "failed", "cancelled"].includes(state);
}
