import { unlink } from "node:fs/promises";
import {
  captureScreenshot,
  executeAction,
  permissionStatus,
  screenSize,
} from "../platform/mac.ts";

const MAX_ACTIONS = 20;
const MAX_SAME_ACTION = 2;
const MAX_WAIT_ACTIONS = 1;

function stageFor(actionCount) {
  if (actionCount < 3) {
    return "Starting agent";
  }
  if (actionCount < 14) {
    return "Working";
  }
  return "Checking result";
}

function describeAction(action) {
  switch (action.type) {
    case "click":
    case "double_click":
    case "move":
      return `${action.type} (${action.x}, ${action.y})`;
    case "scroll":
      return `scroll (${action.x}, ${action.y}) by (${action.scroll_x}, ${action.scroll_y})`;
    case "type":
      return `type ${String(action.text || "").length} characters`;
    case "keypress":
      return `keypress ${JSON.stringify(action.keys)}`;
    case "wait":
      return `wait ${action.ms || 1000}ms`;
    case "drag":
      return `drag through ${action.path?.length || 0} points`;
    default:
      return action.type;
  }
}

export class LocalMacComputer {
  environment = "mac";

  constructor(runState) {
    this.runState = runState;
    this.actionCount = 0;
    this.lastActionSignature = "";
    this.repeatedActions = 0;
    this.lastScreenshot = null;
    this.screenDirty = false;
    this.halted = false;
    this.waitActions = 0;
    this.screenshotFiles = new Set();
  }

  async initRun() {
    const permissions = await permissionStatus();
    if (!permissions.accessibilityTrusted) {
      throw new Error(
        "Accessibility is denied for Bolo Mac Control. Run `npm run local-agent:permissions`, then use the + button to add the revealed “Bolo Mac Control.app” and enable it. Restart Bolo afterward."
      );
    }
    const size = await screenSize();
    this.displaySize = size;
    this.dimensions = [size.width, size.height];
  }

  // Stops the run without throwing mid tool-call: the OpenAI Agents SDK
  // swallows any error thrown from a Computer method into an empty
  // image_url, which the Responses API then rejects with an opaque 400.
  // Aborting instead lets the current tool call finish with a valid
  // screenshot, and the next model request fails cleanly as an AbortError.
  halt(message) {
    if (this.halted) {
      return;
    }
    this.halted = true;
    console.log(
      `[computer:${this.runState.id}] halt after ${this.actionCount} actions (${this.waitActions} waits): ${message}`
    );
    this.runState.internalStopReason = message;
    this.runState.abortController.abort();
  }

  lastScreenshotBase64() {
    return this.lastScreenshot
      ? this.lastScreenshot.buffer.toString("base64")
      : "";
  }

  async ensureScreenshot() {
    if (!this.lastScreenshot) {
      await this.screenshot();
    }
    return this.lastScreenshot;
  }

  async perform(action) {
    if (this.runState.cancelled) {
      this.halt("Stopped by the user.");
    }
    if (this.halted) {
      return;
    }

    this.actionCount += 1;
    if (this.actionCount > MAX_ACTIONS) {
      this.halt(`Bolo stopped after ${MAX_ACTIONS} computer actions.`);
      return;
    }

    if (action.type === "wait") {
      this.waitActions += 1;
      if (this.waitActions > MAX_WAIT_ACTIONS) {
        this.halt(
          "The computer agent waited without making progress, so Bolo stopped."
        );
        return;
      }
    }

    const signature = JSON.stringify(action);
    this.repeatedActions =
      signature === this.lastActionSignature ? this.repeatedActions + 1 : 0;
    this.lastActionSignature = signature;
    if (this.repeatedActions >= MAX_SAME_ACTION) {
      this.halt("The same interaction failed twice, so Bolo stopped safely.");
      return;
    }

    const screenshot = await this.ensureScreenshot();
    if (this.halted) {
      return;
    }
    this.runState.stage = stageFor(this.actionCount);
    console.log(
      `[computer:${this.runState.id}] action ${this.actionCount}: ${describeAction(action)}`
    );
    try {
      await executeAction(action, screenshot, this.displaySize);
    } catch (error) {
      this.halt(error.message);
      return;
    }
    this.screenDirty = true;
  }

  async screenshot() {
    if (this.runState.cancelled) {
      this.halt("Stopped by the user.");
    }
    if (this.halted) {
      return this.lastScreenshotBase64();
    }

    let screenshot: Awaited<ReturnType<typeof captureScreenshot>> | null = null;
    try {
      screenshot = await captureScreenshot(
        `run-${this.runState.id}-agent-${this.actionCount}`
      );
    } catch (error) {
      this.halt(error.message);
      return this.lastScreenshotBase64();
    }

    this.screenDirty = false;
    this.lastScreenshot = screenshot;
    this.screenshotFiles.add(screenshot.file);
    this.runState.finalScreenshotPath = screenshot.file;
    console.log(
      `[computer:${this.runState.id}] screenshot -> ${screenshot.file}`
    );
    return this.lastScreenshotBase64();
  }

  async cleanup() {
    await Promise.allSettled(
      [...this.screenshotFiles].map((file) => unlink(file))
    );
    this.screenshotFiles.clear();
    this.lastScreenshot = null;
    this.runState.finalScreenshotPath = null;
  }

  async click(x, y, button = "left") {
    await this.perform({ button, type: "click", x, y });
  }

  async doubleClick(x, y) {
    await this.perform({ button: "left", type: "double_click", x, y });
  }

  async scroll(x, y, scrollX, scrollY) {
    await this.perform({
      scroll_x: scrollX,
      scroll_y: scrollY,
      type: "scroll",
      x,
      y,
    });
  }

  async type(text) {
    await this.perform({ text, type: "type" });
  }

  async wait() {
    await this.perform({ ms: 1000, type: "wait" });
  }

  async move(x, y) {
    await this.perform({ type: "move", x, y });
  }

  async keypress(keys) {
    await this.perform({ keys, type: "keypress" });
  }

  async drag(path) {
    await this.perform({
      path: path.map(([x, y]) => ({ x, y })),
      type: "drag",
    });
  }
}
