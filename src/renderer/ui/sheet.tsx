import type { ReactNode } from "react";
import { Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";

export interface SheetProps {
  children: ReactNode;
  description?: string;
  footer?: ReactNode;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  title: string;
}

export function Sheet({
  children,
  description,
  footer,
  isOpen,
  onOpenChange,
  title,
}: SheetProps) {
  return (
    <ModalOverlay
      className="sheet-overlay"
      isOpen={isOpen}
      onOpenChange={onOpenChange}
    >
      <Modal className="sheet-modal">
        <Dialog className="sheet-dialog">
          <Heading className="sheet-title" slot="title">
            {title}
          </Heading>
          {description ? (
            <p className="sheet-description">{description}</p>
          ) : null}
          <div className="sheet-body">{children}</div>
          {footer ? <div className="sheet-footer">{footer}</div> : null}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
