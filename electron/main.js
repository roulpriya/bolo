import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  session,
  shell,
} from "electron";
import { fileURLToPath } from "node:url";
import { startServer } from "../src/server.js";

let mainWindow;
let webServer;

function createWindow(port) {
  const appOrigin = `http://127.0.0.1:${port}`;
  mainWindow = new BrowserWindow({
    width: 760,
    height: 205,
    minWidth: 620,
    minHeight: 205,
    maxWidth: 900,
    show: false,
    resizable: true,
    fullscreenable: false,
    title: "Bolo",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 18, y: 18 },
    backgroundColor: "#151517",
    vibrancy: "under-window",
    visualEffectState: "active",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: fileURLToPath(new URL("./preload.cjs", import.meta.url)),
    },
  });

  mainWindow.loadURL(appOrigin);
  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    mainWindow.focus();
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const target = new URL(url);
      if (
        ["http:", "https:"].includes(target.protocol) &&
        !target.username &&
        !target.password
      ) {
        shell.openExternal(target.toString());
      }
    } catch {
      // Invalid URLs remain blocked.
    }
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url === `${appOrigin}/`) return;
    event.preventDefault();
  });
}

function toggleWindow() {
  if (!mainWindow) return;
  if (mainWindow.isVisible() && mainWindow.isFocused()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send("focus-command");
  }
}

app.whenReady().then(async () => {
  const started = await startServer({ port: 0 });
  webServer = started.server;
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, permission, callback, details) => {
      let origin = "";
      try {
        origin = new URL(details.requestingUrl).origin;
      } catch {
        // Malformed request origins remain denied.
      }
      callback(
        permission === "media" &&
          details.isMainFrame &&
          origin === `http://127.0.0.1:${started.port}`,
      );
    },
  );
  createWindow(started.port);
  globalShortcut.register("CommandOrControl+Shift+Space", toggleWindow);

  app.on("activate", () => {
    if (mainWindow) toggleWindow();
    else createWindow(started.port);
  });
});

ipcMain.on("set-expanded", (event, expanded) => {
  if (
    !mainWindow ||
    mainWindow.isDestroyed() ||
    event.sender !== mainWindow.webContents
  ) {
    return;
  }
  mainWindow.setSize(mainWindow.getSize()[0], expanded ? 560 : 205, true);
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  webServer?.close();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
