# Bolo architecture

Bolo separates planning, approval, orchestration, capabilities, execution, and
verification. A planning model never receives an execution tool.

## Request lifecycle

1. Sarvam or the text composer supplies a transcript.
2. The planning agent returns a versioned plan containing one or more steps.
3. The plan compiler validates capability arguments, dependencies, risk, and
   success criteria.
4. The server issues a single-use approval token bound to the plan hash.
5. The deterministic orchestrator schedules approved steps.
6. Each worker receives a new scoped session and only its step.
7. Apple Events use structured JSON through one fixed JXA program. Browser and
   Computer Use workers inspect their final state.
8. A dependent step runs only after every prerequisite is verified.

Read-only sibling steps may run concurrently. Mutations are serialized.
Explicit `$steps.<id>.data.<field>` references carry verified structured output
between dependent steps.

## Capability routing

The capability registry is the source of truth for argument schemas, executor,
risk, approval mode, latency target, timeout policy, and verification method.
Routing order is:

1. deterministic local action;
2. structured Apple Events;
3. Browser Use for web interfaces;
4. scoped Computer Use for allowlisted Mac applications.

Computer Use is a fallback, not a universal default. Passwords, Keychain
Access, financial actions, credential entry, destructive actions, and unknown
applications are blocked.

Common commands are compiled before the planning-model fallback. Website opens,
web searches, YouTube opens and song lookup, application launches, and
supported Apple Events therefore avoid agent startup latency. Navigation plus
search requests are collapsed into one URL operation. Agentic workers are
reserved for tasks that must inspect changing UI.

## Current capability boundary

- Create and verify Apple Notes shopping lists.
- Create and verify Apple Reminders.
- Create and verify Apple Calendar events.
- Search Reminders, Notes, and Contacts without mutation.
- Control Apple Music playback.
- Reveal existing non-sensitive files under the user home directory in Finder.
- Open allowlisted applications.
- Open YouTube, web searches, and pre-filled Google Calendar forms.
- Resolve YouTube videos and perform approved general browser tasks.
- Perform approved tasks in allowlisted local apps with Computer Use fallback.

Deletion, purchases, credential handling, and unattended external
communication are not supported.

## State and persistence

Run summaries and step results are written atomically to `.bolo/runs.json`.
Controllers, secrets, screenshots, and internal stop reasons are excluded.
Runs interrupted by a restart are restored as failed rather than resumed
silently. Screenshots remain temporary and are removed by the Computer Use
worker.
