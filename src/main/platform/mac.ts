import { execFile } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");
const helperApp = path.join(root, "bin", "Bolo Mac Control.app");
const helper = path.join(helperApp, "Contents", "MacOS", "mac-control");
const artifactDir = path.join(root, "artifacts");
const HELPER_TIMEOUT_MS = 12_000;
const PIXEL_WIDTH_PATTERN = /pixelWidth: (\d+)/;
const PIXEL_HEIGHT_PATTERN = /pixelHeight: (\d+)/;
let cachedScreenshotDimensions: { height: number; width: number } | null = null;

async function runHelper(action) {
  try {
    const { stdout } = await execFileAsync(helper, [JSON.stringify(action)], {
      killSignal: "SIGKILL",
      maxBuffer: 1024 * 1024,
      timeout: HELPER_TIMEOUT_MS,
    });
    return stdout.trim() ? JSON.parse(stdout) : {};
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(
        "Local agent is not built. Run: npm run local-agent:setup",
        { cause: error }
      );
    }
    throw new Error(
      `Local computer action failed: ${error.stderr || error.message}`,
      { cause: error }
    );
  }
}

export function screenSize() {
  return runHelper({ type: "screen_size" });
}

export function permissionStatus() {
  return runHelper({ type: "permission_status" });
}

export async function captureScreenshot(name = "current") {
  await mkdir(artifactDir, { recursive: true });
  const file = path.join(artifactDir, `${name}.png`);
  await execFileAsync("/usr/sbin/screencapture", ["-x", "-t", "png", file], {
    killSignal: "SIGKILL",
    timeout: HELPER_TIMEOUT_MS,
  });
  await execFileAsync("/usr/bin/sips", ["-Z", "1600", file], {
    killSignal: "SIGKILL",
    timeout: HELPER_TIMEOUT_MS,
  });
  let width = cachedScreenshotDimensions?.width;
  let height = cachedScreenshotDimensions?.height;
  if (!(width && height)) {
    const { stdout } = await execFileAsync(
      "/usr/bin/sips",
      ["-g", "pixelWidth", "-g", "pixelHeight", file],
      {
        killSignal: "SIGKILL",
        timeout: HELPER_TIMEOUT_MS,
      }
    );
    width = Number(stdout.match(PIXEL_WIDTH_PATTERN)?.[1]);
    height = Number(stdout.match(PIXEL_HEIGHT_PATTERN)?.[1]);
  }
  if (!(width && height)) {
    throw new Error("Could not read screenshot dimensions.");
  }
  cachedScreenshotDimensions = { height, width };
  return { buffer: await readFile(file), file, height, width };
}

export async function executeAction(action, screenshotSize, knownDisplaySize) {
  if (action.type === "screenshot") {
    return;
  }
  if (action.type === "wait") {
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(action.ms || 1000, 3000))
    );
    return;
  }
  const display = knownDisplaySize || (await screenSize());
  const scaleX = display.width / screenshotSize.width;
  const scaleY = display.height / screenshotSize.height;
  const mapped = { ...action, scaleX, scaleY };
  await runHelper(mapped);
}
