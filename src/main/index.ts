import { fileURLToPath } from "node:url";
import {
  app,
  BrowserWindow,
  dialog,
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
let settingsWindow: BrowserWindow | null = null;
let desktopService: DesktopService | null = null;
let desktopServiceReady = false;
let tray: Tray | null = null;
const pendingMcpOAuthCallbacks: string[] = [];
const handledMcpOAuthCallbacks = new Set<string>();
const devServerUrl = process.env.VITE_DEV_SERVER_URL;
const trayIconPath = fileURLToPath(
  new URL("./assets/boloTemplate.png", import.meta.url)
);

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

app.on("second-instance", (_event, commandLine) => {
  const callbackUrl = commandLine.find((argument) =>
    argument.startsWith("bolo://mcp-oauth")
  );
  if (callbackUrl) {
    handleMcpOAuthCallback(callbackUrl);
    return;
  }
  showWindow();
});

app.on("open-url", (event, url) => {
  event.preventDefault();
  handleMcpOAuthCallback(url);
});

function sendMcpOAuthEvent(event: {
  error?: string;
  serverId?: string;
  status: "connected" | "failed";
}): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send(IPC.mcpOAuthEvent, event);
    settingsWindow.show();
    settingsWindow.focus();
  }
}

function handleMcpOAuthCallback(url: string): void {
  if (!(desktopService && desktopServiceReady)) {
    if (!pendingMcpOAuthCallbacks.includes(url)) {
      pendingMcpOAuthCallbacks.push(url);
    }
    return;
  }
  if (handledMcpOAuthCallbacks.has(url)) {
    return;
  }
  handledMcpOAuthCallbacks.add(url);
  desktopService
    .completeMcpOAuth(url)
    .then((serverId) => {
      if (serverId) {
        sendMcpOAuthEvent({ serverId, status: "connected" });
      }
    })
    .catch((error: unknown) => {
      sendMcpOAuthEvent({
        error: String(error instanceof Error ? error.message : error).slice(
          0,
          600
        ),
        status: "failed",
      });
    });
}

function createWindow() {
  const window = new BrowserWindow({
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
      preload: fileURLToPath(
        new URL("../../dist/renderer/preload/index.cjs", import.meta.url)
      ),
      sandbox: true,
    },
    width: 760,
  });
  mainWindow = window;

  if (devServerUrl) {
    window.loadURL(`${devServerUrl}/app/index.html`);
  } else {
    window.loadFile(
      fileURLToPath(
        new URL("../../dist/renderer/app/index.html", import.meta.url)
      )
    );
  }
  window.once("ready-to-show", () => {
    window.show();
    window.focus();
  });
  window.on("closed", () => {
    if (mainWindow === window) {
      mainWindow = null;
    }
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
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
  window.webContents.on("will-navigate", (event, url) => {
    if (url === window.webContents.getURL()) {
      return;
    }
    event.preventDefault();
  });
}

function showSettings() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    backgroundColor: "#151519",
    height: 680,
    minHeight: 540,
    minWidth: 620,
    title: "Bolo Settings",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition: { x: 20, y: 20 },
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: fileURLToPath(
        new URL("../../dist/renderer/preload/index.cjs", import.meta.url)
      ),
      sandbox: true,
    },
    width: 760,
  });
  if (devServerUrl) {
    settingsWindow.loadURL(`${devServerUrl}/settings/index.html`);
  } else {
    settingsWindow.loadFile(
      fileURLToPath(
        new URL("../../dist/renderer/settings/index.html", import.meta.url)
      )
    );
  }
  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });
}

function showWindow(reset = false) {
  if (!mainWindow) {
    createWindow();
  }
  const window = mainWindow;
  if (!window) {
    return;
  }
  window.center();
  window.show();
  window.focus();
  window.webContents.send(reset ? IPC.newCommand : IPC.focusCommand);
}

