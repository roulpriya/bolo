import { z } from "zod";

const point = z.tuple([
  z.number().int().nonnegative(),
  z.number().int().nonnegative(),
]);
const keys = z.array(z.string().min(1).max(80)).max(10).default([]);
const position = {
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
};
const duration = z.number().min(0).max(300);

export const computerAction = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("click"),
    ...position,
    button: z.enum(["left", "right", "middle", "wheel"]).default("left"),
    count: z.number().int().min(1).max(3).default(1),
    keys,
  }),
  z.object({ type: z.literal("double_click"), ...position, keys }),
  z.object({ type: z.literal("move"), ...position, keys }),
  z.object({
    type: z.literal("scroll"),
    ...position,
    keys,
    scroll_x: z.number().int().min(-10_000).max(10_000),
    scroll_y: z.number().int().min(-10_000).max(10_000),
  }),
  z.object({
    keys,
    path: z
      .array(
        z.union([
          point,
          z
            .object(position)
            .transform(({ x, y }) => [x, y] as [number, number]),
        ])
      )
      .min(2)
      .max(200),
    type: z.literal("drag"),
  }),
  z.object({
    keys: keys.refine((value) => value.length > 0),
    repeat: z.number().int().min(1).max(100).default(1),
    type: z.literal("keypress"),
  }),
  z.object({ text: z.string().max(16_000), type: z.literal("type") }),
  z.object({ duration: duration.default(2), type: z.literal("wait") }),
  z.object({
    duration,
    keys: keys.refine((value) => value.length > 0),
    type: z.literal("hold_key"),
  }),
  z.object({ type: z.literal("mouse_down") }),
  z.object({ type: z.literal("mouse_up") }),
  z.object({ type: z.literal("cursor_position") }),
  z.object({ type: z.literal("screenshot") }),
  z.object({
    region: z.tuple([
      z.number().int().nonnegative(),
      z.number().int().nonnegative(),
      z.number().int().positive(),
      z.number().int().positive(),
    ]),
    type: z.literal("zoom"),
  }),
]);
export type ComputerAction = z.infer<typeof computerAction>;
export interface ComputerObservation {
  image?: string;
  text: string;
}

const KEY_NAMES: Record<string, string> = {
  ALT: "Alt",
  ARROWDOWN: "ArrowDown",
  ARROWLEFT: "ArrowLeft",
  ARROWRIGHT: "ArrowRight",
  ARROWUP: "ArrowUp",
  BACKSPACE: "Backspace",
  CMD: "Meta",
  COMMAND: "Meta",
  CONTROL: "Control",
  CTRL: "Control",
  DEL: "Delete",
  DELETE: "Delete",
  DOWN: "ArrowDown",
  END: "End",
  ENTER: "Enter",
  ESC: "Escape",
  ESCAPE: "Escape",
  HOME: "Home",
  LEFT: "ArrowLeft",
  META: "Meta",
  OPTION: "Alt",
  PAGE_DOWN: "PageDown",
  PAGE_UP: "PageUp",
  PAGEDOWN: "PageDown",
  PAGEUP: "PageUp",
  RETURN: "Enter",
  RIGHT: "ArrowRight",
  SHIFT: "Shift",
  SPACE: "Space",
  SUPER: "Meta",
  TAB: "Tab",
  UP: "ArrowUp",
};
export function normalizeKey(key: string) {
  return KEY_NAMES[key.toUpperCase()] ?? key;
}

const claudeInput = z.object({
  coordinate: point.optional(),
  duration: duration.optional(),
  region: z.array(z.number()).optional(),
  repeat: z.number().int().min(1).max(100).optional(),
  scroll_amount: z.number().int().min(0).max(100).optional(),
  scroll_direction: z.enum(["up", "down", "left", "right"]).optional(),
  start_coordinate: point.optional(),
  text: z.string().max(16_000).optional(),
});
const CLICK_MEMBERS: Record<string, { button: string; count: number }> = {
  double_click: { button: "left", count: 2 },
  left_click: { button: "left", count: 1 },
  middle_click: { button: "middle", count: 1 },
  right_click: { button: "right", count: 1 },
  triple_click: { button: "left", count: 3 },
};

export function claudeAction(
  name: string,
  input: unknown,
  cursor: [number, number]
): ComputerAction {
  const value = claudeInput.parse(input);
  const [x, y] = value.coordinate ?? cursor;
  const modifiers = value.text ? value.text.split("+") : [];
  const click = CLICK_MEMBERS[name];
  if (click) {
    return computerAction.parse({
      type: "click",
      x,
      y,
      ...click,
      keys: modifiers,
    });
  }
  switch (name) {
    case "mouse_move":
      if (!value.coordinate) {
        throw new Error("mouse_move requires coordinate.");
      }
      return computerAction.parse({ type: "move", x, y });
    case "left_click_drag":
      return computerAction.parse({
        keys: modifiers,
        path: [value.start_coordinate, value.coordinate],
        type: "drag",
      });
    case "scroll": {
      if (value.scroll_amount === undefined || !value.scroll_direction) {
        throw new Error("scroll requires direction and amount.");
      }
      const amount = value.scroll_amount * 100;
      const delta = {
        down: [0, amount],
        left: [-amount, 0],
        right: [amount, 0],
        up: [0, -amount],
      }[value.scroll_direction];
      return computerAction.parse({
        keys: modifiers,
        scroll_x: delta[0],
        scroll_y: delta[1],
        type: "scroll",
        x,
        y,
      });
    }
    case "key":
      return computerAction.parse({
        keys: modifiers,
        repeat: value.repeat,
        type: "keypress",
      });
    case "hold_key":
      return computerAction.parse({
        duration: value.duration,
        keys: modifiers,
        type: name,
      });
    case "left_mouse_down":
      return { type: "mouse_down" };
    case "left_mouse_up":
      return { type: "mouse_up" };
    default:
      return computerAction.parse({ ...value, type: name });
  }
}
