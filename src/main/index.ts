import { fileURLToPath } from "node:url";
import {
  app,
  BrowserWindow,
  globalShortcut,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  ipcMain,
  Menu,
  nativeImage,
  session,
  shell,
  Tray,
} from "electron";
import { z } from "zod";
import { IPC, ipcArgs } from "../shared/ipc.ts";
import { DesktopService } from "./services/desktop-service.ts";

let mainWindow: BrowserWindow | null = null;
let desktopService: DesktopService | null = null;
let tray: Tray | null = null;
const devServerUrl = process.env.VITE_DEV_SERVER_URL;

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

app.on("second-instance", () => {
  showWindow();
});

function createWindow() {
  mainWindow = new BrowserWindow({
    backgroundColor: "#00000000",
    frame: false,
    fullscreenable: false,
    hasShadow: false,
    height: 140,
    maxWidth: 900,
    minHeight: 126,
    minWidth: 620,
    resizable: true,
    show: false,
    title: "Bolo",
    transparent: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: fileURLToPath(new URL("../preload/index.cjs", import.meta.url)),
      sandbox: true,
    },
    width: 760,
  });

  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl);
  } else {
    mainWindow.loadFile(
      fileURLToPath(new URL("../../dist/renderer/index.html", import.meta.url))
    );
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
    if (url === mainWindow.webContents.getURL()) {
      return;
    }
    event.preventDefault();
  });
}

function showWindow(reset = false) {
  if (!mainWindow) {
    createWindow();
  }
  mainWindow.center();
  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.send(reset ? IPC.newCommand : IPC.focusCommand);
}

function createTray() {
  const image = nativeImage.createFromDataURL(
    "data:image/svg+xml;base64," +
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18"><circle cx="9" cy="9" r="7" fill="none" stroke="black" stroke-width="2"/><circle cx="9" cy="9" r="2" fill="black"/></svg>'
      ).toString("base64")
  );
  image.setTemplateImage(true);
  tray = new Tray(image);
  tray.setToolTip("Bolo");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { click: () => showWindow(), label: "Show Bolo" },
      { click: () => showWindow(true), label: "New Task" },
      { type: "separator" },
      { click: () => app.quit(), label: "Quit Bolo" },
    ])
  );
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
    workspaceDirectory: app.getPath("home"),
  });
  await desktopService.initialize();
  desktopService.on("voice-event", (voiceEvent) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC.voiceEvent, voiceEvent);
    }
  });
  desktopService.on("agent-text", (agentText) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC.agentText, agentText);
    }
  });
  session.defaultSession.setPermissionRequestHandler(
    (webContents, permission, callback, details) => {
      callback(
        permission === "media" &&
          details.isMainFrame &&
          webContents === mainWindow?.webContents
      );
    }
  );
  createWindow();
  createTray();
  globalShortcut.register("CommandOrControl+Shift+Space", toggleWindow);

  app.on("activate", () => {
    if (mainWindow) {
      showWindow();
    } else {
      createWindow();
    }
  });
});

ipcMain.on(IPC.setExpanded, (event: IpcMainEvent, expanded: unknown) => {
  if (
    !mainWindow ||
    mainWindow.isDestroyed() ||
    event.sender !== mainWindow.webContents
  ) {
    return;
  }
  mainWindow.setSize(
    mainWindow.getSize()[0],
    ipcArgs.setExpanded.parse([expanded])[0] ? 520 : 140,
    true
  );
});

ipcMain.on(IPC.hideWindow, (event: IpcMainEvent) => {
  if (
    !mainWindow ||
    mainWindow.isDestroyed() ||
    event.sender !== mainWindow.webContents
  ) {
    return;
  }
  mainWindow.hide();
});

function isMainRenderer(event: IpcMainEvent | IpcMainInvokeEvent) {
  return Boolean(
    mainWindow &&
      !mainWindow.isDestroyed() &&
      event.sender === mainWindow.webContents
  );
}

function service(): DesktopService {
  if (!desktopService) {
    throw new Error("Bolo is still starting.");
  }
  return desktopService;
}

function handle<Arguments extends readonly unknown[]>(
  channel: string,
  argsSchema: z.ZodType<Arguments>,
  operation: (...args: Arguments) => unknown
) {
  ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    if (!isMainRenderer(event)) {
      throw new Error("Unauthorized renderer request.");
    }
    return operation(...argsSchema.parse(args));
  });
}

handle(IPC.health, z.tuple([]), () => service().health());
handle(IPC.startVoice, ipcArgs.startVoice, (options) =>
  service().startVoice(options)
);
handle(IPC.cancelVoice, ipcArgs.cancelVoice, (sessionId) =>
  service().cancelVoice(sessionId)
);
handle(IPC.startAgent, ipcArgs.startAgent, (text) =>
  service().startAgent(text)
);
handle(IPC.answerRun, ipcArgs.answerRun, (runId, questionId, text) =>
  service().answerRun(runId, questionId, text)
);
handle(IPC.speech, ipcArgs.speech, (text, languageCode) =>
  service().speech(text, languageCode)
);
handle(IPC.getRun, ipcArgs.getRun, (id) => service().getRun(id));
handle(IPC.stopRun, ipcArgs.stopRun, (id) => service().stopRun(id));

ipcMain.on(
  IPC.voiceChunk,
  (event: IpcMainEvent, sessionId: unknown, bytes: unknown) => {
    if (!isMainRenderer(event)) {
      return;
    }
    try {
      const [validatedSessionId, validatedBytes] = ipcArgs.voiceChunk.parse([
        sessionId,
        bytes,
      ]);
      service().sendVoiceChunk(validatedSessionId, validatedBytes);
    } catch (error) {
      mainWindow?.webContents.send(IPC.voiceEvent, {
        error: String(error instanceof Error ? error.message : error).slice(
          0,
          600
        ),
        sessionId: String(sessionId || ""),
        type: "failed",
      });
    }
  }
);

app.on("will-quit", async () => {
  globalShortcut.unregisterAll();
  await desktopService?.close();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
