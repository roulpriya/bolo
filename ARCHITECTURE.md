# Bolo architecture

Bolo is an Electron voice execution agent. The main process owns conversation
state and execution. The sandboxed renderer sends validated commands through a
narrow CommonJS preload bridge and renders public thread snapshots.

## Vocabulary

- **Thread**: a durable conversation with metadata, a revision, ordered turns,
  and private model context. A thread survives window reloads and app restarts.
- **Turn**: one submitted request and its execution. It owns the input modality,
  language, messages, questions, tool activity, streamed text, and outcome.
  A clarification answer continues that turn; a subsequent request starts a new
  turn after conversation routing. Individual model calls are steps within a turn.
- **ThreadSession**: live runtime state for a thread. It owns the active
  `TurnExecution`, pending answer resolver, execution promise, and model-history
  adapter. Runtime handles never enter storage or IPC. Idle sessions can be
  rebuilt from the repository; switching execution to another thread evicts them.
- **VoiceSession**: one microphone capture and transcription operation, bound to
  a thread for a command or to a thread, turn, and question for an answer.
- **ModelHistorySession**: the internal Agents SDK `Session` adapter. It reads
  and writes provider context through the thread repository. It is distinct
  from a live thread session and from the visible transcript.

## Ownership and source layout

```text
Renderer: selected thread + draft + microphone/playback presentation
    ↕ fixed, validated preload capabilities
DesktopService: Electron facade, settings/MCP integration, voice routing
    ├─ ThreadService → ThreadRepository
    ├─ InputService → JevRouting → continue / new / user choice
    ├─ TurnCoordinator → SessionManager → AgentService
    └─ VoiceService + SpeechService
```

- `src/shared/threads.ts` defines public thread, turn, message, and activity
  schemas and their TypeScript types. `src/shared/ipc.ts` defines command
  channels and Zod argument schemas. `src/shared/sessions.ts` defines voice events.
- `src/main/services/thread-service.ts` handles thread creation, retrieval, and
  restoration. `turn-coordinator.ts` owns execution transitions and cancellation.
- `src/main/state/` contains persistence, legacy migration, SDK context storage,
  and ephemeral session management.
- `src/main/agent/` contains the model executor and tools. `TurnExecution` adds
  cancellation and change notification to the public turn fields; `turnSchema`
  strips those runtime fields from every public/persisted snapshot.
- `src/renderer/app/use-thread.ts` handles snapshots and selection commands;
  `use-voice.ts` owns microphone resources; `use-speech.ts` owns playback.
  The main process holds the selected thread ID only for the current app launch.
  Local storage is read for legacy transcript migration, not thread selection.
- MCP transports and the managed browser profile remain application-scoped.
  Browser and native desktop specialists retain their own temporary model context.

MCP connections are lazy. Each turn starts with built-in tools and, when servers
are enabled, a `load_mcp_tools` tool containing only their local IDs and names.
Invoking it connects the requested server and adds its tools to that turn's agent
for the next model step. Ordinary requests never connect to MCP or list remote
tools. Healthy transports are reused across turns; disabled or changed settings
close obsolete transports without connecting unrelated servers. Tool-load failures
are returned to the agent, and cancelled turns cannot install or invoke late tools.

Main/shared TypeScript runs directly from source using Node type stripping and
explicit `.ts` imports. The existing `.cts` preload is bundled as CommonJS into
`dist/renderer/preload/index.cjs`. Vite builds the app and settings pages under
`dist/renderer`; no main, shared, or test JavaScript is emitted. `npm run check`
checks all TypeScript projects, including the renderer. Styles remain static
CSS imports under the existing CSP. The Vite HTML transform preserves the static
stylesheet ID that prevents React Aria from injecting inline pressable styles.

## Commands and events

The bridge exposes `createThread`, `listThreads`, `getThread`, `restoreThread`, `selectThread`,
`startTurn`, `getTurn`, `answerQuestion`, `cancelTurn`, `startVoiceSession`, and
`cancelVoiceSession`, alongside settings, speech, window, and audio operations.
`submitInput` routes a new command; `getPendingInput`, `resolveInput`, and
`cancelInput` expose the pending conversation choice. `startTurn` is the explicit
thread-targeted path; the composer and voice commands use `submitInput` instead.
Main-process IPC handlers validate the sender and command payload. Turn and
question operations verify ownership; voice commands and answers have distinct
schemas, so incomplete answer targets are rejected.

