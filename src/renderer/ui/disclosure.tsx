import type { ReactNode } from "react";
import {
  Disclosure as AriaDisclosure,
  Button,
  DisclosurePanel,
} from "react-aria-components";

export interface DisclosureProps {
  children: ReactNode;
  className?: string;
  isExpanded?: boolean;
  onExpandedChange?: (isExpanded: boolean) => void;
  trigger: ReactNode;
  triggerClassName?: string;
}

export function Disclosure({
  children,
  className,
  isExpanded,
  onExpandedChange,
  trigger,
  triggerClassName,
}: DisclosureProps) {
  return (
    <AriaDisclosure
      className={["disclosure-root", className].filter(Boolean).join(" ")}
      isExpanded={isExpanded}
      onExpandedChange={onExpandedChange}
    >
      <Button
        className={["disclosure-trigger", triggerClassName]
          .filter(Boolean)
          .join(" ")}
        slot="trigger"
      >
        {trigger}
      </Button>
      <DisclosurePanel>{children}</DisclosurePanel>
    </AriaDisclosure>
  );
}
