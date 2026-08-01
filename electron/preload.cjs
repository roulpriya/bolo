const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("boloDesktop", {
  setExpanded(expanded) {
    ipcRenderer.send("set-expanded", Boolean(expanded));
  },
  hideWindow() {
    ipcRenderer.send("hide-window");
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
  health: () => ipcRenderer.invoke("bolo:health"),
  startVoice: (options) => ipcRenderer.invoke("bolo:start-voice", options),
  sendVoiceChunk: (sessionId, bytes) =>
    ipcRenderer.send("bolo:voice-chunk", sessionId, bytes),
  cancelVoice: (sessionId) =>
    ipcRenderer.invoke("bolo:cancel-voice", sessionId),
  onVoiceEvent(callback) {
    const listener = (_event, voiceEvent) => callback(voiceEvent);
    ipcRenderer.on("bolo:voice-event", listener);
    return () => ipcRenderer.removeListener("bolo:voice-event", listener);
  },
  startAgent: (text) => ipcRenderer.invoke("bolo:start-agent", text),
  answerRun: (runId, questionId, text) =>
    ipcRenderer.invoke("bolo:answer-run", runId, questionId, text),
  getRun: (id) => ipcRenderer.invoke("bolo:get-run", id),
  stopRun: (id) => ipcRenderer.invoke("bolo:stop-run", id),
  speech: (text, languageCode) =>
    ipcRenderer.invoke("bolo:speech", text, languageCode),
});
