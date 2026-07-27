import crypto from "node:crypto";
import { planHash } from "../domain/task-plan.js";

export class ApprovalService {
  constructor({ secret = crypto.randomBytes(32) } = {}) {
    this.secret = Buffer.isBuffer(secret) ? secret : Buffer.from(secret);
    this.consumed = new Set();
  }

  issue(plan) {
    const nonce = crypto.randomBytes(16).toString("base64url");
    const hash = planHash(plan);
    const signature = this.sign(`${hash}.${nonce}`);
    return `${nonce}.${signature}`;
  }

  verify(plan, token, { consume = false } = {}) {
    if (!token || this.consumed.has(token)) return false;
    const [nonce, suppliedSignature, extra] = String(token).split(".");
    if (!nonce || !suppliedSignature || extra) return false;
    const expectedSignature = this.sign(`${planHash(plan)}.${nonce}`);
    const supplied = Buffer.from(suppliedSignature);
    const expected = Buffer.from(expectedSignature);
    const valid =
      supplied.length === expected.length &&
      crypto.timingSafeEqual(supplied, expected);
    if (valid && consume) {
      this.consumed.add(token);
      if (this.consumed.size > 1_000) {
        this.consumed.delete(this.consumed.values().next().value);
      }
    }
    return valid;
  }

  sign(value) {
    return crypto
      .createHmac("sha256", this.secret)
      .update(value)
      .digest("base64url");
  }
}
