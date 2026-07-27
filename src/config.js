import dotenv from "dotenv";

// Keep secrets local. `.env.local` takes precedence when both files exist.
dotenv.config({ path: ".env", quiet: true });
dotenv.config({ path: ".env.local", override: true, quiet: true });

function numberSetting(env, name, fallback, { min = 0, max = Infinity } = {}) {
  const raw = String(env[name] || "").trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be a number between ${min} and ${max}.`);
  }
  return value;
}

export function validateConfiguration(env = process.env) {
  return Object.freeze({
    port: numberSetting(env, "PORT", 4173, { min: 0, max: 65_535 }),
    browserUseTimeoutMs: numberSetting(
      env,
      "BROWSER_USE_TIMEOUT_MS",
      120_000,
      { min: 1_000, max: 15 * 60_000 },
    ),
    computerUseTimeoutMs: numberSetting(
      env,
      "COMPUTER_USE_TIMEOUT_MS",
      120_000,
      { min: 1_000, max: 15 * 60_000 },
    ),
    browserUseMaxCostUsd: numberSetting(
      env,
      "BROWSER_USE_MAX_COST_USD",
      1,
      { min: 0.01, max: 25 },
    ),
    sarvamConfigured: Boolean(env.SARVAM_API_KEY),
    openaiConfigured: Boolean(env.OPENAI_API_KEY),
    browserUseConfigured: Boolean(env.BROWSER_USE_API_KEY),
  });
}

export const configuration = validateConfiguration();
