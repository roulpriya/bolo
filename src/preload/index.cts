import { contextBridge, ipcRenderer } from "electron";
import { IPC } from "../shared/ipc.ts";

const boloDesktop: Window["boloDesktop"] = {
  answerRun: (runId, questionId, text) =>
    ipcRenderer.invoke(IPC.answerRun, runId, questionId, text),
  cancelVoice: (sessionId) => ipcRenderer.invoke(IPC.cancelVoice, sessionId),
  getMcpServers: () => ipcRenderer.invoke(IPC.mcpServersGet),
  getRun: (id) => ipcRenderer.invoke(IPC.getRun, id),
  health: () => ipcRenderer.invoke(IPC.health),
  hideWindow() {
    ipcRenderer.send(IPC.hideWindow);
  },
  onAgentText(callback) {
    const listener = (_event: unknown, agentText: unknown) =>
      callback(agentText);
    ipcRenderer.on(IPC.agentText, listener);
    return () => ipcRenderer.removeListener(IPC.agentText, listener);
  },
  onFocusCommand(callback) {
    const listener = () => callback();
    ipcRenderer.on(IPC.focusCommand, listener);
    return () => ipcRenderer.removeListener(IPC.focusCommand, listener);
  },
  onMcpOAuthEvent(callback) {
    const listener = (
      _event: unknown,
      oauthEvent: Parameters<typeof callback>[0]
    ) => callback(oauthEvent);
    ipcRenderer.on(IPC.mcpOAuthEvent, listener);
    return () => ipcRenderer.removeListener(IPC.mcpOAuthEvent, listener);
  },
  onNewCommand(callback) {
    const listener = () => callback();
    ipcRenderer.on(IPC.newCommand, listener);
    return () => ipcRenderer.removeListener(IPC.newCommand, listener);
  },
  onVoiceEvent(callback) {
    const listener = (_event: unknown, voiceEvent: unknown) =>
      callback(voiceEvent);
    ipcRenderer.on(IPC.voiceEvent, listener);
    return () => ipcRenderer.removeListener(IPC.voiceEvent, listener);
  },
  openSettings: () => ipcRenderer.invoke(IPC.settingsOpen),
  saveMcpServers: (servers) => ipcRenderer.invoke(IPC.mcpServersSave, servers),
  sendVoiceChunk: (sessionId, bytes) =>
    ipcRenderer.send(IPC.voiceChunk, sessionId, bytes),
  setExpanded(expanded) {
    ipcRenderer.send(IPC.setExpanded, Boolean(expanded));
  },
  setIgnoreMouseEvents(ignore) {
    ipcRenderer.send(IPC.setIgnoreMouseEvents, ignore);
  },
  speech: (text, languageCode) =>
    ipcRenderer.invoke(IPC.speech, text, languageCode),
  startAgent: (text) => ipcRenderer.invoke(IPC.startAgent, text),
  startMcpOAuth: (id) => ipcRenderer.invoke(IPC.mcpOAuthStart, id),
  startVoice: (options) => ipcRenderer.invoke(IPC.startVoice, options),
  stopRun: (id) => ipcRenderer.invoke(IPC.stopRun, id),
};

contextBridge.exposeInMainWorld("boloDesktop", boloDesktop);
