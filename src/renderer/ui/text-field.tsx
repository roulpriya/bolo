import {
  TextField as AriaTextField,
  type TextFieldProps as AriaTextFieldProps,
  Input,
  type InputProps,
} from "react-aria-components";

export interface TextFieldProps
  extends Omit<AriaTextFieldProps, "children" | "className">,
    Pick<
      InputProps,
      | "autoComplete"
      | "autoFocus"
      | "maxLength"
      | "placeholder"
      | "ref"
      | "spellCheck"
      | "type"
    > {
  align?: "start" | "end";
  bare?: boolean;
  className?: string;
  monospace?: boolean;
  size?: "sm" | "md" | "lg";
  weight?: "regular" | "bold";
}

export function TextField({
  align = "start",
  autoComplete,
  autoFocus,
  bare = false,
  className,
  maxLength,
  monospace = false,
  placeholder,
  ref,
  size = "md",
  spellCheck,
  type,
  weight = "regular",
  ...props
}: TextFieldProps) {
  const classes = [
    "text-field",
    monospace ? "tf-mono" : "",
    align === "end" ? "tf-align-end" : "",
    size === "sm" ? "tf-size-sm" : "",
    size === "lg" ? "tf-size-lg" : "",
    weight === "bold" ? "tf-weight-bold" : "",
    bare ? "tf-bare" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <AriaTextField className="field-inline" {...props}>
      <Input
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        className={classes}
        maxLength={maxLength}
        placeholder={placeholder}
        ref={ref}
        spellCheck={spellCheck}
        type={type}
      />
    </AriaTextField>
  );
}
