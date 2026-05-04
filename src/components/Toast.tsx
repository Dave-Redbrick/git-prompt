import { useEffect } from "react";
import { AlertTriangle, CheckCircle2, X } from "lucide-react";

export type ToastVariant = "success" | "error";

export type ToastState = {
  id: number;
  message: string;
  variant: ToastVariant;
};

type ToastProps = {
  toast: ToastState | null;
  closeLabel: string;
  onClose: () => void;
};

export function Toast({ toast, closeLabel, onClose }: ToastProps) {
  useEffect(() => {
    if (!toast) {
      return;
    }

    const timer = window.setTimeout(onClose, 2800);
    return () => window.clearTimeout(timer);
  }, [toast?.id, onClose]);

  if (!toast) {
    return null;
  }

  return (
    <div
      className={`toast ${toast.variant}`}
      role={toast.variant === "error" ? "alert" : "status"}
    >
      <span className="toast-icon">
        {toast.variant === "error" ? (
          <AlertTriangle aria-hidden="true" size={18} />
        ) : (
          <CheckCircle2 aria-hidden="true" size={18} />
        )}
      </span>
      <span className="toast-message">{toast.message}</span>
      <button type="button" onClick={onClose} aria-label={closeLabel}>
        <X aria-hidden="true" size={14} />
      </button>
    </div>
  );
}
