import { useRef } from "react";
import {
  type AriaSwitchProps,
  mergeProps,
  useFocusRing,
  useSwitch,
} from "react-aria";
import { useToggleState } from "react-stately";

export interface SwitchProps extends AriaSwitchProps {
  "aria-label": string;
}

export function Switch(props: SwitchProps) {
  const state = useToggleState(props);
  const ref = useRef<HTMLInputElement>(null);
  const { inputProps } = useSwitch(props, state, ref);
  const { focusProps, isFocusVisible } = useFocusRing();
  return (
    <label
      className="switch-root"
      data-focus-visible={isFocusVisible ? "" : undefined}
      data-selected={state.isSelected ? "" : undefined}
    >
      <input
        {...mergeProps(inputProps, focusProps)}
        className="sr-only"
        ref={ref}
      />
      <span className="switch-track" />
      <span className="switch-thumb" />
    </label>
  );
}
