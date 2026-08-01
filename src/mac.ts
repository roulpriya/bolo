import { execFile } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";

const execFileAsync = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");
const helperApp = path.join(root, "bin", "Bolo Mac Control.app");
const helper = path.join(helperApp, "Contents", "MacOS", "mac-control");
const artifactDir = path.join(root, "artifacts");
const HELPER_TIMEOUT_MS = 12_000;
let cachedScreenshotDimensions;

async function runHelper(action) {
  try {
    const { stdout } = await execFileAsync(helper, [JSON.stringify(action)], {
      maxBuffer: 1024 * 1024,
      timeout: HELPER_TIMEOUT_MS,
      killSignal: "SIGKILL",
    });
    return stdout.trim() ? JSON.parse(stdout) : {};
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error("Local agent is not built. Run: npm run local-agent:setup");
    }
    throw new Error(`Local computer action failed: ${error.stderr || error.message}`);
  }
}

export async function screenSize() {
  return runHelper({ type: "screen_size" });
}

export async function permissionStatus() {
  return runHelper({ type: "permission_status" });
}

export async function activateApplication(name) {
  await execFileAsync("/usr/bin/open", ["-a", name], {
    timeout: HELPER_TIMEOUT_MS,
    killSignal: "SIGKILL",
  });
  await new Promise((resolve) => setTimeout(resolve, 750));
}

export async function captureScreenshot(name = "current") {
  await mkdir(artifactDir, { recursive: true });
  const file = path.join(artifactDir, `${name}.png`);
  await execFileAsync("/usr/sbin/screencapture", ["-x", "-t", "png", file], {
    timeout: HELPER_TIMEOUT_MS,
    killSignal: "SIGKILL",
  });
  await execFileAsync("/usr/bin/sips", ["-Z", "1600", file], {
    timeout: HELPER_TIMEOUT_MS,
    killSignal: "SIGKILL",
  });
  let width = cachedScreenshotDimensions?.width;
  let height = cachedScreenshotDimensions?.height;
  if (!width || !height) {
    const { stdout } = await execFileAsync("/usr/bin/sips", [
      "-g",
      "pixelWidth",
      "-g",
      "pixelHeight",
      file,
    ], {
      timeout: HELPER_TIMEOUT_MS,
      killSignal: "SIGKILL",
    });
    width = Number(stdout.match(/pixelWidth: (\d+)/)?.[1]);
    height = Number(stdout.match(/pixelHeight: (\d+)/)?.[1]);
  }
  if (!width || !height) throw new Error("Could not read screenshot dimensions.");
  cachedScreenshotDimensions = { width, height };
  return { file, width, height, buffer: await readFile(file) };
}

export async function executeAction(action, screenshotSize, knownDisplaySize) {
  if (action.type === "screenshot") return;
  if (action.type === "wait") {
    await new Promise((resolve) => setTimeout(resolve, Math.min(action.ms || 1000, 3000)));
    return;
  }
  const display = knownDisplaySize || (await screenSize());
  const scaleX = display.width / screenshotSize.width;
  const scaleY = display.height / screenshotSize.height;
  const mapped = { ...action, scaleX, scaleY };
  await runHelper(mapped);
}
