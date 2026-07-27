# Security

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability. Use GitHub's
private vulnerability reporting or Security Advisories feature for this
repository and include reproduction steps, impact, and the affected version.

## Security boundaries

- Bolo listens only on `127.0.0.1` and rejects cross-origin browser requests.
- Every executable task requires an explicit, single-use approval bound to the
  cryptographic hash of the exact plan version.
- Local Apple Events and URLs are constrained to the actions and destinations
  implemented in the source.
- Electron runs the renderer with context isolation, sandboxing, no Node.js
  integration, a restrictive Content Security Policy, and blocked navigation.
- Computer-use screenshots are temporary and are deleted after each normal run.
  A process crash can leave files in the ignored `artifacts/` directory, which
  should be cleared before sharing a development machine or workspace archive.
- Computer Use is restricted to an application allowlist. Passwords, Keychain
  Access, destructive actions, credential entry, and financial browser actions
  are denied by policy.
- Run summaries are written to `.bolo/runs.json`; secrets, screenshots,
  controllers, and internal stop reasons are excluded.

## Sensitive data

Never commit `.env`, `.env.local`, API keys, browser profile identifiers, the
generated `bin/` helper, or `artifacts/`. These paths are excluded by
`.gitignore`. Rotate a credential immediately if it is ever committed, even if
the commit is later rewritten.

Bolo sends task text to OpenAI when local planning is insufficient, browser
tasks to Browser Use, and microphone audio or speech text to Sarvam when those
features are used. Review those providers' data handling terms before using
Bolo with sensitive information.
