# Bolo

Bolo is an Electron voice execution agent for Hindi, Hinglish, English, and
other Sarvam-supported Indian languages. Tap the microphone, speak naturally,
and pause: Sarvam translates the turn to English, records the detected source
language, and Bolo immediately starts working. Follow-up questions and final
responses are translated and spoken in that same language.

The agent can ask spoken follow-up questions; read, write, and edit workspace
files; run local bash commands; search the web; operate a dedicated local
browser; control visible macOS desktop applications; and create macOS reminders.

## Setup

Requirements:

- macOS 14 or newer
- Node.js 20 or newer
- OpenAI and Sarvam API keys
- macOS Microphone permission

```bash
cd /Users/priyaroul/Documents/bolo_hackathon
npm install
cp .env.example .env.local
npm run browser:setup
```

Set `SARVAM_API_KEY` and `OPENAI_API_KEY` in `.env.local`.
Set `TYPESAFE_API_KEY` to enable Jev conversation detection. `JEV_MODEL` defaults
to `jev-latest`. Without a TypeSafe key, Bolo asks you to choose the conversation
for requests after the first turn.

## Run

```bash
npm run check
npm test
npm start
```

Use Command–Shift–Space to show or hide Bolo. Typed tasks use the same direct
agent path. When the agent asks a question, Bolo speaks it and automatically
listens for an answer; typing remains available.

New typed requests and finalized voice transcripts use the same Jev check:
clear follow-ups continue the selected chat, and clearly independent tasks open
a new conversation in the same window. An uncertain result, timeout, or unavailable
Jev service shows **Continue this chat**, **Start new chat**, and **Cancel request**.
The captured request waits without executing until you choose. Answers to an
agent's pending question always stay with that question. New conversation remains
an explicit way to start with empty context.

Jev receives the new text and a bounded excerpt of the selected chat's last four
turns. The integration uses TypeSafe's [Choice API](https://docs.typesafe.ai/api).
Automatic routing starts at an option probability of 0.85; this is an initial
policy threshold, not a measured accuracy guarantee. Validate it with representative
English, Hindi, and Hinglish follow-ups before tuning it.

The managed Playwright browser is visible and stores its profile beneath
Electron's user-data directory. Sign in once when a website requires it. Enter
credentials directly into the browser—never give credential
values to the agent.

## Architecture

The renderer has no Node access and communicates only through a validated
preload IPC bridge. `DesktopService` connects the renderer to thread storage, turn coordination,
voice sessions, and application integrations. Threads persist ordered turns and
model context; runtime sessions manage active execution and cancellation. Use
Conversations to reopen a thread and New conversation to start another one.
Quitting and relaunching opens a blank conversation; hiding/showing or reloading
the window preserves the current one. A new conversation leaves existing work
running, with controls to open or stop it. You can draft while it runs, but Bolo
accepts only one unfinished request at a time and has no queue. There is no local
HTTP server.

Enabled MCP servers connect on demand when the agent loads an integration's tools,
rather than before every request. Existing healthy connections are reused.

See [ARCHITECTURE.md](ARCHITECTURE.md) and [SECURITY.md](SECURITY.md).

## Desktop computer use

`browser_use` continues to use the existing Playwright browser specialist.
The separate `computer_use` tool operates the main macOS display through native
mouse/keyboard events and screenshots. Build its helper once:

```bash
npm run computer:setup
npm run computer:permissions
```

Add the revealed **Bolo Desktop Control.app** to Accessibility and Screen
Recording in System Settings → Privacy & Security. Rebuilding the ad-hoc signed
helper may require removing and adding its permission entries again.

Set `COMPUTER_USE_PROVIDER=openai` (default) or `anthropic` in `.env.local`.
OpenAI desktop tasks use `OPENAI_API_KEY` and `OPENAI_DESKTOP_MODEL`
(default `gpt-5.6-sol`). Claude desktop tasks use `ANTHROPIC_API_KEY` and
`ANTHROPIC_COMPUTER_MODEL` (default `claude-opus-5`, which supports
`computer_toolset_20260801`). The primary agent still needs `OPENAI_API_KEY`.
`OPENAI_COMPUTER_MODEL` continues to configure the existing browser specialist.

Desktop screenshots are sent to the selected provider and kept only in memory
locally. Keep the target app on the main display. Stop cancels the loop and
releases held input. A task is bounded to 30 model turns and 200 actions; display
changes require a new screenshot before further input.

The provider loops follow the [OpenAI action-handler guide](https://developers.openai.com/api/docs/guides/tools-computer-use-integration#implement-action-handlers)
and [Claude computer-use guide](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool).
Run `npm test` for mocked provider round trips and native-driver contract tests.
