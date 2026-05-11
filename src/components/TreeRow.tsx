import type { DragEvent, KeyboardEvent, ReactNode } from "react";
import { GripVertical, Trash2 } from "lucide-react";

export type TreeRowKind = "project" | "theme" | "topic";

let transparentTreeDragImage: HTMLElement | null = null;

const clearTransparentTreeDragImage = () => {
  transparentTreeDragImage?.remove();
  transparentTreeDragImage = null;
};

const getTransparentTreeDragImage = () => {
  clearTransparentTreeDragImage();

  const element = document.createElement("div");

  element.style.position = "fixed";
  element.style.left = "0";
  element.style.top = "0";
  element.style.width = "1px";
  element.style.height = "1px";
  element.style.background = "rgba(255,255,255,0.01)";
  element.style.pointerEvents = "none";
  element.style.zIndex = "2147483647";
  document.body.appendChild(element);
  transparentTreeDragImage = element;

  return element;
};

type TreeRowProps = {
  kind: TreeRowKind;
  active: boolean;
  count: number;
  deleteLabel: string;
  icon: ReactNode;
  draggable?: boolean;
  layoutHidden?: boolean;
  hideDelete?: boolean;
  preview?: boolean;
  previewVariant?: "drop" | "floating";
  name: string;
  renaming?: boolean;
  renameValue?: string;
  onClick: () => void;
  onDelete: () => void;
  onDoubleClick: () => void;
  onDrag?: (event: DragEvent<HTMLSpanElement>) => void;
  onDragEnd?: () => void;
  onDragOver?: (event: DragEvent<HTMLDivElement>) => void;
  onDragStart?: (event: DragEvent<HTMLSpanElement>) => void;
  onDrop?: (event: DragEvent<HTMLDivElement>) => void;
  onRenameCancel?: () => void;
  onRenameChange?: (value: string) => void;
  onRenameCommit?: () => void;
};

export function TreeRow({
  kind,
  active,
  count,
  deleteLabel,
  draggable = false,
  layoutHidden = false,
  hideDelete = false,
  icon,
  name,
  preview = false,
  renaming = false,
  renameValue = "",
  onClick,
  onDelete,
  onDoubleClick,
  onDrag,
  onDragEnd,
  onDragOver,
  onDragStart,
  onDrop,
  onRenameCancel,
  onRenameChange,
  onRenameCommit,
  previewVariant = "drop",
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

  const rowClassName = `${kind}-row ${active ? "active" : ""} ${renaming ? "renaming" : ""} ${draggable ? "draggable" : ""} ${layoutHidden ? "drag-layout-hidden" : ""}`;
  const mainClassName = `${kind}-row-main`;
  const handleMainKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onClick();
    }
  };
  const handleDragStart = (event: DragEvent<HTMLSpanElement>) => {
    event.dataTransfer.setDragImage(getTransparentTreeDragImage(), 0, 0);

    onDragStart?.(event);
  };
  const handleDragEnd = () => {
    clearTransparentTreeDragImage();
    onDragEnd?.();
  };
  const rowContent = (
    <>
      {draggable ? (
        <span
          className="tree-drag-handle"
          draggable={!preview}
          onDrag={preview ? undefined : onDrag}
          onDragStart={preview ? undefined : handleDragStart}
          onDragEnd={preview ? undefined : handleDragEnd}
          onClick={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          onMouseUp={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          onPointerUp={(event) => event.stopPropagation()}
          aria-hidden="true"
        >
          <GripVertical size={13} />
        </span>
      ) : null}
      {icon}
      <span>{name}</span>
      <small className="tree-count">{count}</small>
    </>
  );

  return (
    <div
      className={`${rowClassName} ${
        preview
          ? previewVariant === "floating"
            ? "floating-preview-item"
            : "drop-preview-ghost"
          : ""
      }`}
      onDragOver={onDragOver}
      onDrop={onDrop}
      aria-hidden={preview ? "true" : undefined}
    >
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
      ) : preview ? (
        <div className={mainClassName}>{rowContent}</div>
      ) : (
        <div
          role="button"
          tabIndex={0}
          className={mainClassName}
          onClick={onClick}
          onDoubleClick={onDoubleClick}
          onKeyDown={handleMainKeyDown}
        >
          {rowContent}
        </div>
      )}
      {preview || hideDelete ? null : (
        <button
          type="button"
          className="tree-delete-button"
          onClick={onDelete}
          aria-label={deleteLabel}
        >
          <Trash2 aria-hidden="true" size={14} />
        </button>
      )}
    </div>
  );
}
