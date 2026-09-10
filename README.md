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

## Run

```bash
npm run check
npm test
npm start
```

Use Command–Shift–Space to show or hide Bolo. Typed tasks use the same direct
agent path. When the agent asks a question, Bolo speaks it and automatically
listens for an answer; typing remains available.

The managed Playwright browser is visible and stores its profile beneath
Electron's user-data directory. Sign in once when a website requires it. Enter
credentials directly into the browser—never give credential
values to the agent.

## Architecture

The renderer has no Node access and communicates only through a validated
preload IPC bridge. `DesktopService` in the main process owns voice sessions,
agent runs, tools, secrets, cancellation, and sanitized history. There is no
local HTTP server.

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
