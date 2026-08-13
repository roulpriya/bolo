import {
  TextArea as AriaTextArea,
  type TextAreaProps as AriaTextAreaProps,
  TextField as AriaTextField,
  type TextFieldProps as AriaTextFieldProps,
} from "react-aria-components";

export interface TextAreaProps
  extends Omit<AriaTextFieldProps, "children" | "className">,
    Pick<
      AriaTextAreaProps,
      "onKeyDown" | "placeholder" | "ref" | "rows" | "spellCheck"
    > {
  className?: string;
  maxLength?: number;
}

export function TextArea({
  className,
  maxLength,
  onKeyDown,
  placeholder,
  ref,
  rows,
  spellCheck,
  ...props
}: TextAreaProps) {
  const classes = ["text-area", className].filter(Boolean).join(" ");
  return (
    <AriaTextField className="field-inline" {...props}>
      <AriaTextArea
        className={classes}
        maxLength={maxLength}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        ref={ref}
        rows={rows}
        spellCheck={spellCheck}
      />
    </AriaTextField>
  );
}
