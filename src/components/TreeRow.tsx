import type { KeyboardEvent, ReactNode } from "react";
import { Trash2 } from "lucide-react";

export type TreeRowKind = "project" | "theme" | "topic";

type TreeRowProps = {
  kind: TreeRowKind;
  active: boolean;
  count: number;
  deleteLabel: string;
  icon: ReactNode;
  name: string;
  renaming?: boolean;
  renameValue?: string;
  onClick: () => void;
  onDelete: () => void;
  onDoubleClick: () => void;
  onRenameCancel?: () => void;
  onRenameChange?: (value: string) => void;
  onRenameCommit?: () => void;
};

export function TreeRow({
  kind,
  active,
  count,
  deleteLabel,
  icon,
  name,
  renaming = false,
  renameValue = "",
  onClick,
  onDelete,
  onDoubleClick,
  onRenameCancel,
  onRenameChange,
  onRenameCommit,
}: TreeRowProps) {
  const handleRenameKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      onRenameCommit?.();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      onRenameCancel?.();
    }
  };

  const rowClassName = `${kind}-row ${active ? "active" : ""} ${renaming ? "renaming" : ""}`;
  const mainClassName = `${kind}-row-main`;

  return (
    <div className={rowClassName}>
      {renaming ? (
        <div className={`${mainClassName} row-main-editing`}>
          {icon}
          <input
            className="rename-input"
            value={renameValue}
            autoFocus
            onChange={(event) => onRenameChange?.(event.target.value)}
            onBlur={onRenameCommit}
            onKeyDown={handleRenameKeyDown}
          />
          <small className="tree-count">{count}</small>
        </div>
      ) : (
        <button
          type="button"
          className={mainClassName}
          onClick={onClick}
          onDoubleClick={onDoubleClick}
        >
          {icon}
          <span>{name}</span>
          <small className="tree-count">{count}</small>
        </button>
      )}
      <button
        type="button"
        className="tree-delete-button"
        onClick={onDelete}
        aria-label={deleteLabel}
      >
        <Trash2 aria-hidden="true" size={14} />
      </button>
    </div>
  );
}
