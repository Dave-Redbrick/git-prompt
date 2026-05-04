import { useEffect } from "react";
import { X } from "lucide-react";

export type ConfirmDialogState = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => Promise<void> | void;
};

type ConfirmModalProps = {
  dialog: ConfirmDialogState | null;
  busy: boolean;
  busyLabel: string;
  closeLabel: string;
  defaultCancelLabel: string;
  defaultConfirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ConfirmModal({
  dialog,
  busy,
  busyLabel,
  closeLabel,
  defaultCancelLabel,
  defaultConfirmLabel,
  onCancel,
  onConfirm,
}: ConfirmModalProps) {
  useEffect(() => {
    if (!dialog || busy) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCancel();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [dialog, busy, onCancel]);

  if (!dialog) {
    return null;
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onCancel}>
      <section
        className="confirm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="confirm-modal-header">
          <h3 id="confirm-modal-title">{dialog.title}</h3>
          <button type="button" onClick={onCancel} disabled={busy} aria-label={closeLabel}>
            <X aria-hidden="true" size={15} />
          </button>
        </div>
        <p>{dialog.message}</p>
        <div className="confirm-modal-actions">
          <button type="button" className="secondary-button" onClick={onCancel} disabled={busy}>
            {dialog.cancelLabel ?? defaultCancelLabel}
          </button>
          <button type="button" className="danger-button" onClick={onConfirm} disabled={busy}>
            {busy ? busyLabel : dialog.confirmLabel ?? defaultConfirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