function createTray() {
  const image = nativeImage.createFromPath(trayIconPath);
  if (image.isEmpty()) {
    throw new Error(`Could not load tray icon: ${trayIconPath}`);
  }
  image.setTemplateImage(true);
  tray = new Tray(image);
  tray.setToolTip("Bolo");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { click: () => showWindow(), label: "Show Bolo" },
      { click: () => showWindow(true), label: "New conversation" },
      { click: () => showSettings(), label: "Settings" },
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
  app.setAsDefaultProtocolClient("bolo");
  desktopService = new DesktopService({
    dataDirectory: app.getPath("userData"),
    workspaceDirectory: app.getPath("home"),
  });
  await desktopService.initialize();
  desktopServiceReady = true;
  for (const callbackUrl of pendingMcpOAuthCallbacks.splice(0)) {
    handleMcpOAuthCallback(callbackUrl);
  }
  const launchCallbackUrl = process.argv.find((argument) =>
    argument.startsWith("bolo://mcp-oauth")
  );
  if (launchCallbackUrl) {
    handleMcpOAuthCallback(launchCallbackUrl);
  }
  desktopService.on("voice-event", (voiceEvent) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC.voiceEvent, voiceEvent);
    }
  });
  desktopService.on("thread-event", (threadEvent) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC.threadEvent, threadEvent);
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

ipcMain.on(IPC.setIgnoreMouseEvents, (event: IpcMainEvent, ignore: unknown) => {
  if (!(isMainRenderer(event) && mainWindow)) {
    return;
  }
  mainWindow.setIgnoreMouseEvents(
    ipcArgs.setIgnoreMouseEvents.parse([ignore])[0],
    { forward: true }
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

function isSettingsRenderer(event: IpcMainEvent | IpcMainInvokeEvent) {
  return Boolean(
    settingsWindow &&
      !settingsWindow.isDestroyed() &&
      event.sender === settingsWindow.webContents
  );
}

function isMainOrSettingsRenderer(event: IpcMainEvent | IpcMainInvokeEvent) {
  return isMainRenderer(event) || isSettingsRenderer(event);
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
  operation: (...args: Arguments) => unknown,
  authorize = isMainRenderer
) {
  ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    if (!authorize(event)) {
      throw new Error("Unauthorized renderer request.");
    }
    return operation(...argsSchema.parse(args));
  });
}

handle(IPC.health, z.tuple([]), () => service().health());
handle(IPC.settingsOpen, ipcArgs.settingsOpen, () => {
  showSettings();
  return { ok: true };
});
handle(
  IPC.mcpServersGet,
  ipcArgs.mcpServersGet,
  () => service().getMcpServers(),
  isMainOrSettingsRenderer
);
handle(
  IPC.mcpServersSave,
  ipcArgs.mcpServersSave,
  (servers) => service().saveMcpServers(servers),
  isMainOrSettingsRenderer
);
handle(
  IPC.mcpOAuthStart,
  ipcArgs.mcpOAuthStart,
  (id) => service().startMcpOAuth(id),
  isMainOrSettingsRenderer
);
handle(IPC.createThread, ipcArgs.createThread, () => service().createThread());
handle(IPC.listThreads, ipcArgs.listThreads, () => service().listThreads());
handle(IPC.getThread, ipcArgs.getThread, (id) => service().getThread(id));
handle(IPC.restoreThread, ipcArgs.restoreThread, (options) =>
  service().restoreThread(options)
);
handle(IPC.selectThread, ipcArgs.selectThread, (id) =>
  service().selectThread(id)
);
handle(IPC.startVoiceSession, ipcArgs.startVoiceSession, (options) =>
  service().startVoiceSession(options)
);
handle(IPC.cancelVoiceSession, ipcArgs.cancelVoiceSession, (id) =>
  service().cancelVoiceSession(id)
);
handle(IPC.startTurn, ipcArgs.startTurn, (input) => service().startTurn(input));
handle(IPC.answerQuestion, ipcArgs.answerQuestion, (input) =>
  service().answerQuestion(input)
);
handle(IPC.speech, ipcArgs.speech, (text, languageCode) =>
  service().speech(text, languageCode)
);
handle(IPC.getTurn, ipcArgs.getTurn, (threadId, turnId) =>
  service().getTurn(threadId, turnId)
);
handle(IPC.cancelTurn, ipcArgs.cancelTurn, (threadId, turnId) =>
  service().cancelTurn(threadId, turnId)
);

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

let shutdownComplete = Boolean(false);
let shuttingDown = Boolean(false);

async function finishShutdown(): Promise<void> {
  try {
    await desktopService?.close();
    shutdownComplete = true;
    globalShortcut.unregisterAll();
    app.quit();
  } catch (error) {
    shuttingDown = false;
    dialog.showErrorBox(
      "Bolo could not finish shutting down",
      String(error instanceof Error ? error.message : error)
    );
  }
}

app.on("before-quit", async (event) => {
  if (shutdownComplete) {
    return;
  }
  event.preventDefault();
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  await finishShutdown();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
