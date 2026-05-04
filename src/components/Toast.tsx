import { useEffect } from "react";
import { X } from "lucide-react";

export type ToastVariant = "success" | "error";

export type ToastState = {
  id: number;
  message: string;
  variant: ToastVariant;
};

type ToastProps = {
  toast: ToastState | null;
  onClose: () => void;
};

export function Toast({ toast, onClose }: ToastProps) {
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
    <div className={`toast ${toast.variant}`} role={toast.variant === "error" ? "alert" : "status"}>
      <span>{toast.message}</span>
      <button type="button" onClick={onClose} aria-label="토스트 닫기">
        <X aria-hidden="true" size={14} />
      </button>
    </div>
  );
}
