import {
  ImagePlus,
  Mic,
  Plus,
  TextSelect,
  Trash2,
  Undo2,
  Video,
} from "lucide-react";
import { useRef } from "react";
import type {
  ChangeEvent,
  ClipboardEvent as ReactClipboardEvent,
} from "react";
import type { UiMessages } from "../i18n";
import type { DraftImage, PromptVersionKind, TopicModelId } from "../types";
import { pauseOtherAudioInGroup } from "../lib/audioPlayback";
import { getResultMediaKind } from "../lib/promptVersions";
import { TagPopoverSelect, type TagPopoverOption } from "./TagPopoverSelect";

type WritePanelProps = {
  draftBody: string;
  draftImages: DraftImage[];
  draftLabel: string;
  draftNotes: string;
  draftResultTexts: string[];
  draftUserPrompt: string;
  audioGroupId: string;
  isVersionEdit?: boolean;
  isVersionView?: boolean;
  modelOptions: TagPopoverOption[];
  pasteTargetActive: boolean;
  previousBody: string;
  previousUserPrompt: string;
  selectedModelIds: TopicModelId[];
  selectedTopicKind: PromptVersionKind;
  ui: UiMessages;
  onDraftBodyChange: (value: string) => void;
  onDraftLabelChange: (value: string) => void;
  onDraftNotesChange: (value: string) => void;
  onAddDraftResultText: () => void;
  onDraftResultTextChange: (index: number, value: string) => void;
  onDraftUserPromptChange: (value: string) => void;
  onImagePaste: (event: ReactClipboardEvent<HTMLButtonElement>) => void;
  onImageUpload: (event: ChangeEvent<HTMLInputElement>) => void;
  onModelChange: (value: string[]) => void;
  onPasteTargetActiveChange: (active: boolean) => void;
  onRemoveDraftImage: (imageId: string) => void;
  onRemoveDraftResultText: (index: number) => void;
  onResetDraftResultTexts: () => void;
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
  draftBody,
  draftImages,
  draftLabel,
  draftNotes,
  draftResultTexts,
  draftUserPrompt,
  audioGroupId,
  isVersionEdit = false,
  isVersionView = false,
  modelOptions,
  pasteTargetActive,
  previousBody,
  previousUserPrompt,
  selectedModelIds,
  selectedTopicKind,
  ui,
  onDraftBodyChange,
  onDraftLabelChange,
  onDraftNotesChange,
  onAddDraftResultText,
  onDraftResultTextChange,
  onDraftUserPromptChange,
  onImagePaste,
  onImageUpload,
  onModelChange,
  onPasteTargetActiveChange,
  onRemoveDraftImage,
  onRemoveDraftResultText,
  onResetDraftResultTexts,
}: WritePanelProps) {
  const imageUploadInputRef = useRef<HTMLInputElement>(null);
  const promptTextareaRef = useRef<HTMLTextAreaElement>(null);
  const resultTextareaRefs = useRef<Array<HTMLTextAreaElement | null>>([]);
  const userPromptTextareaRef = useRef<HTMLTextAreaElement>(null);
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

  return (
    <section className="panel editor-panel">
      <div className="panel-heading">
        <h3>{panelTitle}</h3>
        <span>
          {ui.promptChars(
            (draftBody.length + draftUserPrompt.length).toLocaleString(),
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
      <div className={`editor-field ${isPromptLocked ? "locked" : ""}`}>
        <div className="field-title-row">
          <span>{ui.systemPrompt}</span>
          <div className="field-actions">
            <button
              type="button"
              className="field-action-button"
              onClick={() => selectTextarea(promptTextareaRef.current)}
              aria-label={ui.selectPromptAria}
              title={ui.selectPromptAria}
            >
              <TextSelect aria-hidden="true" size={14} />
              <span>{ui.selectAll}</span>
            </button>
            <button
              type="button"
              className="field-action-button"
              disabled={isPromptLocked}
              onClick={() => onDraftBodyChange(previousBody)}
              aria-label={ui.resetPromptAria}
              title={ui.resetPromptAria}
            >
              <Undo2 aria-hidden="true" size={14} />
              <span>{ui.reset}</span>
            </button>
          </div>
        </div>
        <textarea
          ref={promptTextareaRef}
          value={draftBody}
          readOnly={isPromptLocked}
          onChange={(event) => onDraftBodyChange(event.target.value)}
          placeholder={ui.promptPlaceholder}
          aria-label={ui.systemPrompt}
        />
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
            onPaste={
              isFullyReadOnly || selectedTopicKind !== "image"
                ? undefined
                : onImagePaste
            }
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
