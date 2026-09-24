# Security

## Trust boundaries

- The renderer runs with `sandbox: true`, `contextIsolation: true`, and no Node
  integration.
- The preload exposes only fixed Bolo operations. Every main-process IPC
  handler verifies the authorized renderer and validates the command payload.
  Turn and question operations also verify their owning thread.
- Sarvam, OpenAI, Anthropic, and TypeSafe API keys remain in the main process. Raw microphone audio
  is forwarded only to Sarvam and is not persisted.
- Conversation routing sends the new text and bounded recent public conversation
  messages to TypeSafe's Jev API. It excludes private model context, tool activity,
  screenshots, and raw audio. Invalid or unavailable decisions require a manual
  conversation choice before execution. Routing alone never authorizes a tool action.
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

Versioned thread records and the managed browser profile live under Electron's
user-data directory. Thread files include visible transcripts, sanitized tool
activity, and private provider context that may contain full input/tool output.
Provider context stays in the main process and is never exposed through thread
IPC. Runtime controllers, pending callbacks, and raw microphone audio are not
persisted. Thread files use mode `0600`; thread selection lives only in main-process
memory for the current app launch. Relaunching opens a blank thread while keeping
older history available for explicit selection. Legacy files remain intact after migration. Stop and application
shutdown abort active tools and wait for context/history writes to settle.

Desktop computer use controls the main host display with the user's macOS
Accessibility and Screen Recording permissions. Screenshots go to the chosen
OpenAI or Anthropic API. They are not written to disk or tool history.
Actions validate their coordinates against the screenshot and reject a changed
display before input. Consequential actions are governed by the specialist's
confirmation instructions; OpenAI provider safety checks also require an
explicit answer before execution. The desktop helper is not an isolated VM.
