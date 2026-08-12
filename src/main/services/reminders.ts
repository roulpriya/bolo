import { spawn } from "node:child_process";

function run(command, args, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const abort = () => child.kill("SIGTERM");
    signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      signal?.removeEventListener("abort", abort);
      if (signal?.aborted) {
        return reject(new DOMException("Aborted", "AbortError"));
      }
      if (code !== 0) {
        return reject(
          new Error(stderr.trim() || `${command} exited with ${code}.`)
        );
      }
      resolve(stdout.trim());
    });
  });
}

export class RemindersService {
  constructor({ execute = run } = {}) {
    this.execute = execute;
  }

  async create({ title, scheduledFor, signal }) {
    const name = String(title || "").trim();
    const date = new Date(scheduledFor);
    if (!name || name.length > 500) {
      throw new Error("A reminder title is required.");
    }
    if (Number.isNaN(date.getTime())) {
      throw new Error("The reminder time must be a valid ISO date and time.");
    }

    // Pass user data as argv rather than interpolating it into AppleScript.
    const script = [
      "on run argv",
      "set reminderTitle to item 1 of argv",
      "set reminderDate to date (item 2 of argv)",
      'tell application "Reminders"',
      "set createdReminder to make new reminder at end of reminders of default list with properties {name:reminderTitle, remind me date:reminderDate}",
      "return id of createdReminder",
      "end tell",
      "end run",
    ].join("\n");
    const id = await this.execute(
      "/usr/bin/osascript",
      ["-l", "AppleScript", "-e", script, name, date.toISOString()],
      signal
    );
    await this.execute("/usr/bin/open", ["-a", "Reminders"], signal);
    return {
      id,
      scheduledFor: date.toISOString(),
      status: "created",
      title: name,
    };
  }

}
