import { spawn } from "node:child_process";

const MAX_COMMANDS = 8;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;
const DEFAULT_OUTPUT_LENGTH = 64_000;
const MAX_OUTPUT_LENGTH = 256_000;
const SENSITIVE_ENVIRONMENT_PATTERN =
  /(?:API|TOKEN|SECRET|PASSWORD|CREDENTIAL|COOKIE|AUTH|PRIVATE).*KEY|(?:API|TOKEN|SECRET|PASSWORD|CREDENTIAL|COOKIE|AUTH|SSH_ASKPASS|GPG_AGENT)/i;
const noop = () => undefined;

const CATASTROPHIC_PATTERNS = [
  /\brm\s+(?:-[^\s]*r[^\s]*f|-[^\s]*f[^\s]*r)\s+(?:\/(?:\*|\s|$)|~(?:\/?\*|\s|$)|\$HOME(?:\/?\*|\s|$))/i,
  /\b(?:diskutil\s+erase|mkfs(?:\.|\s)|fdisk\s|shutdown\s|reboot\s|halt\s)/i,
  /\bdd\s+[^;\n]*(?:of=\/dev\/|of=\/)/i,
  /\bsecurity\s+(?:dump-keychain|find-generic-password|find-internet-password)\b/i,
  /\b(?:csrutil\s+disable|spctl\s+--master-disable)\b/i,
  /\b(?:cat|sed|awk|head|tail|less|more)\b[^;\n]*(?:\.ssh\/|\.aws\/|\.env(?:\s|$)|Keychains\/)/i,
  /\bfind\s+(?:\/|~|\$HOME)\b[^;\n]*-(?:delete|exec\s+rm)\b/i,
];

const CONSEQUENTIAL_PATTERNS = [
  /\b(?:sudo|doas)\b/i,
  /\b(?:rm|rmdir|unlink)\b/i,
  /\b(?:npm|pnpm|yarn|pipx?|brew|gem)\s+(?:install|uninstall|remove|add|update|upgrade)\b/i,
  /\b(?:curl|wget)\b[^;\n]*(?:--upload-file|-T\s|--data|-d\s|--form|-F\s)/i,
  /\b(?:chmod|chown|launchctl|defaults\s+write|killall)\b/i,
  />\s*\/(?:Applications|Library|System|Users)\//i,
];

export function shellRisk(commands) {
  const joined = commands.join("\n");
  if (CATASTROPHIC_PATTERNS.some((pattern) => pattern.test(joined))) {
    return "blocked";
  }
  if (CONSEQUENTIAL_PATTERNS.some((pattern) => pattern.test(joined))) {
    return "confirmation";
  }
  return "routine";
}

function cleanEnvironment(environment = process.env) {
  return Object.fromEntries(
    Object.entries(environment).filter(
      ([name, value]) =>
        value !== undefined && !SENSITIVE_ENVIRONMENT_PATTERN.test(name)
    )
  );
}

function bounded(value, fallback, max) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0
    ? Math.min(number, max)
    : fallback;
}

export class LocalShell {
  constructor({ cwd, signal, onActivity = noop }) {
    this.cwd = cwd;
    this.signal = signal;
    this.onActivity = onActivity;
  }

  async run(action) {
    const commands = Array.isArray(action?.commands) ? action.commands : [];
    if (!commands.length || commands.length > MAX_COMMANDS) {
      throw new Error(`Shell accepts between 1 and ${MAX_COMMANDS} commands.`);
    }
    if (shellRisk(commands) === "blocked") {
      throw new Error(
        "That shell command is blocked because it could damage the machine or expose secrets."
      );
    }
    const timeoutMs = bounded(
      action.timeoutMs,
      DEFAULT_TIMEOUT_MS,
      MAX_TIMEOUT_MS
    );
    const maxOutputLength = bounded(
      action.maxOutputLength,
      DEFAULT_OUTPUT_LENGTH,
      MAX_OUTPUT_LENGTH
    );
    const output: unknown[] = [];
    for (const command of commands) {
      this.onActivity("Running a local command");
      output.push(
        // biome-ignore lint/performance/noAwaitInLoops: Commands intentionally execute sequentially in the supplied order.
        await this.runCommand(String(command), timeoutMs, maxOutputLength)
      );
    }
    return { maxOutputLength, output };
  }

  runCommand(command, timeoutMs, maxOutputLength) {
    return new Promise((resolve, reject) => {
      if (this.signal.aborted) {
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }
      const child = spawn("/bin/zsh", ["-lc", command], {
        cwd: this.cwd,
        env: cleanEnvironment(),
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      const append = (current, chunk) =>
        (current + chunk.toString()).slice(-maxOutputLength);
      child.stdout.on("data", (chunk) => {
        stdout = append(stdout, chunk);
      });
      child.stderr.on("data", (chunk) => {
        stderr = append(stderr, chunk);
      });
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
      }, timeoutMs);
      const abort = () => child.kill("SIGTERM");
      this.signal.addEventListener("abort", abort, { once: true });
      child.on("error", reject);
      child.on("close", (code) => {
        clearTimeout(timer);
        this.signal.removeEventListener("abort", abort);
        if (this.signal.aborted) {
          reject(new DOMException("Aborted", "AbortError"));
          return;
        }
        resolve({
          outcome: timedOut
            ? { type: "timeout" }
            : { exitCode: code, type: "exit" },
          stderr,
          stdout,
        });
      });
    });
  }
}
