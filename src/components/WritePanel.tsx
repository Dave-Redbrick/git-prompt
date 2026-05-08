import {
  ImagePlus,
  Mic,
  Plus,
  TextSelect,
  Trash2,
  Undo2,
  Video,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
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
  onResetDraftResultTexts: () => void;
  onResetDraftSystemPrompts: () => void;
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

  return (
    <section className="panel editor-panel">
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
          <div className="result-text-list">
            {editableResultTexts.map((resultText, index) => (
              <div className="result-text-item" key={index}>
                <div className="field-title-row result-text-item-title">
                  <span>{ui.resultTextIndex(index + 1)}</span>
                  <div className="field-actions">
                    <button
                      type="button"
                      className="field-action-button"
                      onClick={() => selectTextarea(resultTextareaRefs.current[index] ?? null)}
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
            ))}
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
          <div className="image-grid compact">
            {draftImages.map((image) => (
              <figure
                key={image.id}
                className={`image-tile ${getResultMediaKind(image)}-tile`}
              >
                <ResultMediaPreview audioGroupId={audioGroupId} media={image} />
                <figcaption>
                  <span>{image.name}</span>
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
            ))}
          </div>
        ) : null}
      </div>
      ) : null}
    </section>
  );
}
