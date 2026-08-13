import {
  Button as AriaButton,
  type ButtonProps as AriaButtonProps,
} from "react-aria-components";

export type ButtonVariant =
  | "icon"
  | "icon-only"
  | "send"
  | "stop"
  | "quiet"
  | "action"
  | "action-primary"
  | "add-server"
  | "list-add"
  | "row";

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  action: "btn-action",
  "action-primary": "btn-action btn-action-primary",
  "add-server": "btn-add-server",
  icon: "btn-icon",
  "icon-only": "btn-icon-only",
  "list-add": "btn-list-add",
  quiet: "btn-quiet",
  row: "btn-row",
  send: "btn-send",
  stop: "btn-stop",
};

export interface ButtonProps extends AriaButtonProps {
  hidden?: boolean;
  size?: "sm" | "md";
  title?: string;
  variant?: ButtonVariant;
}

export function Button({
  children,
  className,
  hidden,
  size = "md",
  title,
  variant,
  ...props
}: ButtonProps) {
  const classes = [
    variant ? VARIANT_CLASS[variant] : "",
    variant === "icon-only" && size === "sm" ? "btn-sm" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <AriaButton
      className={classes || undefined}
      hidden={hidden}
      title={title}
      {...props}
    >
      {children}
    </AriaButton>
  );
}