`restoreThread` returns the current launch's selection, creating a blank thread
when none exists. `createThread` creates and selects a separate thread;
`selectThread` explicitly selects saved history. `getThread` only reads a snapshot.
Initialization and selection commands are serialized to prevent duplicate startup
threads and preserve command order. Legacy imports remain in history without
automatically selecting them. A full app relaunch opens a blank thread with empty
model context; hiding/showing or reloading the window preserves the current thread.

`thread.updated` events carry `threadId`, `turnId`, a monotonic per-thread
`revision`, and a complete public snapshot. Streaming checkpoints are coalesced
at 50 ms; questions publish immediately. Terminal events publish after execution
cleanup releases the application slot. Thread summaries distinguish working,
waiting for an answer, and finishing cleanup; a new revision on release prevents
an earlier listing from making a finished request appear busy again. The renderer
ignores older, duplicate, and mismatched events and fetches a snapshot on
restoration, selection, focus, and after commands. It does not poll active turns.
Complete snapshots let a later event recover from a missed intermediate event.

## Execution and voice lifecycle

```text
Typed input ─────────────┐
Finalized voice input ───┴─> Jev routing → startTurn(selected or new thread)
                              running ↔ waiting_for_user
                                  ↓
                         completed | failed | cancelled
```

`InputService` reserves a single pending input before awaiting Jev. Blank chats
skip detection. Existing chats send their last four public turns (up to eight
messages per turn, 1,500 characters per text field) and the new input to TypeSafe's
Choice endpoint. An option probability of at least 0.85 routes automatically;
an ambiguous choice, missing key, invalid response, or five-second timeout asks
the user. No turn or model context is written while waiting for this choice.
Captured text and voice language remain in main-process memory and resolutions
use a one-use request ID. Input events update the renderer, including the actual
thread selected after a new-topic decision. Pending choices survive a window
reload during the same app launch, but are not persisted across app restarts.
Cancellation, navigation, and shutdown abort detection and discard late results.
Answers to pending agent questions bypass Jev and retain their explicit targets.

A turn reserves the application execution slot before awaiting persistence.
The initial turn is saved before the agent starts. A question is recorded and
localized before Bolo waits for its answer. The answer is stored in the same
turn and resolves the pending tool call. Final responses are localized and
stored as part of that turn's transcript.

The renderer captures mono 16 kHz PCM using an AudioWorklet. `VoiceService`
streams chunks to Sarvam for English translation, detected language, and VAD.
Only a finalized command creates a turn. Cancelling capture rejects late
translations; duplicate translations are ignored. Typed answers can replace
microphone capture for the same pending question.

Bolo allows one executing/stopping turn and one microphone capture across the
application. Cancellation closes pending questions, aborts tools, and prevents
late deltas or completion from changing the result. The execution slot stays
reserved until tool cleanup and model-history writes settle. Hiding the window
preserves execution. New conversation and opening saved history preserve work
already running elsewhere, while stopping microphone capture and playback.
The composer permits drafting in another thread but disables submission and voice
capture until the existing request ends. There is no queue. A background indicator
shows Working or Needs your answer, with Open conversation and Stop controls.
Questions hold the single execution slot until answered or cancelled; background
questions never take over the selected thread or start its microphone.

## Storage, migration, and recovery

Each `threads/<uuid>.json` under Electron's user-data directory contains a
versioned public thread, private provider context, and migration markers. Writes
are serialized through temporary files and atomic rename, with mode `0600`.
Provider context is never returned by thread APIs. Unlike tool activity summaries,
provider context can contain full input and tool output and is private local data.

On first use, old `conversations/<uuid>.json` files retain their known identity.
Legacy `runs.json` entries become separate recovered threads because they lack a
reliable conversation link. The old renderer transcript is imported once when
available, preserving its displayed language. Migration leaves all source files
and the old local-storage snapshot intact. Migration markers prevent duplicates.

On restart, unfinished turns become failed with a restart reason. Pending
questions are cleared and open tool calls become failed. Execution is never
restarted automatically. Existing provider context is retained. Electron's
`before-quit` handler waits for cancellation, context/history flushing, and
resource cleanup before allowing the process to quit.

## Validation

The unit suite covers thread ownership, typed/voice continuity, persistent model
context with a mocked SDK model, stale answers, cancellation races, ordered
snapshots, migration, and restart recovery. `npm run check`, `npm test`, and
`npm run build` validate the source and bundle. Provider/browser specialist
integration scripts remain opt-in because they use real services.
