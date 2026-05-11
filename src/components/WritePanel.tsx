import {
  GripVertical,
  ImagePlus,
  Mic,
  Plus,
  TextSelect,
  Trash2,
  Undo2,
  Video,
} from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { ChangeEvent, DragEvent } from "react";
import type { UiMessages } from "../i18n";
import type {
  DraftImage,
  PromptVersionKind,
  SystemPrompt,
  TopicModelId,
} from "../types";
import { pauseOtherAudioInGroup } from "../lib/audioPlayback";
import { getResultMediaKind, getSystemPromptText } from "../lib/promptVersions";
import { TagPopoverSelect, type TagPopoverOption } from "./TagPopoverSelect";

type WritePanelProps = {
  draftImages: DraftImage[];
  draftLabel: string;
  draftNotes: string;
  draftResultTexts: string[];
  draftSystemPrompts: SystemPrompt[];
  draftUserPrompt: string;
  audioGroupId: string;
  isVersionEdit?: boolean;
  isVersionView?: boolean;
  modelOptions: TagPopoverOption[];
  pasteTargetActive: boolean;
  previousUserPrompt: string;
  selectedModelIds: TopicModelId[];
  selectedTopicKind: PromptVersionKind;
  ui: UiMessages;
  onAddDraftSystemPrompt: () => void;
  onDraftLabelChange: (value: string) => void;
  onDraftNotesChange: (value: string) => void;
  onAddDraftResultText: () => void;
  onDraftResultTextChange: (index: number, value: string) => void;
  onDraftSystemPromptBodyChange: (index: number, value: string) => void;
  onDraftSystemPromptNameChange: (index: number, value: string) => void;
  onDraftUserPromptChange: (value: string) => void;
  onImageUpload: (event: ChangeEvent<HTMLInputElement>) => void;
  onModelChange: (value: string[]) => void;
  onPasteTargetActiveChange: (active: boolean) => void;
  onRemoveDraftImage: (imageId: string) => void;
  onRemoveDraftResultText: (index: number) => void;
  onRemoveDraftSystemPrompt: (index: number) => void;
  onReorderDraftImage: (
    draggedImageId: string,
    targetImageId: string,
    insertAfter: boolean,
  ) => void;
  onReorderDraftResultText: (
    draggedIndex: number,
    targetIndex: number,
    insertAfter: boolean,
  ) => void;
  onResetDraftResultTexts: () => void;
  onResetDraftSystemPrompts: () => void;
};

type DropPreviewPosition = "before" | "after";
type FloatingDragOverlay =
  | {
      kind: "result-text";
      index: number;
      height: number;
      offsetX: number;
      offsetY: number;
      width: number;
      x: number;
      y: number;
    }
  | {
      kind: "image";
      imageId: string;
      height: number;
      offsetX: number;
      offsetY: number;
      width: number;
      x: number;
      y: number;
    };

let transparentResultDragImage: HTMLElement | null = null;

const clearTransparentResultDragImage = () => {
  transparentResultDragImage?.remove();
  transparentResultDragImage = null;
};

const getTransparentResultDragImage = () => {
  clearTransparentResultDragImage();

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
  transparentResultDragImage = element;

  return element;
};

function ResultMediaPreview({
  audioGroupId,
  media,
}: {
  audioGroupId: string;
  media: DraftImage;
}) {
  const mediaKind = getResultMediaKind(media);

  if (mediaKind === "video") {
    return <video src={media.dataUrl} controls preload="metadata" />;
  }

  if (mediaKind === "audio") {
    return (
      <div className="media-audio-preview">
        <audio
          src={media.dataUrl}
          controls
          data-audio-group={audioGroupId}
          onPlay={(event) => pauseOtherAudioInGroup(event.currentTarget)}
        />
      </div>
    );
  }

  return <img src={media.dataUrl} alt={media.name} />;
}

