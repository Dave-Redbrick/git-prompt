import { Star } from "lucide-react";
import type { UiMessages } from "../i18n";

type StarToggleButtonProps = {
  checked: boolean;
  className?: string;
  ui: UiMessages;
  onClick: () => void;
};

export function StarToggleButton({
  checked,
  className = "",
  ui,
  onClick,
}: StarToggleButtonProps) {
  const label = checked ? ui.unmarkGoodResult : ui.markGoodResult;

  return (
    <button
      type="button"
      className={`star-toggle-button ${checked ? "checked" : ""} ${className}`.trim()}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <Star aria-hidden="true" fill={checked ? "currentColor" : "none"} size={15} />
    </button>
  );
}
