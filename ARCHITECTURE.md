# Bolo architecture

Bolo is an Electron-only voice execution agent. The renderer is sandboxed and
has no Node.js access. A narrow preload bridge connects it to `DesktopService`
in the Electron main process; there is no local HTTP server.

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

The primary OpenAI agent owns five tools:

1. `ask_user_question` for missing information and just-in-time consent.
2. Local shell for files, processes, scripts, and commands.
3. Hosted web search for current information.
4. A visible Playwright browser specialist for websites and web applications.
5. Scoped Computer Use for desktop-only work, an explicit user request, or a
   recorded specialized-tool failure.

The browser uses a persistent profile stored beneath Electron's user-data
directory. Computer Use retains screenshot cleanup, action bounds, repetition
protection, and macOS Accessibility checks.

## State and shutdown

`DesktopService` owns run state, cancellation controllers, pending questions,
voice sessions, and sanitized history. Public run states are `running`,
`waiting_for_user`, `completed`, `failed`, and `cancelled`. Secrets,
controllers, raw audio, screenshots, and pending promise callbacks are never
persisted.

On shutdown, Bolo closes voice and browser sessions, aborts active work,
rejects pending questions, removes temporary screenshots, and flushes run
summaries.
