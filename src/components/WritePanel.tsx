import { ImagePlus, TextSelect, Trash2, Undo2 } from "lucide-react";
import { useRef } from "react";
import type {
  ChangeEvent,
  ClipboardEvent as ReactClipboardEvent,
} from "react";
import type { UiMessages } from "../i18n";
import type { DraftImage, PromptVersionKind, TopicModelId } from "../types";
import { TagPopoverSelect, type TagPopoverOption } from "./TagPopoverSelect";

type WritePanelProps = {
  draftBody: string;
  draftImages: DraftImage[];
  draftLabel: string;
  draftNotes: string;
  draftResultText: string;
  modelOptions: TagPopoverOption[];
  pasteTargetActive: boolean;
  previousBody: string;
  previousResultText: string;
  selectedModelIds: TopicModelId[];
  selectedTopicKind: PromptVersionKind;
  ui: UiMessages;
  onDraftBodyChange: (value: string) => void;
  onDraftLabelChange: (value: string) => void;
  onDraftNotesChange: (value: string) => void;
  onDraftResultTextChange: (value: string) => void;
  onImagePaste: (event: ReactClipboardEvent<HTMLButtonElement>) => void;
  onImageUpload: (event: ChangeEvent<HTMLInputElement>) => void;
  onModelChange: (value: string[]) => void;
  onPasteTargetActiveChange: (active: boolean) => void;
  onRemoveDraftImage: (imageId: string) => void;
};

export function WritePanel({
  draftBody,
  draftImages,
  draftLabel,
  draftNotes,
  draftResultText,
  modelOptions,
  pasteTargetActive,
  previousBody,
  previousResultText,
  selectedModelIds,
  selectedTopicKind,
  ui,
  onDraftBodyChange,
  onDraftLabelChange,
  onDraftNotesChange,
  onDraftResultTextChange,
  onImagePaste,
  onImageUpload,
  onModelChange,
  onPasteTargetActiveChange,
  onRemoveDraftImage,
}: WritePanelProps) {
  const imageUploadInputRef = useRef<HTMLInputElement>(null);
  const promptTextareaRef = useRef<HTMLTextAreaElement>(null);
  const resultTextareaRef = useRef<HTMLTextAreaElement>(null);

  const selectTextarea = (textarea: HTMLTextAreaElement | null) => {
    textarea?.focus();
    textarea?.select();
  };

  return (
    <section className="panel editor-panel">
      <div className="panel-heading">
        <h3>{ui.write}</h3>
        <span>
          {ui.promptChars(
            draftBody.length.toLocaleString(),
            selectedTopicKind === "text"
              ? draftResultText.length.toLocaleString()
              : undefined,
          )}
        </span>
      </div>
      <div className="write-model-picker">
        <TagPopoverSelect
          addLabel={ui.addModel}
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
          onChange={(event) => onDraftLabelChange(event.target.value)}
          placeholder={ui.versionNamePlaceholder}
        />
      </label>
      <div className="editor-field">
        <div className="field-title-row">
          <span>{ui.prompt}</span>
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
          onChange={(event) => onDraftBodyChange(event.target.value)}
          placeholder={ui.promptPlaceholder}
          aria-label={ui.prompt}
        />
      </div>
      {selectedTopicKind === "text" ? (
        <div className="editor-field result-text-field">
          <div className="field-title-row">
            <span>{ui.resultText}</span>
            <div className="field-actions">
              <button
                type="button"
                className="field-action-button"
                onClick={() => selectTextarea(resultTextareaRef.current)}
                aria-label={ui.selectResultTextAria}
                title={ui.selectResultTextAria}
              >
                <TextSelect aria-hidden="true" size={14} />
                <span>{ui.selectAll}</span>
              </button>
              <button
                type="button"
                className="field-action-button"
                onClick={() => onDraftResultTextChange(previousResultText)}
                aria-label={ui.resetResultTextAria}
                title={ui.resetResultTextAria}
              >
                <Undo2 aria-hidden="true" size={14} />
                <span>{ui.reset}</span>
              </button>
            </div>
          </div>
          <textarea
            ref={resultTextareaRef}
            value={draftResultText}
            onChange={(event) => onDraftResultTextChange(event.target.value)}
            placeholder={ui.resultTextPlaceholder}
            aria-label={ui.resultText}
          />
        </div>
      ) : null}
      <label>
        {ui.notes}
        <textarea
          value={draftNotes}
          onChange={(event) => onDraftNotesChange(event.target.value)}
          placeholder={ui.notesPlaceholder}
          rows={3}
        />
      </label>

      {selectedTopicKind === "image" ? (
        <div className="image-result-section">
          <div className="image-input-panel">
            <div className="upload-row">
              <span>{ui.resultImageCount(draftImages.length)}</span>
            </div>
            <input
              ref={imageUploadInputRef}
              className="image-add-input"
              type="file"
              accept="image/*"
              multiple
              onChange={onImageUpload}
              tabIndex={-1}
            />
            <button
              type="button"
              className={`image-add-target ${pasteTargetActive ? "active" : ""}`}
              onClick={() => imageUploadInputRef.current?.click()}
              onFocus={() => onPasteTargetActiveChange(true)}
              onBlur={() => onPasteTargetActiveChange(false)}
              onPaste={onImagePaste}
            >
              <ImagePlus aria-hidden="true" size={18} />
              <span>
                <strong>{ui.resultImageUpload}</strong>
                <small>{ui.pasteImageHint}</small>
              </span>
            </button>
          </div>

          {draftImages.length > 0 ? (
            <div className="image-grid compact">
              {draftImages.map((image) => (
                <figure key={image.id} className="image-tile">
                  <img src={image.dataUrl} alt={image.name} />
                  <figcaption>
                    <span>{image.name}</span>
                    <button
                      type="button"
                      className="image-delete-button"
                      onClick={() => onRemoveDraftImage(image.id)}
                      aria-label={ui.deleteImageAria(image.name)}
                    >
                      <Trash2 aria-hidden="true" size={14} />
                    </button>
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
