import dotenv from "dotenv";

dotenv.config({ path: ".env", quiet: true });
dotenv.config({ path: ".env.local", override: true, quiet: true });

export function configurationStatus(env = process.env) {
  return Object.freeze({
    sarvamConfigured: Boolean(env.SARVAM_API_KEY),
    openaiConfigured: Boolean(env.OPENAI_API_KEY),
  });
}
