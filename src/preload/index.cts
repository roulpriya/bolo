import { contextBridge, ipcRenderer } from "electron";
import { IPC } from "../shared/ipc.ts";

const boloDesktop: Window["boloDesktop"] = {
  answerQuestion: (input) => ipcRenderer.invoke(IPC.answerQuestion, input),
  cancelInput: (threadId) => ipcRenderer.invoke(IPC.cancelInput, threadId),
  cancelTurn: (threadId, turnId) =>
    ipcRenderer.invoke(IPC.cancelTurn, threadId, turnId),
  cancelVoiceSession: (sessionId) =>
    ipcRenderer.invoke(IPC.cancelVoiceSession, sessionId),
  createThread: () => ipcRenderer.invoke(IPC.createThread),
  getMcpServers: () => ipcRenderer.invoke(IPC.mcpServersGet),
  getPendingInput: (threadId) =>
    ipcRenderer.invoke(IPC.getPendingInput, threadId),
  getThread: (id) => ipcRenderer.invoke(IPC.getThread, id),
  getTurn: (threadId, turnId) =>
    ipcRenderer.invoke(IPC.getTurn, threadId, turnId),
  health: () => ipcRenderer.invoke(IPC.health),
  hideWindow() {
    ipcRenderer.send(IPC.hideWindow);
  },
  listThreads: () => ipcRenderer.invoke(IPC.listThreads),
  onFocusCommand(callback) {
    const listener = () => callback();
    ipcRenderer.on(IPC.focusCommand, listener);
    return () => ipcRenderer.removeListener(IPC.focusCommand, listener);
  },
  onInputEvent(callback) {
    const listener = (
      _event: unknown,
      inputEvent: Parameters<typeof callback>[0]
    ) => callback(inputEvent);
    ipcRenderer.on(IPC.inputEvent, listener);
    return () => ipcRenderer.removeListener(IPC.inputEvent, listener);
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
  onThreadEvent(callback) {
    const listener = (
      _event: unknown,
      threadEvent: Parameters<typeof callback>[0]
    ) => callback(threadEvent);
    ipcRenderer.on(IPC.threadEvent, listener);
    return () => ipcRenderer.removeListener(IPC.threadEvent, listener);
  },
  onVoiceEvent(callback) {
    const listener = (
      _event: unknown,
      voiceEvent: Parameters<typeof callback>[0]
    ) => callback(voiceEvent);
    ipcRenderer.on(IPC.voiceEvent, listener);
    return () => ipcRenderer.removeListener(IPC.voiceEvent, listener);
  },
  openSettings: () => ipcRenderer.invoke(IPC.settingsOpen),
  resolveInput: (input) => ipcRenderer.invoke(IPC.resolveInput, input),
  restoreThread: (options) => ipcRenderer.invoke(IPC.restoreThread, options),
  saveMcpServers: (servers) => ipcRenderer.invoke(IPC.mcpServersSave, servers),
  selectThread: (id) => ipcRenderer.invoke(IPC.selectThread, id),
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
  startMcpOAuth: (id) => ipcRenderer.invoke(IPC.mcpOAuthStart, id),
  startTurn: (input) => ipcRenderer.invoke(IPC.startTurn, input),
  startVoiceSession: (options) =>
    ipcRenderer.invoke(IPC.startVoiceSession, options),
  submitInput: (input) => ipcRenderer.invoke(IPC.submitInput, input),
};

contextBridge.exposeInMainWorld("boloDesktop", boloDesktop);
