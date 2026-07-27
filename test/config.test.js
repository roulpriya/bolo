import assert from "node:assert/strict";
import test from "node:test";
import { validateConfiguration } from "../src/config.js";

test("configuration validates numeric safety limits", () => {
  assert.equal(
    validateConfiguration({ BROWSER_USE_TIMEOUT_MS: "5000" })
      .browserUseTimeoutMs,
    5_000,
  );
  assert.throws(
    () => validateConfiguration({ BROWSER_USE_MAX_COST_USD: "unlimited" }),
    /BROWSER_USE_MAX_COST_USD/,
  );
  assert.throws(
    () => validateConfiguration({ COMPUTER_USE_TIMEOUT_MS: "10" }),
    /COMPUTER_USE_TIMEOUT_MS/,
  );
});
