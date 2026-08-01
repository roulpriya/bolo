import { chromium } from "playwright";
import { existsSync } from "node:fs";

const VIEWPORT = { width: 1280, height: 800 };
const MAX_ACTIONS = 35;
const CLOSED_TARGET_PATTERN =
  /(?:target (?:page, context or browser )?has been closed|page has been closed|browser has been closed)/i;

function normalizeKey(keys) {
  const replacements = {
    CMD: "Meta",
    COMMAND: "Meta",
    CTRL: "Control",
    CONTROL: "Control",
    ALT: "Alt",
    OPTION: "Alt",
    SHIFT: "Shift",
    ENTER: "Enter",
    RETURN: "Enter",
    ESC: "Escape",
    SPACE: " ",
    BACKSPACE: "Backspace",
    TAB: "Tab",
  };
  return keys.map((key) => replacements[String(key).toUpperCase()] || key).join("+");
}

export class BrowserPageComputer {
  environment = "browser";
  dimensions = [VIEWPORT.width, VIEWPORT.height];

  constructor(page, { manager, signal, onActivity = () => {} } = {}) {
    this.page = page;
    this.manager = manager;
    this.signal = signal;
    this.onActivity = onActivity;
    this.actionCount = 0;
  }

  check(label) {
    if (this.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    this.actionCount += 1;
    if (this.actionCount > MAX_ACTIONS) {
      throw new Error(`Browser use stopped after ${MAX_ACTIONS} actions.`);
    }
    this.onActivity(label);
  }

  async usablePage() {
    if (!this.page || this.page.isClosed?.()) {
      if (!this.manager) throw new Error("The browser page has been closed.");
      this.onActivity("Reopening browser page");
      this.page = await this.manager.newPage();
    }
    return this.page;
  }

  async perform(label, action, { retryOnClose = false } = {}) {
    this.check(label);
    const page = await this.usablePage();
    try {
      return await action(page);
    } catch (error) {
      if (
        !retryOnClose ||
        !this.manager ||
        this.signal?.aborted ||
        !CLOSED_TARGET_PATTERN.test(String(error?.message || error))
      ) {
        throw error;
      }
      this.onActivity("Reopening browser after it was closed");
      this.page = await this.manager.newPage();
      return action(this.page);
    }
  }

  async screenshot() {
    const bytes = await this.perform(
      "Inspecting browser",
      (page) => page.screenshot({ type: "png" }),
      { retryOnClose: true },
    );
    return bytes.toString("base64");
  }

  async navigate(url) {
    const target = new URL(String(url));
    if (
      !["http:", "https:"].includes(target.protocol) ||
      target.username ||
      target.password
    ) {
      throw new Error("Browser navigation requires a safe HTTP or HTTPS URL.");
    }
    const response = await this.perform("Navigating browser", (page) =>
      page.goto(target.toString(), {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      }),
    );
    return {
      url: this.page.url(),
      status: response?.status() || null,
      title: await this.page.title(),
    };
  }

  async extractPage() {
    return this.perform("Reading browser page", async (page) => {
      const evidence = await page.evaluate(() => ({
        url: location.href,
        title: document.title,
        text: document.body?.innerText || "",
      }));
      return {
        ...evidence,
        text: evidence.text.trim().slice(0, 20_000),
      };
    });
  }

  async click(x, y, button = "left") {
    await this.perform("Clicking in browser", (page) =>
      page.mouse.click(x, y, { button }),
    );
  }

  async doubleClick(x, y) {
    await this.perform("Double-clicking in browser", (page) =>
      page.mouse.dblclick(x, y),
    );
  }

  async scroll(x, y, scrollX, scrollY) {
    await this.perform("Scrolling browser", async (page) => {
      await page.mouse.move(x, y);
      await page.mouse.wheel(scrollX, scrollY);
    });
  }

  async type(text) {
    await this.perform("Typing in browser", (page) =>
      page.keyboard.insertText(text),
    );
  }

  async wait() {
    await this.perform("Waiting for browser", (page) =>
      page.waitForTimeout(800),
    );
  }

  async move(x, y) {
    await this.perform("Moving in browser", (page) => page.mouse.move(x, y));
  }

  async keypress(keys) {
    await this.perform("Using browser keyboard", (page) =>
      page.keyboard.press(normalizeKey(keys)),
    );
  }

  async drag(path) {
    if (!path.length) return;
    await this.perform("Dragging in browser", async (page) => {
      await page.mouse.move(path[0][0], path[0][1]);
      await page.mouse.down();
      for (const [x, y] of path.slice(1)) await page.mouse.move(x, y);
      await page.mouse.up();
    });
  }
}

export class LocalBrowserManager {
  constructor({ profileDirectory, chromiumImpl = chromium }) {
    this.profileDirectory = profileDirectory;
    this.chromium = chromiumImpl;
    this.context = null;
    this.opening = null;
  }

  async available() {
    return existsSync(this.chromium.executablePath());
  }

  async getContext() {
    if (this.context) {
      try {
        this.context.pages();
        return this.context;
      } catch {
        this.context = null;
      }
    }
    if (!this.opening) {
      this.opening = this.chromium
        .launchPersistentContext(this.profileDirectory, {
          headless: false,
          viewport: VIEWPORT,
          acceptDownloads: false,
        })
        .then((context) => {
          this.context = context;
          context.on("close", () => {
            if (this.context === context) this.context = null;
          });
          return context;
        })
        .finally(() => {
          this.opening = null;
        });
    }
    return this.opening;
  }

  async newPage() {
    let lastError;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const context = await this.getContext();
      try {
        const page =
          context.pages().find((candidate) => !candidate.isClosed()) ||
          (await context.newPage());
        await page.bringToFront();
        return page;
      } catch (error) {
        lastError = error;
        if (!CLOSED_TARGET_PATTERN.test(String(error?.message || error))) {
          throw error;
        }
        if (this.context === context) this.context = null;
      }
    }
    throw lastError || new Error("The browser could not open a page.");
  }

  async close() {
    const context =
      this.context || (await this.opening?.catch(() => null)) || null;
    await context?.close().catch(() => {});
    this.context = null;
  }
}
