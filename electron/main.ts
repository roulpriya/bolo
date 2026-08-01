import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  session,
  shell,
  Menu,
  Tray,
  nativeImage,
} from "electron";
import { fileURLToPath } from "node:url";
import { DesktopService } from "../src/desktop-service.js";

let mainWindow;
let desktopService;
let tray;
const devServerUrl = process.env.VITE_DEV_SERVER_URL;

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

app.on("second-instance", () => {
  showWindow();
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 760,
    height: 140,
    minWidth: 620,
    minHeight: 126,
    maxWidth: 900,
    show: false,
    resizable: true,
    fullscreenable: false,
    title: "Bolo",
    frame: false,
    transparent: true,
    hasShadow: false,
    backgroundColor: "#00000000",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: fileURLToPath(new URL("./preload.cjs", import.meta.url)),
    },
  });

  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl);
  } else {
    mainWindow.loadFile(fileURLToPath(new URL("../public/index.html", import.meta.url)));
  }
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
    if (url === mainWindow.webContents.getURL()) return;
    event.preventDefault();
  });
}

function showWindow(reset = false) {
  if (!mainWindow) createWindow();
  mainWindow.center();
  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.send(reset ? "new-command" : "focus-command");
}

function createTray() {
  const image = nativeImage.createFromDataURL(
    "data:image/svg+xml;base64," + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18"><circle cx="9" cy="9" r="7" fill="none" stroke="black" stroke-width="2"/><circle cx="9" cy="9" r="2" fill="black"/></svg>').toString("base64"),
  );
  image.setTemplateImage(true);
  tray = new Tray(image);
  tray.setToolTip("Bolo");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Show Bolo", click: () => showWindow() },
    { label: "New Task", click: () => showWindow(true) },
    { type: "separator" },
    { label: "Quit Bolo", click: () => app.quit() },
  ]));
  tray.on("click", () => showWindow());
}

function toggleWindow() {
  if (!mainWindow) {
    showWindow();
    return;
  }
  if (mainWindow.isVisible() && mainWindow.isFocused()) {
    mainWindow.hide();
  } else {
    showWindow();
  }
}

app.whenReady().then(async () => {
  desktopService = new DesktopService({
    dataDirectory: app.getPath("userData"),
    workspaceDirectory: process.cwd(),
  });
  await desktopService.initialize();
  desktopService.on("voice-event", (voiceEvent) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("bolo:voice-event", voiceEvent);
    }
  });
  session.defaultSession.setPermissionRequestHandler(
    (webContents, permission, callback, details) => {
      callback(permission === "media" && details.isMainFrame && webContents === mainWindow?.webContents);
    },
  );
  createWindow();
  createTray();
  globalShortcut.register("CommandOrControl+Shift+Space", toggleWindow);

  app.on("activate", () => {
  if (mainWindow) showWindow();
    else createWindow();
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
  mainWindow.setSize(mainWindow.getSize()[0], expanded ? 520 : 140, true);
});

ipcMain.on("hide-window", (event) => {
  if (
    !mainWindow ||
    mainWindow.isDestroyed() ||
    event.sender !== mainWindow.webContents
  ) {
    return;
  }
  mainWindow.hide();
});

function isMainRenderer(event) {
  return Boolean(mainWindow && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents);
}

function handle(channel, operation) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!isMainRenderer(event)) throw new Error("Unauthorized renderer request.");
    return operation(...args);
  });
}

handle("bolo:health", () => desktopService.health());
handle("bolo:start-voice", (options) => desktopService.startVoice(options));
handle("bolo:cancel-voice", (sessionId) => desktopService.cancelVoice(sessionId));
handle("bolo:start-agent", (text) => desktopService.startAgent(text));
handle("bolo:answer-run", (runId, questionId, text) =>
  desktopService.answerRun(runId, questionId, text),
);
handle("bolo:speech", (text, languageCode) =>
  desktopService.speech(text, languageCode),
);
handle("bolo:get-run", (id) => desktopService.getRun(id));
handle("bolo:stop-run", (id) => desktopService.stopRun(id));

ipcMain.on("bolo:voice-chunk", (event, sessionId, bytes) => {
  if (!isMainRenderer(event)) return;
  try {
    desktopService.sendVoiceChunk(sessionId, bytes);
  } catch (error) {
    mainWindow?.webContents.send("bolo:voice-event", {
      sessionId: String(sessionId || ""),
      type: "failed",
      error: String(error?.message || error).slice(0, 600),
    });
  }
});

app.on("will-quit", async () => {
  globalShortcut.unregisterAll();
  await desktopService?.close();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
