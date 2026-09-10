# Security

## Trust boundaries

- The renderer runs with `sandbox: true`, `contextIsolation: true`, and no Node
  integration.
- The preload exposes only fixed Bolo operations. Every main-process IPC
  handler verifies that the sender is Bolo's main renderer and validates the
  payload again in `DesktopService`.
- Sarvam, OpenAI, and Anthropic API keys remain in the main process. Raw microphone audio
  is forwarded only to Sarvam and is not persisted.
- The local browser has a dedicated Bolo profile. Web content is untrusted and
  cannot directly invoke shell or desktop tools.

## Execution policy

Routine work executes immediately. The shell rejects catastrophic disk
operations, credential-store extraction, and commands that disable platform
security. Privilege escalation, deletion, installations, uploads, messages,
purchases, form submissions, and similar consequential actions require
just-in-time confirmation.

Credentials must be entered by the user directly into the visible application.
Bolo must never request a password, API key, OTP, or other secret through
speech, text, or a tool result.

## Local data

Sanitized run summaries and the managed browser profile live under Electron's
user-data directory. Stop and application shutdown abort all active tools.

Desktop computer use controls the main host display with the user's macOS
Accessibility and Screen Recording permissions. Screenshots go to the chosen
OpenAI or Anthropic API. They are not written to disk or tool history.
Actions validate their coordinates against the screenshot and reject a changed
display before input. Consequential actions are governed by the specialist's
confirmation instructions; OpenAI provider safety checks also require an
explicit answer before execution. The desktop helper is not an isolated VM.
