# Bolo architecture

Bolo is an Electron-only voice execution agent. The renderer is sandboxed and
has no Node.js access. A narrow preload bridge connects it to `DesktopService`
in the Electron main process; there is no local HTTP server.

## Code boundaries

- `src/main/index.ts` owns application lifecycle; `src/preload/` contains the
  intentionally minimal preload bridge.
- `src/main/` contains Node/Electron-only code, organized by responsibility:
  `agent/` for execution tools, `services/` for application integrations,
  `platform/` for macOS access, `state/` for persisted run history, and
  `intents/` for request classification.
- `src/shared/ipc.ts` is the authoritative list of IPC channels and their
  Zod-validated renderer-to-main argument schemas.
- `src/renderer/` is renderer-only React, CSS, and AudioWorklet code. It has no
  Node.js imports.

The main process validates both the sending `WebContents` and every invoke or
send payload before it reaches `DesktopService`. The preload intentionally
exposes capability methods rather than `ipcRenderer` itself.

Electron 43's embedded Node runtime strips TypeScript syntax natively, so the
main process and shared modules run directly from `src/`. The sandboxed preload
remains CommonJS because Electron's sandbox preload environment requires it.
Vite is therefore responsible only for the renderer bundle in `dist/renderer`;
Vitest executes the TypeScript unit suite directly.

## Voice lifecycle

1. The renderer captures microphone samples with an `AudioWorklet`, converts
   them to mono 16 kHz signed PCM, and batches 100 ms chunks.
2. Validated IPC forwards those chunks to the main process.
3. `VoiceService` owns the authenticated Sarvam WebSocket and requests Saaras
   v3 English translation, source-language detection, and VAD signals.
4. Sarvam's finalized English translation and detected BCP-47 language code
   create an agent run immediately.
5. Questions from `ask_user_question` pause that same run. `DesktopService`
   translates each question back to the run's source language before the
   renderer speaks it, records a voice or typed answer, and resolves the
   pending tool call. The final result follows the same localization path.

Only one microphone session and one non-terminal agent run may exist at once.
Late, duplicate, mismatched, and oversized messages are rejected.

## Agent and tools

The primary OpenAI agent owns Pi-style workspace tools plus its execution tools:

1. `ask_user_question` for missing information and just-in-time consent.
2. `read`, `write`, and exact-match `edit` for workspace text files.
3. `bash` for local processes, scripts, tests, and commands.
4. Hosted web search for current information.
5. A visible Playwright browser specialist for websites and web applications.
6. A separate native macOS computer specialist with direct OpenAI Responses or
   Claude Messages API loops.

File tools accept workspace-relative or workspace-contained absolute paths.
They refuse paths outside the workspace, symlink escapes, and credential files.
Reads are bounded and line-numbered; edits require exactly one exact match.

The browser uses a persistent profile stored beneath Electron's user-data
directory. The desktop specialist does not change that browser path.
`computer-actions.ts` validates and normalizes provider actions;
`desktop-computer.ts` executes them through `platform/desktop-control.ts` and
the Swift ScreenCaptureKit/CoreGraphics helper. OpenAI uses ordered
`computer_call.actions` and screenshot outputs linked by call ID. Claude uses
`computer_toolset_20260801` and answers each toolset member in sequence, marking
the remainder of a failed batch as skipped. Both preserve their conversation,
return fresh screenshots, honor cancellation, and release held keys/buttons.
Desktop screenshots stay in memory and are not included in run history.

## State and shutdown

`DesktopService` owns run state, cancellation controllers, pending questions,
voice sessions, and sanitized history. Public run states are `running`,
`waiting_for_user`, `completed`, `failed`, and `cancelled`. Secrets,
controllers, raw audio, and pending promise callbacks are never
persisted.

On shutdown, Bolo closes voice and browser sessions, aborts active work,
rejects pending questions, and flushes run summaries.