export function WritePanel({
  draftImages,
  draftLabel,
  draftNotes,
  draftResultTexts,
  draftSystemPrompts,
  draftUserPrompt,
  audioGroupId,
  isVersionEdit = false,
  isVersionView = false,
  modelOptions,
  pasteTargetActive,
  previousUserPrompt,
  selectedModelIds,
  selectedTopicKind,
  ui,
  onAddDraftSystemPrompt,
  onDraftLabelChange,
  onDraftNotesChange,
  onAddDraftResultText,
  onDraftResultTextChange,
  onDraftSystemPromptBodyChange,
  onDraftSystemPromptNameChange,
  onDraftUserPromptChange,
  onImageUpload,
  onModelChange,
  onPasteTargetActiveChange,
  onRemoveDraftImage,
  onRemoveDraftResultText,
  onRemoveDraftSystemPrompt,
  onReorderDraftImage,
  onReorderDraftResultText,
  onResetDraftResultTexts,
  onResetDraftSystemPrompts,
}: WritePanelProps) {
  const imageUploadInputRef = useRef<HTMLInputElement>(null);
  const resultTextareaRefs = useRef<Array<HTMLTextAreaElement | null>>([]);
  const systemPromptTabRefs = useRef<Array<HTMLDivElement | null>>([]);
  const systemPromptTabNameInputRef = useRef<HTMLInputElement | null>(null);
  const systemPromptTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const previousSystemPromptCountRef = useRef(draftSystemPrompts.length);
  const userPromptTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [activeSystemPromptIndex, setActiveSystemPromptIndex] = useState(0);
  const [editingSystemPromptIndex, setEditingSystemPromptIndex] = useState<
    number | null
  >(null);
  const [editingSystemPromptTabWidth, setEditingSystemPromptTabWidth] = useState<
    number | null
  >(null);
  const [draggedResultTextIndex, setDraggedResultTextIndex] = useState<
    number | null
  >(null);
  const [draggedImageId, setDraggedImageId] = useState<string | null>(null);
  const [resultTextDropPreview, setResultTextDropPreview] = useState<{
    index: number;
    position: DropPreviewPosition;
  } | null>(null);
  const [imageDropPreview, setImageDropPreview] = useState<{
    imageId: string;
    position: DropPreviewPosition;
  } | null>(null);
  const [floatingDragOverlay, setFloatingDragOverlay] =
    useState<FloatingDragOverlay | null>(null);
  const [dragSourceHidden, setDragSourceHidden] = useState(false);
  const dragSourceHideFrameRef = useRef<number | null>(null);
  const floatingDragOverlayFrameRef = useRef<number | null>(null);
  const floatingDragOverlayPointRef = useRef<{ x: number; y: number } | null>(
    null,
  );
  const isPromptLocked = isVersionEdit || isVersionView;
  const isFullyReadOnly = isVersionView;
  const panelTitle = isVersionEdit
    ? ui.editVersion
    : isVersionView
      ? ui.viewVersion
      : ui.write;

  const selectTextarea = (textarea: HTMLTextAreaElement | null) => {
    textarea?.focus();
    textarea?.select();
  };
  const getDragOverlayAnchor = (event: DragEvent<HTMLElement>) => {
    if (floatingDragOverlay) {
      return {
        x: event.clientX - floatingDragOverlay.offsetX + floatingDragOverlay.width / 2,
        y:
          event.clientY -
          floatingDragOverlay.offsetY +
          floatingDragOverlay.height / 2,
      };
    }

    return { x: event.clientX, y: event.clientY };
  };
  const getInsertAfterDropTarget = (event: DragEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const anchor = getDragOverlayAnchor(event);
    const midpointY = rect.top + rect.height / 2;

    if (Math.abs(anchor.y - midpointY) < rect.height * 0.3) {
      return anchor.x > rect.left + rect.width / 2;
    }

    return anchor.y > midpointY;
  };
  const cancelFloatingDragOverlayFrame = () => {
    if (floatingDragOverlayFrameRef.current !== null) {
      window.cancelAnimationFrame(floatingDragOverlayFrameRef.current);
      floatingDragOverlayFrameRef.current = null;
    }

    floatingDragOverlayPointRef.current = null;
  };
  const cancelDragSourceHideFrame = () => {
    if (dragSourceHideFrameRef.current !== null) {
      window.cancelAnimationFrame(dragSourceHideFrameRef.current);
      dragSourceHideFrameRef.current = null;
    }
  };
  const scheduleDragSourceHide = () => {
    cancelDragSourceHideFrame();
    dragSourceHideFrameRef.current = window.requestAnimationFrame(() => {
      dragSourceHideFrameRef.current = null;
      setDragSourceHidden(true);
    });
  };
  const scheduleFloatingDragOverlayPosition = (
    event: DragEvent<HTMLElement>,
    matchesOverlay: (overlay: FloatingDragOverlay) => boolean = () => true,
  ) => {
    if (event.clientX === 0 && event.clientY === 0) {
      return;
    }

    floatingDragOverlayPointRef.current = {
      x: event.clientX,
      y: event.clientY,
    };

    if (floatingDragOverlayFrameRef.current !== null) {
      return;
    }

    floatingDragOverlayFrameRef.current = window.requestAnimationFrame(() => {
      floatingDragOverlayFrameRef.current = null;
      const point = floatingDragOverlayPointRef.current;

      if (!point) {
        return;
      }

      setFloatingDragOverlay((current) => {
        if (!current || !matchesOverlay(current)) {
          return current;
        }

        if (
          Math.abs(current.x - point.x) < 1 &&
          Math.abs(current.y - point.y) < 1
        ) {
          return current;
        }

        return { ...current, x: point.x, y: point.y };
      });
    });
  };
  const getDragOverlayPlacement = <T extends HTMLElement>(
    event: DragEvent<T>,
    selector: string,
  ) => {
    event.dataTransfer.setDragImage(getTransparentResultDragImage(), 0, 0);

    const element = event.currentTarget.closest<HTMLElement>(selector);

    if (!element) {
      return {
        height: 32,
        offsetX: 0,
        offsetY: 0,
        width: 220,
        x: event.clientX,
        y: event.clientY,
      };
    }

    const rect = element.getBoundingClientRect();
    return {
      height: rect.height,
      offsetX: Math.max(0, Math.min(rect.width, event.clientX - rect.left)),
      offsetY: Math.max(0, Math.min(rect.height, event.clientY - rect.top)),
      width: rect.width,
      x: event.clientX,
      y: event.clientY,
    };
  };
  const startResultTextDrag = (
    index: number,
    event: DragEvent<HTMLSpanElement>,
  ) => {
    cancelFloatingDragOverlayFrame();
    cancelDragSourceHideFrame();
    setDragSourceHidden(false);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(index));
    const placement = getDragOverlayPlacement(event, ".result-text-item");

    setFloatingDragOverlay({
      kind: "result-text",
      index,
      ...placement,
    });
    setResultTextDropPreview({ index, position: "after" });
    setDraggedResultTextIndex(index);
    scheduleDragSourceHide();
  };
  const dragResultText = (
    index: number,
    event: DragEvent<HTMLSpanElement>,
  ) => {
    scheduleFloatingDragOverlayPosition(
      event,
      (overlay) => overlay.kind === "result-text" && overlay.index === index,
    );
  };
  const dragOverResultText = (
    index: number,
    event: DragEvent<HTMLDivElement>,
    positionOverride?: DropPreviewPosition,
  ) => {
    if (
      isFullyReadOnly ||
      draggedResultTextIndex === null
    ) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";

    if (draggedResultTextIndex === index) {
      setResultTextDropPreview((current) =>
        current?.index === index
          ? current
          : {
              index,
              position: "after",
            },
      );
      return;
    }

    const position =
      positionOverride ?? (getInsertAfterDropTarget(event) ? "after" : "before");
    setResultTextDropPreview((current) =>
      current?.index === index && current.position === position
        ? current
        : { index, position },
    );
  };
  const dropResultText = (
    index: number,
    event: DragEvent<HTMLDivElement>,
    insertAfterOverride?: boolean,
  ) => {
    const draggedIndex = draggedResultTextIndex;

    if (draggedIndex === null || draggedIndex === index) {
      flushSync(() => {
        cancelFloatingDragOverlayFrame();
        cancelDragSourceHideFrame();
        setDragSourceHidden(false);
        setDraggedResultTextIndex(null);
        setResultTextDropPreview(null);
        setFloatingDragOverlay(null);
        clearTransparentResultDragImage();
      });
      return;
    }

    event.preventDefault();
    const insertAfter = insertAfterOverride ?? getInsertAfterDropTarget(event);

    flushSync(() => {
      cancelFloatingDragOverlayFrame();
      cancelDragSourceHideFrame();
      onReorderDraftResultText(draggedIndex, index, insertAfter);
      setDragSourceHidden(false);
      setDraggedResultTextIndex(null);
      setResultTextDropPreview(null);
      setFloatingDragOverlay(null);
      clearTransparentResultDragImage();
    });
  };
  const startImageDrag = (
    imageId: string,
    event: DragEvent<HTMLSpanElement>,
  ) => {
    cancelFloatingDragOverlayFrame();
    cancelDragSourceHideFrame();
    setDragSourceHidden(false);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", imageId);
    const placement = getDragOverlayPlacement(event, ".image-tile");

    setFloatingDragOverlay({
      kind: "image",
      imageId,
      ...placement,
    });
    setImageDropPreview({ imageId, position: "after" });
    setDraggedImageId(imageId);
    scheduleDragSourceHide();
  };
  const dragImage = (imageId: string, event: DragEvent<HTMLSpanElement>) => {
    scheduleFloatingDragOverlayPosition(
      event,
      (overlay) => overlay.kind === "image" && overlay.imageId === imageId,
    );
  };
  const updateFloatingDragOverlayPosition = (event: DragEvent<HTMLElement>) => {
    if (!floatingDragOverlay) {
      return;
    }

    scheduleFloatingDragOverlayPosition(event);
  };
  const dragOverImage = (
    imageId: string,
    event: DragEvent<HTMLElement>,
    positionOverride?: DropPreviewPosition,
  ) => {
    if (isFullyReadOnly || !draggedImageId) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";

    if (draggedImageId === imageId) {
      setImageDropPreview((current) =>
        current?.imageId === imageId
          ? current
          : {
              imageId,
              position: "after",
            },
      );
      return;
    }

    const position =
      positionOverride ?? (getInsertAfterDropTarget(event) ? "after" : "before");
    setImageDropPreview((current) =>
      current?.imageId === imageId && current.position === position
        ? current
        : { imageId, position },
    );
  };
  const dropImage = (
    imageId: string,
    event: DragEvent<HTMLElement>,
    insertAfterOverride?: boolean,
  ) => {
    const draggedId = draggedImageId;

    if (!draggedId || draggedId === imageId) {
      flushSync(() => {
        cancelFloatingDragOverlayFrame();
        cancelDragSourceHideFrame();
        setDragSourceHidden(false);
        setDraggedImageId(null);
        setImageDropPreview(null);
        setFloatingDragOverlay(null);
        clearTransparentResultDragImage();
      });
      return;
    }

    event.preventDefault();
    const insertAfter = insertAfterOverride ?? getInsertAfterDropTarget(event);

    flushSync(() => {
      cancelFloatingDragOverlayFrame();
      cancelDragSourceHideFrame();
      onReorderDraftImage(draggedId, imageId, insertAfter);
      setDragSourceHidden(false);
      setDraggedImageId(null);
      setImageDropPreview(null);
      setFloatingDragOverlay(null);
      clearTransparentResultDragImage();
    });
  };
  const resultTextCharCount = draftResultTexts.reduce(
    (total, text) => total + text.length,
    0,
  );
  const systemPromptCharCount = getSystemPromptText(draftSystemPrompts).length;
  const normalizedActiveSystemPromptIndex = Math.min(
    activeSystemPromptIndex,
    Math.max(0, draftSystemPrompts.length - 1),
  );
  const activeSystemPrompt =
    draftSystemPrompts[normalizedActiveSystemPromptIndex] ?? null;
  const systemPromptNameCounts = useMemo(
    () =>
      draftSystemPrompts.reduce<Record<string, number>>((counts, prompt, index) => {
        const name = prompt.name.trim() || ui.systemPromptNamePlaceholder(index + 1);

        counts[name] = (counts[name] ?? 0) + 1;
        return counts;
      }, {}),
    [draftSystemPrompts, ui],
  );
  const getSystemPromptTabLabel = (prompt: SystemPrompt, index: number) => {
    const name = prompt.name.trim() || ui.systemPromptNamePlaceholder(index + 1);

    if ((systemPromptNameCounts[name] ?? 0) <= 1) {
      return name;
    }

    const duplicateIndex =
      draftSystemPrompts
        .slice(0, index + 1)
        .filter(
          (item, itemIndex) =>
            (item.name.trim() ||
              ui.systemPromptNamePlaceholder(itemIndex + 1)) === name,
        ).length;

    return `${name} #${duplicateIndex}`;
  };
  const stopEditingSystemPromptName = () => {
    setEditingSystemPromptIndex(null);
    setEditingSystemPromptTabWidth(null);
  };
  const editableResultTexts =
    draftResultTexts.length > 0 ? draftResultTexts : [""];
  const fileResultAccept =
    selectedTopicKind === "image"
      ? "image/*"
      : selectedTopicKind === "audio"
        ? ".mp3,.wav,.m4a,.aac,.flac,.ogg,.oga,.opus,.aif,.aiff,audio/mpeg,audio/wav,audio/x-wav,audio/aac,audio/flac,audio/ogg,audio/opus"
        : ".mp4,.mov,.webm,.mkv,.m4v,video/*";
  const fileUploadHint =
    selectedTopicKind === "image"
      ? ui.pasteImageHint
      : ui.chooseResultFileHint;
  const ResultFileIcon =
    selectedTopicKind === "audio"
      ? Mic
      : selectedTopicKind === "video"
        ? Video
        : ImagePlus;
  const isResultItemDragEvent = (
    selector: string,
    event: DragEvent<HTMLDivElement>,
  ) => {
    const target = event.target;

    if (!(target instanceof Element)) {
      return false;
    }

    const item = target.closest(selector);
    return Boolean(item && event.currentTarget.contains(item));
  };
  const dragOverResultTextList = (event: DragEvent<HTMLDivElement>) => {
    const lastIndex = editableResultTexts.length - 1;

    if (
      isFullyReadOnly ||
      draggedResultTextIndex === null ||
      lastIndex < 0 ||
      isResultItemDragEvent(".result-text-item", event)
    ) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setResultTextDropPreview((current) =>
      current?.index === lastIndex && current.position === "after"
        ? current
        : { index: lastIndex, position: "after" },
    );
  };
  const dropResultTextList = (event: DragEvent<HTMLDivElement>) => {
    const lastIndex = editableResultTexts.length - 1;

    if (lastIndex < 0 || isResultItemDragEvent(".result-text-item", event)) {
      return;
    }

    dropResultText(lastIndex, event, true);
  };
  const dragOverImageGrid = (event: DragEvent<HTMLDivElement>) => {
    const lastImageId = draftImages[draftImages.length - 1]?.id;

    if (
      isFullyReadOnly ||
      !draggedImageId ||
      !lastImageId ||
      isResultItemDragEvent(".image-tile", event)
    ) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setImageDropPreview((current) =>
      current?.imageId === lastImageId && current.position === "after"
        ? current
        : { imageId: lastImageId, position: "after" },
    );
  };
  const dropImageGrid = (event: DragEvent<HTMLDivElement>) => {
    const lastImageId = draftImages[draftImages.length - 1]?.id;

    if (!lastImageId || isResultItemDragEvent(".image-tile", event)) {
      return;
    }

    dropImage(lastImageId, event, true);
  };

  useEffect(() => {
    const previousCount = previousSystemPromptCountRef.current;

    if (draftSystemPrompts.length > previousCount) {
      setActiveSystemPromptIndex(draftSystemPrompts.length - 1);
    } else if (activeSystemPromptIndex >= draftSystemPrompts.length) {
      setActiveSystemPromptIndex(Math.max(0, draftSystemPrompts.length - 1));
    }

    previousSystemPromptCountRef.current = draftSystemPrompts.length;
  }, [activeSystemPromptIndex, draftSystemPrompts.length]);

  useEffect(() => {
    systemPromptTabRefs.current[normalizedActiveSystemPromptIndex]?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "nearest",
    });
  }, [draftSystemPrompts.length, normalizedActiveSystemPromptIndex]);

  useEffect(() => {
    if (editingSystemPromptIndex === null) {
      return;
    }

    if (editingSystemPromptIndex >= draftSystemPrompts.length) {
      stopEditingSystemPromptName();
      return;
    }

    systemPromptTabNameInputRef.current?.focus();
    systemPromptTabNameInputRef.current?.select();
  }, [draftSystemPrompts.length, editingSystemPromptIndex]);

  const renderResultTextDropPreview = (
    targetIndex: number,
    position: DropPreviewPosition,
  ) => {
    if (draggedResultTextIndex === null) {
      return null;
    }

    const resultText = editableResultTexts[draggedResultTextIndex] ?? "";

    return (
      <div
        className="result-text-item result-drop-preview-slot drop-preview-ghost"
        onDragOver={(event) =>
          dragOverResultText(targetIndex, event, position)
        }
        onDrop={(event) =>
          dropResultText(targetIndex, event, position === "after")
        }
        aria-hidden="true"
      >
        <div className="field-title-row result-text-item-title">
          <span className="result-item-title-label">
            {editableResultTexts.length > 1 ? (
              <span className="result-drag-handle">
                <GripVertical size={13} />
              </span>
            ) : null}
            <span>{ui.resultTextIndex(draggedResultTextIndex + 1)}</span>
          </span>
        </div>
        <textarea
          value={resultText}
          readOnly
          tabIndex={-1}
          aria-label={ui.resultTextIndex(draggedResultTextIndex + 1)}
        />
      </div>
    );
  };
  const renderImageDropPreview = (
    targetImageId: string,
    position: DropPreviewPosition,
  ) => {
    const image = draftImages.find((item) => item.id === draggedImageId);

    if (!image) {
      return null;
    }

    const mediaKind = getResultMediaKind(image);

    return (
      <figure
        className={`image-tile ${mediaKind}-tile image-drop-preview-slot drop-preview-ghost`}
        onDragOver={(event) => dragOverImage(targetImageId, event, position)}
        onDrop={(event) =>
          dropImage(targetImageId, event, position === "after")
        }
        aria-hidden="true"
      >
        <ResultMediaPreview audioGroupId={audioGroupId} media={image} />
        <figcaption>
          <span className="result-item-title-label">
            {draftImages.length > 1 ? (
              <span className="result-drag-handle">
                <GripVertical size={13} />
              </span>
            ) : null}
            <span>{image.name}</span>
          </span>
        </figcaption>
      </figure>
    );
  };
  const renderFloatingDragOverlay = () => {
    if (!floatingDragOverlay) {
      return null;
    }

    const overlayStyle = {
      left: floatingDragOverlay.x - floatingDragOverlay.offsetX,
      top: floatingDragOverlay.y - floatingDragOverlay.offsetY,
      width: floatingDragOverlay.width,
    };

    if (floatingDragOverlay.kind === "result-text") {
      const resultText = editableResultTexts[floatingDragOverlay.index] ?? "";

      return (
        <div className="drag-floating-preview" style={overlayStyle}>
          <div className="result-text-item floating-preview-item">
            <div className="field-title-row result-text-item-title">
              <span className="result-item-title-label">
                {editableResultTexts.length > 1 ? (
                  <span className="result-drag-handle">
                    <GripVertical size={13} />
                  </span>
                ) : null}
                <span>{ui.resultTextIndex(floatingDragOverlay.index + 1)}</span>
              </span>
            </div>
            <textarea
              value={resultText}
              readOnly
              tabIndex={-1}
              aria-label={ui.resultTextIndex(floatingDragOverlay.index + 1)}
            />
          </div>
        </div>
      );
    }

    const image = draftImages.find(
      (item) => item.id === floatingDragOverlay.imageId,
    );

    if (!image) {
      return null;
    }

    const mediaKind = getResultMediaKind(image);

    return (
      <div className="drag-floating-preview" style={overlayStyle}>
        <figure className={`image-tile ${mediaKind}-tile floating-preview-item`}>
          <ResultMediaPreview audioGroupId={audioGroupId} media={image} />
          <figcaption>
            <span className="result-item-title-label">
              {draftImages.length > 1 ? (
                <span className="result-drag-handle">
                  <GripVertical size={13} />
                </span>
              ) : null}
              <span>{image.name}</span>
            </span>
          </figcaption>
        </figure>
      </div>
    );
  };

  return (
    <section
      className="panel editor-panel"
      onDragOver={updateFloatingDragOverlayPosition}
    >
      {renderFloatingDragOverlay()}
      <div className="panel-heading">
        <h3>{panelTitle}</h3>
        <span>
          {ui.promptChars(
            (systemPromptCharCount + draftUserPrompt.length).toLocaleString(),
            selectedTopicKind === "text"
              ? resultTextCharCount.toLocaleString()
              : undefined,
          )}
        </span>
      </div>
      <div className={`write-model-picker ${isPromptLocked ? "locked" : ""}`}>
        <TagPopoverSelect
          addLabel={ui.addModel}
          disabled={isPromptLocked}
          emptyLabel={ui.noModelOptions}
          label={ui.currentModels}
          options={modelOptions}
          placeholder={ui.modelPickerPlaceholder}
          removeLabel={ui.removeModelAria}
          value={selectedModelIds}
          onChange={onModelChange}
        />
      </div>
      <label>
        {ui.versionName}
        <input
          value={draftLabel}
          readOnly={isFullyReadOnly}
          onChange={(event) => onDraftLabelChange(event.target.value)}
          placeholder={ui.versionNamePlaceholder}
        />
      </label>
      <div className={`editor-field system-prompt-field ${isPromptLocked ? "locked" : ""}`}>
        <div className="field-title-row">
          <span>{ui.systemPrompt}</span>
          <div className="field-actions">
            {!isPromptLocked && draftSystemPrompts.length > 1 ? (
              <button
                type="button"
                className="field-action-button danger"
                onClick={() =>
                  onRemoveDraftSystemPrompt(normalizedActiveSystemPromptIndex)
                }
                aria-label={ui.deleteSystemPromptAria(
                  activeSystemPrompt?.name.trim() ||
                    ui.systemPromptIndex(normalizedActiveSystemPromptIndex + 1),
                )}
                title={ui.deleteSystemPromptAria(
                  activeSystemPrompt?.name.trim() ||
                    ui.systemPromptIndex(normalizedActiveSystemPromptIndex + 1),
                )}
              >
                <Trash2 aria-hidden="true" size={14} />
              </button>
            ) : null}
            <button
              type="button"
              className="field-action-button"
              onClick={() => selectTextarea(systemPromptTextareaRef.current)}
              aria-label={ui.selectSystemPromptItemAria(
                normalizedActiveSystemPromptIndex + 1,
              )}
              title={ui.selectSystemPromptItemAria(
                normalizedActiveSystemPromptIndex + 1,
              )}
            >
              <TextSelect aria-hidden="true" size={14} />
              <span>{ui.selectAll}</span>
            </button>
            <button
              type="button"
              className="field-action-button"
              disabled={isPromptLocked}
              onClick={onAddDraftSystemPrompt}
              aria-label={ui.addSystemPrompt}
              title={ui.addSystemPrompt}
            >
              <Plus aria-hidden="true" size={14} />
              <span>{ui.add}</span>
            </button>
            <button
              type="button"
              className="field-action-button"
              disabled={isPromptLocked}
              onClick={onResetDraftSystemPrompts}
              aria-label={ui.resetSystemPromptsAria}
              title={ui.resetSystemPromptsAria}
            >
              <Undo2 aria-hidden="true" size={14} />
              <span>{ui.reset}</span>
            </button>
          </div>
        </div>
        <div className="system-prompt-tab-shell">
          <div className="system-prompt-tabs" role="tablist" aria-label={ui.systemPrompt}>
            {draftSystemPrompts.map((systemPrompt, index) => {
              const tabLabel = getSystemPromptTabLabel(systemPrompt, index);
              const isActive = index === normalizedActiveSystemPromptIndex;
              const isEditing = index === editingSystemPromptIndex;

              return (
                <div
                  ref={(element) => {
                    systemPromptTabRefs.current[index] = element;
                  }}
                  className={`system-prompt-tab ${isActive ? "active" : ""}`}
                  key={systemPrompt.id}
                >
                  {isEditing ? (
                    <input
                      ref={systemPromptTabNameInputRef}
                      className="system-prompt-tab-input"
                      style={{
                        width: editingSystemPromptTabWidth
                          ? `${editingSystemPromptTabWidth}px`
                          : undefined,
                      }}
                      value={systemPrompt.name}
                      onBlur={stopEditingSystemPromptName}
                      onChange={(event) =>
                        onDraftSystemPromptNameChange(index, event.target.value)
                      }
                      onClick={(event) => event.stopPropagation()}
                      onDoubleClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === "Escape") {
                          event.currentTarget.blur();
                        }
                      }}
                      placeholder={ui.systemPromptNamePlaceholder(index + 1)}
                      aria-label={ui.systemPromptNameAria(index + 1)}
                    />
                  ) : (
                    <button
                      type="button"
                      className="system-prompt-tab-button"
                      role="tab"
                      aria-selected={isActive}
                      onClick={() => setActiveSystemPromptIndex(index)}
                      onDoubleClick={() => {
                        if (!isPromptLocked) {
                          setActiveSystemPromptIndex(index);
                          setEditingSystemPromptTabWidth(
                            systemPromptTabRefs.current[index]?.offsetWidth ??
                              null,
                          );
                          setEditingSystemPromptIndex(index);
                        }
                      }}
                      title={tabLabel}
                    >
                      {tabLabel}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          {activeSystemPrompt ? (
            <div className="system-prompt-item" role="tabpanel">
              <textarea
                ref={systemPromptTextareaRef}
                value={activeSystemPrompt.body}
                readOnly={isPromptLocked}
                onChange={(event) =>
                  onDraftSystemPromptBodyChange(
                    normalizedActiveSystemPromptIndex,
                    event.target.value,
                  )
                }
                placeholder={ui.systemPrompt}
                aria-label={ui.systemPromptIndex(
                  normalizedActiveSystemPromptIndex + 1,
                )}
              />
            </div>
          ) : null}
        </div>
      </div>
      <div className={`editor-field user-prompt-field ${isPromptLocked ? "locked" : ""}`}>
        <div className="field-title-row">
          <span>{ui.userPrompt}</span>
          <div className="field-actions">
            <button
              type="button"
              className="field-action-button"
              onClick={() => selectTextarea(userPromptTextareaRef.current)}
              aria-label={ui.selectUserPromptAria}
              title={ui.selectUserPromptAria}
            >
              <TextSelect aria-hidden="true" size={14} />
              <span>{ui.selectAll}</span>
            </button>
            <button
              type="button"
              className="field-action-button"
              disabled={isPromptLocked}
              onClick={() => onDraftUserPromptChange(previousUserPrompt)}
              aria-label={ui.resetUserPromptAria}
              title={ui.resetUserPromptAria}
            >
              <Undo2 aria-hidden="true" size={14} />
              <span>{ui.reset}</span>
            </button>
          </div>
        </div>
        <textarea
          ref={userPromptTextareaRef}
          value={draftUserPrompt}
          readOnly={isPromptLocked}
          onChange={(event) => onDraftUserPromptChange(event.target.value)}
          placeholder={ui.userPromptPlaceholder}
          aria-label={ui.userPrompt}
        />
      </div>
      <label>
        {ui.notes}
        <textarea
          value={draftNotes}
          readOnly={isFullyReadOnly}
          onChange={(event) => onDraftNotesChange(event.target.value)}
          placeholder={ui.notesPlaceholder}
          rows={3}
        />
      </label>
      {selectedTopicKind === "text" ? (
        <div className={`editor-field result-text-field ${isFullyReadOnly ? "locked" : ""}`}>
          <div className="field-title-row">
            <span>{ui.resultText}</span>
            <div className="field-actions">
              <button
                type="button"
                className="field-action-button"
                disabled={isFullyReadOnly}
                onClick={onAddDraftResultText}
                aria-label={ui.addResultText}
                title={ui.addResultText}
              >
                <Plus aria-hidden="true" size={14} />
                <span>{ui.add}</span>
              </button>
              <button
                type="button"
                className="field-action-button"
                disabled={isFullyReadOnly}
                onClick={onResetDraftResultTexts}
                aria-label={ui.resetResultTextAria}
                title={ui.resetResultTextAria}
              >
                <Undo2 aria-hidden="true" size={14} />
                <span>{ui.reset}</span>
              </button>
            </div>
          </div>
          <div
            className="result-text-list"
            onDragOver={dragOverResultTextList}
            onDrop={dropResultTextList}
          >
            {editableResultTexts.map((resultText, index) => {
              const showDropPreviewBefore =
                resultTextDropPreview?.index === index &&
                resultTextDropPreview.position === "before";
              const showDropPreviewAfter =
                resultTextDropPreview?.index === index &&
                resultTextDropPreview.position === "after";

              return (
                <Fragment key={index}>
                  {showDropPreviewBefore
                    ? renderResultTextDropPreview(index, "before")
                    : null}
                  <div
                    className={`result-text-item ${
                      draggedResultTextIndex === index && dragSourceHidden
                        ? "drag-layout-hidden"
                        : ""
                    }`}
                    onDragOver={(event) => dragOverResultText(index, event)}
                    onDrop={(event) => dropResultText(index, event)}
                  >
                    <div className="field-title-row result-text-item-title">
                      <span className="result-item-title-label">
                        {!isFullyReadOnly && editableResultTexts.length > 1 ? (
                          <span
                            className="result-drag-handle"
                            draggable
                            onDragStart={(event) =>
                              startResultTextDrag(index, event)
                            }
                            onDrag={(event) => dragResultText(index, event)}
                            onDragEnd={() => {
                              cancelFloatingDragOverlayFrame();
                              cancelDragSourceHideFrame();
                              setDragSourceHidden(false);
                              setDraggedResultTextIndex(null);
                              setResultTextDropPreview(null);
                              setFloatingDragOverlay(null);
                              clearTransparentResultDragImage();
                            }}
                            aria-hidden="true"
                          >
                            <GripVertical size={13} />
                          </span>
                        ) : null}
                        <span>{ui.resultTextIndex(index + 1)}</span>
                      </span>
                      <div className="field-actions">
                        <button
                          type="button"
                          className="field-action-button"
                          onClick={() =>
                            selectTextarea(resultTextareaRefs.current[index] ?? null)
                          }
                          aria-label={ui.selectResultTextItemAria(index + 1)}
                          title={ui.selectResultTextItemAria(index + 1)}
                        >
                          <TextSelect aria-hidden="true" size={14} />
                          <span>{ui.selectAll}</span>
                        </button>
                        {isFullyReadOnly ? null : (
                          <button
                            type="button"
                            className="field-action-button danger"
                            onClick={() => onRemoveDraftResultText(index)}
                            aria-label={ui.deleteResultTextAria(index + 1)}
                            title={ui.deleteResultTextAria(index + 1)}
                          >
                            <Trash2 aria-hidden="true" size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                    <textarea
                      ref={(element) => {
                        resultTextareaRefs.current[index] = element;
                      }}
                      value={resultText}
                      readOnly={isFullyReadOnly}
                      onChange={(event) =>
                        onDraftResultTextChange(index, event.target.value)
                      }
                      placeholder={ui.resultTextPlaceholder}
                      aria-label={ui.resultTextIndex(index + 1)}
                    />
                  </div>
                  {showDropPreviewAfter
                    ? renderResultTextDropPreview(index, "after")
                    : null}
                </Fragment>
              );
            })}
          </div>
        </div>
      ) : null}

      {selectedTopicKind !== "text" ? (
      <div className="image-result-section">
        <div className="image-input-panel">
          <div className="upload-row">
            <span>{ui.resultFileCount(selectedTopicKind, draftImages.length)}</span>
          </div>
          <input
            ref={imageUploadInputRef}
            className="image-add-input"
            type="file"
            accept={fileResultAccept}
            multiple
            disabled={isFullyReadOnly}
            onChange={onImageUpload}
            tabIndex={-1}
          />
          <button
            type="button"
            className={`image-add-target ${pasteTargetActive ? "active" : ""}`}
            disabled={isFullyReadOnly}
            onClick={() => imageUploadInputRef.current?.click()}
            onFocus={() => onPasteTargetActiveChange(true)}
            onBlur={() => onPasteTargetActiveChange(false)}
            onMouseEnter={() => onPasteTargetActiveChange(true)}
            onMouseLeave={() => onPasteTargetActiveChange(false)}
          >
            <ResultFileIcon aria-hidden="true" size={18} />
            <span>
              <strong>{ui.resultFileUpload(selectedTopicKind)}</strong>
              <small>{fileUploadHint}</small>
            </span>
          </button>
        </div>

        {draftImages.length > 0 ? (
          <div
            className="image-grid compact"
            onDragOver={dragOverImageGrid}
            onDrop={dropImageGrid}
          >
            {draftImages.map((image) => {
              const mediaKind = getResultMediaKind(image);
              const showDropPreviewBefore =
                imageDropPreview?.imageId === image.id &&
                imageDropPreview.position === "before";
              const showDropPreviewAfter =
                imageDropPreview?.imageId === image.id &&
                imageDropPreview.position === "after";

              return (
                <Fragment key={image.id}>
                  {showDropPreviewBefore
                    ? renderImageDropPreview(image.id, "before")
                    : null}
                  <figure
                    className={`image-tile ${mediaKind}-tile ${
                      draggedImageId === image.id && dragSourceHidden
                        ? "drag-layout-hidden"
                        : ""
                    }`}
                    onDragOver={(event) => dragOverImage(image.id, event)}
                    onDrop={(event) => dropImage(image.id, event)}
                  >
                    <ResultMediaPreview audioGroupId={audioGroupId} media={image} />
                    <figcaption>
                      <span className="result-item-title-label">
                        {!isFullyReadOnly && draftImages.length > 1 ? (
                          <span
                            className="result-drag-handle"
                            draggable
                            onDragStart={(event) =>
                              startImageDrag(image.id, event)
                            }
                            onDrag={(event) => dragImage(image.id, event)}
                            onDragEnd={() => {
                              cancelFloatingDragOverlayFrame();
                              cancelDragSourceHideFrame();
                              setDragSourceHidden(false);
                              setDraggedImageId(null);
                              setImageDropPreview(null);
                              setFloatingDragOverlay(null);
                              clearTransparentResultDragImage();
                            }}
                            aria-hidden="true"
                          >
                            <GripVertical size={13} />
                          </span>
                        ) : null}
                        <span>{image.name}</span>
                      </span>
                      {isFullyReadOnly ? null : (
                        <button
                          type="button"
                          className="image-delete-button"
                          onClick={() => onRemoveDraftImage(image.id)}
                          aria-label={ui.deleteImageAria(image.name)}
                        >
                          <Trash2 aria-hidden="true" size={14} />
                        </button>
                      )}
                    </figcaption>
                  </figure>
                  {showDropPreviewAfter
                    ? renderImageDropPreview(image.id, "after")
                    : null}
                </Fragment>
              );
            })}
          </div>
        ) : null}
      </div>
      ) : null}
    </section>
  );
}
