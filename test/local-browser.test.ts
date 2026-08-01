import assert from "node:assert/strict";
import test from "node:test";
import {
  BrowserPageComputer,
  LocalBrowserManager,
} from "../src/local-browser.js";

function pageWithScreenshot(screenshot) {
  return {
    closed: false,
    isClosed() {
      return this.closed;
    },
    screenshot,
    bringToFront: async () => {},
  };
}

test("browser computer reacquires a page after its target closes", async () => {
  const first = pageWithScreenshot(async function () {
    this.closed = true;
    throw new Error("page.screenshot: Target page, context or browser has been closed");
  });
  const replacement = pageWithScreenshot(async () => Buffer.from("replacement"));
  let acquisitions = 0;
  const computer = new BrowserPageComputer(first, {
    manager: {
      async newPage() {
        acquisitions += 1;
        return replacement;
      },
    },
  });

  assert.equal(await computer.screenshot(), Buffer.from("replacement").toString("base64"));
  assert.equal(acquisitions, 1);
});

test("browser computer navigates safe URLs and extracts page evidence", async () => {
  let navigatedTo = "";
  const page = {
    ...pageWithScreenshot(async () => Buffer.from("page")),
    async goto(url) {
      navigatedTo = url;
      return { status: () => 200 };
    },
    url: () => navigatedTo,
    title: async () => "Example",
    evaluate: async () => ({
      url: navigatedTo,
      title: "Example",
      text: "Visible page text",
    }),
  };
  const computer = new BrowserPageComputer(page);

  assert.deepEqual(await computer.navigate("https://example.com/test"), {
    url: "https://example.com/test",
    status: 200,
    title: "Example",
  });
  assert.deepEqual(await computer.extractPage(), {
    url: "https://example.com/test",
    title: "Example",
    text: "Visible page text",
  });
  await assert.rejects(
    computer.navigate("file:///etc/passwd"),
    /safe HTTP or HTTPS URL/,
  );
  await assert.rejects(
    computer.navigate("https://user:secret@example.com"),
    /safe HTTP or HTTPS URL/,
  );
});

test("browser manager relaunches a closed persistent context", async () => {
  let launches = 0;
  const contexts = [];
  const chromiumImpl = {
    executablePath: () => process.execPath,
    async launchPersistentContext() {
      launches += 1;
      const listeners = new Map();
      const page = pageWithScreenshot(async () => Buffer.from("page"));
      const context = {
        closed: false,
        pages() {
          if (this.closed) {
            throw new Error("Target page, context or browser has been closed");
          }
          return [page];
        },
        on(name, listener) {
          listeners.set(name, listener);
        },
        async close() {
          this.closed = true;
          listeners.get("close")?.();
        },
      };
      contexts.push(context);
      return context;
    },
  };
  const manager = new LocalBrowserManager({
    profileDirectory: "/tmp/bolo-browser-test",
    chromiumImpl,
  });

  await manager.newPage();
  await contexts[0].close();
  await manager.newPage();
  assert.equal(launches, 2);
  await manager.close();
});
