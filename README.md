# Bolo

Bolo is an Electron voice execution agent for Hindi, Hinglish, English, and
other Sarvam-supported Indian languages. Tap the microphone, speak naturally,
and pause: Sarvam translates the turn to English, records the detected source
language, and Bolo immediately starts working. Follow-up questions and final
responses are translated and spoken in that same language.

The agent can ask spoken follow-up questions, run local shell commands, search
the web, operate a dedicated local browser, and use macOS Computer Use as a
fallback for desktop-only work.

## Setup

Requirements:

- macOS 14 or newer
- Node.js 20 or newer
- OpenAI and Sarvam API keys
- macOS Microphone permission
- macOS Accessibility permission for Computer Use

```bash
cd /Users/priyaroul/Documents/bolo_hackathon
npm install
cp .env.example .env.local
npm run browser:setup
npm run local-agent:setup
```

Set `SARVAM_API_KEY` and `OPENAI_API_KEY` in `.env.local`. To enable Computer
Use, run:

```bash
npm run local-agent:permissions
```

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
credentials directly into the browser or desktop app—never give credential
values to the agent.

## Architecture

The renderer has no Node access and communicates only through a validated
preload IPC bridge. `DesktopService` in the main process owns voice sessions,
agent runs, tools, secrets, cancellation, and sanitized history. There is no
local HTTP server.

See [ARCHITECTURE.md](ARCHITECTURE.md) and [SECURITY.md](SECURITY.md).
