export const RISK_LEVELS = Object.freeze({
  READ_ONLY: "read_only",
  LOCAL_REVERSIBLE: "local_reversible",
  EXTERNAL_SIDE_EFFECT: "external_side_effect",
  DESTRUCTIVE: "destructive",
});

export const APPROVAL_MODES = Object.freeze({
  PLAN: "plan",
  JUST_IN_TIME: "just_in_time",
  UNSUPPORTED: "unsupported",
});

export function approvalModeForRisk(risk) {
  switch (risk) {
    case RISK_LEVELS.READ_ONLY:
    case RISK_LEVELS.LOCAL_REVERSIBLE:
      return APPROVAL_MODES.PLAN;
    case RISK_LEVELS.EXTERNAL_SIDE_EFFECT:
      return APPROVAL_MODES.JUST_IN_TIME;
    case RISK_LEVELS.DESTRUCTIVE:
      return APPROVAL_MODES.UNSUPPORTED;
    default:
      throw new Error(`Unknown capability risk: ${risk}`);
  }
}
