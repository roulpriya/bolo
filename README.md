# Bolo

Bolo is a compact Electron command palette for a Hindi, Hinglish, and English
planning and orchestration agent. It records a typed or spoken request, asks
for missing details, shows an exact single-step or multi-step plan, and runs
scoped capability workers only after approval.

- Handle ad-hoc web searches and general browser tasks.
- Open installed macOS applications and handle general app tasks.
- Open YouTube in a web browser.
- Create an event or invite in Google Calendar.
- Open Apple Notes and create a shopping list.
- Create a dated reminder in Apple Reminders.
- Create an event or invitation directly in Apple Calendar.

Optimized actions use a small local allowlisted executor:

- Simple web searches open in the signed-in default browser.
- Simple application-open commands use direct Apple Events.
- YouTube opens directly in the Mac's default browser.
- Google Calendar opens a pre-filled event in the signed-in default browser.
- Shopping lists are created directly in Apple Notes with AppleScript.
- Reminders are created directly in Apple Reminders with Apple Events.
- Apple Calendar events and attendees are created with Apple Events.
- Reminders, Notes, and Contacts can be searched through read-only Apple Events.
- Apple Music playback can be controlled through Apple Events.

Bolo shows the exact plan and always asks for confirmation before execution.
Approvals are single-use and cryptographically bound to the exact plan. The
orchestrator runs independent read-only steps concurrently, serializes
mutations, and does not run dependent steps until their inputs are verified.
Opening the YouTube home page, Google Calendar form, Apple Notes list, and
creating an Apple Reminder are local actions. A request for a particular
YouTube video uses the OpenAI planning agent plus a Browser Use resolver
subagent, then opens the resolved watch URL in the Mac's default browser.
Sarvam is used only for microphone transcription.

## Setup

Requirements:

- macOS 14 or newer
- Node.js 20 or newer
- macOS with a default browser
- Automation access for Apple Notes and Reminders when prompted
- A Sarvam API key only when microphone transcription is needed
- OpenAI and Browser Use API keys for agent-assisted YouTube video lookup

```bash
cd /Users/priyaroul/Documents/bolo_hackathon
npm install
cp .env.example .env
npm run local-agent:setup
```

For microphone transcription, add this to `.env`:

```bash
SARVAM_API_KEY=your_sarvam_key
OPENAI_API_KEY=your_openai_key
BROWSER_USE_API_KEY=your_browser_use_key
APPLE_CALENDAR_NAME=Calendar
PORT=4173
```

Grant the browser Microphone permission for voice input. The first Apple Notes
or Reminders action may also show the normal macOS Automation permission prompt.

## Run the Electron app

```bash
npm start
```

Use **Command–Shift–Space** to show or hide Bolo from anywhere. Press Enter to
submit a request, or use the microphone button to record one. Tasks started
with the microphone also speak Bolo's clarifications, plan, errors, and final
result through Sarvam Text-to-Speech. Typed tasks remain text-only.

For browser-only development, run `npm run server` and open
[http://127.0.0.1:4173](http://127.0.0.1:4173).

## Execution boundaries

- Every task requires user confirmation.
- Each approval is single-use to prevent retries from duplicating side effects.
- Only registered, schema-validated capabilities run locally.
- Google Calendar opens a pre-filled event and leaves the final Save action to
  the user.
- The Stop button aborts the active worker.
- Passwords, Keychain Access, financial browser actions, destructive actions,
  and applications outside the configured allowlist are blocked.
- The local HTTP service accepts only loopback, same-origin browser requests.
- Computer-use screenshots are temporary and deleted at the end of each normal
  run; a crash can leave ignored files in `artifacts/`.

See [SECURITY.md](SECURITY.md) for vulnerability reporting and data-handling
boundaries.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the plan schema, worker boundaries,
capability routing, persistence model, and current support boundary.

## Tests

```bash
npm test
```

Automated tests do not perform external browser or computer actions.

## Apple Events command-line tool

`bolo-mac` controls Reminders, Notes, and Calendar directly through macOS
Apple Events. It does not use mouse coordinates, and all operations are
allowlisted. Run it from this project with `npm run mac --`, or install the
package command locally with `npm link`.

```bash
npm run mac -- open Reminders
npm run mac -- reminder add "Buy milk" --list Shopping \
  --due "2026-07-27T18:00:00+05:30"
npm run mac -- note shopping --title "Weekly shop" \
  --item milk --item bread --item eggs
npm run mac -- calendar list
npm run mac -- calendar create "Bolo demo" \
  --calendar Work --start "2026-07-28T11:00:00+05:30" --duration 30 \
  --invite teammate@example.com
```

Add `--open` to reveal the affected app, `--json` for machine-readable output,
or `--dry-run` to validate and inspect an action without sending an Apple
Event. Calendar names must be unambiguous; `calendar list` prints selectors
that can be passed to `--calendar` when names repeat—for example, `Family#2`.
Run `npm run mac -- --help` for every option.

Bolo uses the Apple calendar named `Calendar` by default. Set
`APPLE_CALENDAR_NAME` to another existing calendar if preferred. Calendar
requests without a title receive sequential titles such as `Event 1`,
`Event 2`, and so on.

On first use, macOS may ask whether Terminal (or the parent app running Bolo)
can control Reminders, Notes, or Calendar. Approve the request in **System
Settings → Privacy & Security → Automation**. Creating an event with invitees
can cause Calendar to send invitations according to the selected calendar
account's normal behavior.
