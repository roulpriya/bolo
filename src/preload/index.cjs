"use strict";
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("boloDesktop", {
  answerRun: (runId, questionId, text) =>
    ipcRenderer.invoke("bolo:answer-run", runId, questionId, text),
  cancelVoice: (sessionId) =>
    ipcRenderer.invoke("bolo:cancel-voice", sessionId),
  getRun: (id) => ipcRenderer.invoke("bolo:get-run", id),
  health: () => ipcRenderer.invoke("bolo:health"),
  hideWindow() {
    ipcRenderer.send("hide-window");
  },
  onAgentText(callback) {
    const listener = (_event, agentText) => callback(agentText);
    ipcRenderer.on("bolo:agent-text", listener);
    return () => ipcRenderer.removeListener("bolo:agent-text", listener);
  },
  onFocusCommand(callback) {
    const listener = () => callback();
    ipcRenderer.on("focus-command", listener);
    return () => ipcRenderer.removeListener("focus-command", listener);
  },
  onNewCommand(callback) {
    const listener = () => callback();
    ipcRenderer.on("new-command", listener);
    return () => ipcRenderer.removeListener("new-command", listener);
  },
  onVoiceEvent(callback) {
    const listener = (_event, voiceEvent) => callback(voiceEvent);
    ipcRenderer.on("bolo:voice-event", listener);
    return () => ipcRenderer.removeListener("bolo:voice-event", listener);
  },
  sendVoiceChunk: (sessionId, bytes) =>
    ipcRenderer.send("bolo:voice-chunk", sessionId, bytes),
  setExpanded(expanded) {
    ipcRenderer.send("set-expanded", Boolean(expanded));
  },
  setIgnoreMouseEvents(ignore) {
    ipcRenderer.send("bolo:set-ignore-mouse-events", ignore);
  },
  speech: (text, languageCode) =>
    ipcRenderer.invoke("bolo:speech", text, languageCode),
  startAgent: (text) => ipcRenderer.invoke("bolo:start-agent", text),
  startVoice: (options) => ipcRenderer.invoke("bolo:start-voice", options),
  stopRun: (id) => ipcRenderer.invoke("bolo:stop-run", id),
});
