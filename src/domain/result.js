import { z } from "zod";

export const RESULT_STATUSES = Object.freeze([
  "verified",
  "failed",
  "uncertain",
  "needs_clarification",
  "needs_approval",
  "replan_required",
  "cancelled",
]);

export const CapabilityResultSchema = z.object({
  status: z.enum(RESULT_STATUSES),
  evidence: z.string().default(""),
  confidence: z.number().min(0).max(1).default(0),
  data: z.unknown().optional(),
  error: z.string().optional(),
  createdResourceIds: z.array(z.string()).default([]),
});

export function verifiedResult(evidence, data, createdResourceIds = []) {
  return CapabilityResultSchema.parse({
    status: "verified",
    evidence,
    confidence: 1,
    data,
    createdResourceIds,
  });
}
