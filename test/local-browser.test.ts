import assert from "node:assert/strict";
import { test } from "vitest";
import {
  BrowserPageComputer,
  LocalBrowserManager,
} from "../src/main/agent/local-browser.ts";

function pageWithScreenshot(screenshot) {
  return {
    bringToFront: () => Promise.resolve(),
    closed: false,
    isClosed() {
      return this.closed;
    },
    screenshot,
  };
}

test("browser computer reacquires a page after its target closes", async () => {
  const first = pageWithScreenshot(function () {
    this.closed = true;
    throw new Error(
      "page.screenshot: Target page, context or browser has been closed"
    );
  });
  const replacement = pageWithScreenshot(async () =>
    Buffer.from("replacement")
  );
  let acquisitions = 0;
  const computer = new BrowserPageComputer(first, {
    manager: {
      newPage() {
        acquisitions += 1;
        return replacement;
      },
    },
  });

  assert.equal(
    await computer.screenshot(),
    Buffer.from("replacement").toString("base64")
  );
  assert.equal(acquisitions, 1);
});

test("browser computer navigates safe URLs and extracts page evidence", async () => {
  let navigatedTo = "";
  const page = {
    ...pageWithScreenshot(async () => Buffer.from("page")),
    evaluate: async () => ({
      text: "Visible page text",
      title: "Example",
      url: navigatedTo,
    }),
    goto(url) {
      navigatedTo = url;
      return { status: () => 200 };
    },
    title: async () => "Example",
    url: () => navigatedTo,
  };
  const computer = new BrowserPageComputer(page);

  assert.deepEqual(await computer.navigate("https://example.com/test"), {
    status: 200,
    title: "Example",
    url: "https://example.com/test",
  });
  assert.deepEqual(await computer.extractPage(), {
    text: "Visible page text",
    title: "Example",
    url: "https://example.com/test",
  });
  await assert.rejects(
    computer.navigate("file:///etc/passwd"),
    /safe HTTP or HTTPS URL/
  );
  await assert.rejects(
    computer.navigate("https://user:secret@example.com"),
    /safe HTTP or HTTPS URL/
  );
});

test("browser manager relaunches a closed persistent context", async () => {
  let launches = 0;
  const contexts: Array<{ close: () => Promise<void> }> = [];
  const chromiumImpl = {
    executablePath: () => process.execPath,
    launchPersistentContext() {
      launches += 1;
      const listeners = new Map();
      const page = pageWithScreenshot(async () => Buffer.from("page"));
      const context = {
        close() {
          this.closed = Boolean(true);
          listeners.get("close")?.();
          return Promise.resolve();
        },
        closed: Boolean(false),
        on(name, listener) {
          listeners.set(name, listener);
        },
        pages() {
          if (this.closed) {
            throw new Error("Target page, context or browser has been closed");
          }
          return [page];
        },
      };
      contexts.push(context);
      return Promise.resolve(context);
    },
  };
  const manager = new LocalBrowserManager({
    chromiumImpl,
    profileDirectory: "/tmp/bolo-browser-test",
  });

  await manager.newPage();
  await contexts[0].close();
  await manager.newPage();
  assert.equal(launches, 2);
  await manager.close();
});
