import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import {
  type DesktopCommand,
  type DesktopFrame,
  desktopCommand,
  frameSchema,
} from "../platform/desktop-control.ts";
import {
  type ComputerAction,
  type ComputerObservation,
  computerAction,
  normalizeKey,
} from "./computer-actions.ts";

const MAX_ACTIONS = 200;
export class DesktopComputer {
  cursor: [number, number] = [0, 0];
  frame?: DesktopFrame;
  actionCount = 0;
  mouseHeld = Boolean(false);
  heldKeys = new Set<string>();
  signal: AbortSignal;
  command: DesktopCommand;
  onActivity: (text: string) => void;

  constructor(options: {
    signal: AbortSignal;
    command?: DesktopCommand;
    onActivity?: (text: string) => void;
  }) {
    this.signal = options.signal;
    this.command = options.command ?? desktopCommand;
    this.onActivity = options.onActivity ?? (() => undefined);
  }

  async screenshot() {
    this.signal.throwIfAborted();
    this.frame = frameSchema.parse(
      await this.command({ type: "screenshot" }, this.signal)
    );
    this.signal.throwIfAborted();
    return this.frame.image;
  }

  point(x: number, y: number) {
    if (
      !this.frame ||
      x < 0 ||
      y < 0 ||
      x >= this.frame.width ||
      y >= this.frame.height
    ) {
      throw new Error("Coordinates are outside the latest desktop screenshot.");
    }
  }

  send(action: Record<string, unknown>, cleanup = false) {
    if (!cleanup) {
      this.signal.throwIfAborted();
    }
    const { frame } = this;
    return this.command(
      {
        ...action,
        keys: [...this.heldKeys],
        ...(frame
          ? {
              displayHeight: frame.displayHeight,
              displayId: frame.displayId,
              displayWidth: frame.displayWidth,
              height: frame.height,
              width: frame.width,
            }
          : {}),
      },
      cleanup ? undefined : this.signal
    );
  }

  async release() {
    try {
      if (this.mouseHeld) {
        await this.send({ type: "mouse_up" }, true);
        this.mouseHeld = false;
      }
    } finally {
      await this.releaseKeys();
    }
  }

  async releaseKeys() {
    const errors: unknown[] = [];
    for (const key of [...this.heldKeys].reverse()) {
      this.heldKeys.delete(key);
      try {
        // biome-ignore lint/performance/noAwaitInLoops: Attempt every release even if an earlier release fails.
        await this.send({ key, type: "key_up" }, true);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length) {
      throw new AggregateError(errors, "Could not release desktop keys.");
    }
  }

  async withKeys(keys: string[], action: () => Promise<void>) {
    try {
      for (const key of keys.map(normalizeKey)) {
        this.heldKeys.add(key);
        // biome-ignore lint/performance/noAwaitInLoops: Press modifiers in order.
        await this.send({ key, type: "key_down" });
      }
      this.signal.throwIfAborted();
      await action();
    } finally {
      await this.releaseKeys();
    }
  }

  async move(x: number, y: number) {
    this.point(x, y);
    await this.send({ dragging: this.mouseHeld, type: "move", x, y });
    this.cursor = [x, y];
  }

  async pointer(
    action: Extract<
      ComputerAction,
      { type: "click" | "double_click" | "scroll" | "move" | "drag" }
    >
  ) {
    if (action.type === "drag") {
      for (const [x, y] of action.path) {
        this.point(x, y);
      }
      const [start, ...rest] = action.path;
      await this.move(...start);
      this.mouseHeld = true;
      try {
        await this.send({ type: "mouse_down" });
        for (const [x, y] of rest) {
          // biome-ignore lint/performance/noAwaitInLoops: Preserve every point in the drag path.
          await this.move(x, y);
        }
      } finally {
        await this.send({ type: "mouse_up" }, true);
        this.mouseHeld = false;
      }
      return;
    }
    await this.move(action.x, action.y);
    if (action.type === "move") {
      return;
    }
    if (action.type === "scroll") {
      await this.send({
        scroll_x: action.scroll_x,
        scroll_y: action.scroll_y,
        type: "scroll",
      });
      return;
    }
    await this.send({
      button: action.type === "double_click" ? "left" : action.button,
      count: action.type === "double_click" ? 2 : action.count,
      type: "click",
    });
  }

  async execute(input: unknown): Promise<ComputerObservation> {
    this.signal.throwIfAborted();
    const action = computerAction.parse(input);
    this.actionCount += 1;
    if (this.actionCount > MAX_ACTIONS) {
      throw new Error(`Computer use stopped after ${MAX_ACTIONS} actions.`);
    }
    if (!this.frame) {
      throw new Error("Inspect a desktop screenshot before acting.");
    }
    if ("x" in action) {
      this.point(action.x, action.y);
    }
    if (action.type === "drag") {
      for (const [x, y] of action.path) {
        this.point(x, y);
      }
    }
    this.onActivity(`Computer: ${action.type}`);
    const result = await this.dispatch(action);
    this.signal.throwIfAborted();
    return result;
  }

  async dispatch(action: ComputerAction): Promise<ComputerObservation> {
    switch (action.type) {
      case "click":
      case "double_click":
      case "scroll":
      case "move":
      case "drag":
        await this.withKeys(action.keys, () => this.pointer(action));
        break;
      case "keypress":
        for (let count = 0; count < action.repeat; count += 1) {
          // biome-ignore lint/performance/noAwaitInLoops: Repeated chords must be ordered.
          await this.withKeys(action.keys, async () => undefined);
        }
        break;
      case "type":
        await this.send({ text: action.text, type: "type" });
        break;
      case "wait":
        await delay(action.duration * 1000, undefined, { signal: this.signal });
        break;
      case "hold_key":
        await this.withKeys(action.keys, async () => {
          await delay(action.duration * 1000, undefined, {
            signal: this.signal,
          });
        });
        break;
      case "mouse_down":
        this.mouseHeld = true;
        await this.send({ type: "mouse_down" });
        break;
      case "mouse_up":
        await this.send({ type: "mouse_up" });
        this.mouseHeld = false;
        break;
      case "cursor_position": {
        const result = z
          .object({ x: z.number(), y: z.number() })
          .parse(await this.send({ type: "cursor_position" }));
        this.cursor = [result.x, result.y];
        return { text: `X=${result.x}, Y=${result.y}` };
      }
      case "screenshot":
        return { image: await this.screenshot(), text: "Desktop screenshot" };
      case "zoom": {
        const [x, y, right, bottom] = action.region;
        this.point(x, y);
        if (
          right <= x ||
          bottom <= y ||
          !this.frame ||
          right > this.frame.width ||
          bottom > this.frame.height
        ) {
          throw new Error("Invalid zoom region.");
        }
        const result = z
          .object({ image: z.string().min(1) })
          .parse(await this.send({ region: action.region, type: "zoom" }));
        return {
          image: result.image,
          text: "Zoom; use full screenshot coordinates for subsequent actions.",
        };
      }
      default:
        throw new Error("Unsupported desktop action.");
    }
    return { text: "OK" };
  }
}
