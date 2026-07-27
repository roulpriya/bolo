const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("boloDesktop", {
  setExpanded(expanded) {
    ipcRenderer.send("set-expanded", Boolean(expanded));
  },
  onFocusCommand(callback) {
    ipcRenderer.on("focus-command", () => callback());
  },
});
