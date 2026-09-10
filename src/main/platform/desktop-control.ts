import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";

const execFileAsync = promisify(execFile);
const helper = path.resolve(
  import.meta.dirname,
  "../../../bin/Bolo Desktop Control.app/Contents/MacOS/desktop-control"
);
export const frameSchema = z.object({
  displayHeight: z.number().positive(),
  displayId: z.number().int(),
  displayWidth: z.number().positive(),
  height: z.number().int().positive(),
  image: z.string().min(1),
  width: z.number().int().positive(),
});
export type DesktopFrame = z.infer<typeof frameSchema>;
export type DesktopCommand = (
  action: Record<string, unknown>,
  signal?: AbortSignal
) => Promise<unknown>;

export const desktopCommand: DesktopCommand = async (action, signal) => {
  if (process.platform !== "darwin") {
    throw new Error("Desktop computer use requires macOS.");
  }
  try {
    const { stdout } = await execFileAsync(helper, [JSON.stringify(action)], {
      maxBuffer: 12 * 1024 * 1024,
      signal,
      timeout: 15_000,
    });
    return stdout.trim() ? JSON.parse(stdout) : {};
  } catch (error) {
    signal?.throwIfAborted();
    const result = z.object({ code: z.string().optional() }).safeParse(error);
    if (result.success && result.data.code === "ENOENT") {
      // biome-ignore lint/style/useErrorCause: execFile errors include the full command and private typed text.
      throw new Error(
        "Desktop control is not built. Run npm run computer:setup."
      );
    }
    // Helper errors contain static diagnostics, never the action payload or typed text.
    const diagnostic = z.object({ stderr: z.string() }).safeParse(error);
    // biome-ignore lint/style/useErrorCause: Do not retain command arguments containing private text.
    throw new Error(
      diagnostic.success
        ? diagnostic.data.stderr.trim().slice(0, 600)
        : "Desktop control failed."
    );
  }
};
