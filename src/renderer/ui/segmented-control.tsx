import { useCallback } from "react";
import {
  type Key,
  ToggleButton,
  ToggleButtonGroup,
} from "react-aria-components";

export interface SegmentedOption<Value extends string> {
  label: string;
  value: Value;
}

export interface SegmentedControlProps<Value extends string> {
  "aria-label": string;
  onChange: (value: Value) => void;
  options: SegmentedOption<Value>[];
  value: Value;
}

export function SegmentedControl<Value extends string>({
  "aria-label": ariaLabel,
  onChange,
  options,
  value,
}: SegmentedControlProps<Value>) {
  const handleSelectionChange = useCallback(
    (keys: Set<Key>) => {
      const [first] = keys;
      if (typeof first === "string") {
        onChange(first as Value);
      }
    },
    [onChange]
  );
  return (
    <ToggleButtonGroup
      aria-label={ariaLabel}
      className="segmented-root"
      disallowEmptySelection
      onSelectionChange={handleSelectionChange}
      selectedKeys={[value]}
      selectionMode="single"
    >
      {options.map((option) => (
        <ToggleButton id={option.value} key={option.value}>
          {option.label}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}
