import { startTransition, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight, Diff } from "lucide-react";
import type { UiMessages } from "../i18n";
import type { LineDiffRow } from "../lib/diff";
import type {
  DraftImage,
  ImageAsset,
  PromptVersion,
  PromptVersionKind,
} from "../types";
import { ImageDiffPreview, SplitDiffFiles } from "./DiffViews";
import { StarToggleButton } from "./StarToggleButton";

type PromptDiffBlock = {
  key: string;
  label: string;
  rows: LineDiffRow[];
};

const getChangedRowCount = (rows: LineDiffRow[]) =>
  rows.filter((row) => row.type !== "same").length;

type DiffPanelProps = {
  addedCount: number;
  canCompareNext: boolean;
  canComparePrevious: boolean;
  canNavigateNextVersion: boolean;
  canNavigatePreviousVersion: boolean;
  baseResultDiffCount: number;
  baseResultDiffIndex: number;
  compareBase: PromptVersion | null;
  compareBaseImages: Array<ImageAsset | DraftImage>;
  compareDirection: "previous" | "next";
  compareTargetImages: Array<ImageAsset | DraftImage>;
  compareTargetKind: PromptVersionKind;
  compareTargetLabel: string;
  compareTargetVersion: PromptVersion | null;
  removedCount: number;
  resultTextDiffRows: LineDiffRow[];
  showCompareControls: boolean;
  systemPromptDiffBlocks: PromptDiffBlock[];
  targetResultDiffCount: number;
  targetResultDiffIndex: number;
  ui: UiMessages;
  userPromptDiffRows: LineDiffRow[];
  onBaseResultDiffIndexChange: (index: number) => void;
  onCompareDirectionChange: (direction: "previous" | "next") => void;
  onNavigateNextVersion: () => void;
  onNavigatePreviousVersion: () => void;
  onTargetResultDiffIndexChange: (index: number) => void;
  onToggleGoodResult: (version: PromptVersion) => void;
};

export function DiffPanel({
  addedCount,
  baseResultDiffCount,
  baseResultDiffIndex,
  canCompareNext,
  canComparePrevious,
  canNavigateNextVersion,
  canNavigatePreviousVersion,
  compareBase,
  compareBaseImages,
  compareDirection,
  compareTargetImages,
  compareTargetKind,
  compareTargetLabel,
  compareTargetVersion,
  removedCount,
  resultTextDiffRows,
  showCompareControls,
  systemPromptDiffBlocks,
  targetResultDiffCount,
  targetResultDiffIndex,
  ui,
  userPromptDiffRows,
  onBaseResultDiffIndexChange,
  onCompareDirectionChange,
  onNavigateNextVersion,
  onNavigatePreviousVersion,
  onTargetResultDiffIndexChange,
  onToggleGoodResult,
}: DiffPanelProps) {
  const baseResultSlideDirectionRef = useRef<"next" | "previous">("next");
  const targetResultSlideDirectionRef = useRef<"next" | "previous">("next");
  const [activeSystemPromptKey, setActiveSystemPromptKey] = useState("");

  useEffect(() => {
    setActiveSystemPromptKey((currentKey) => {
      if (systemPromptDiffBlocks.some((block) => block.key === currentKey)) {
        return currentKey;
      }

      return (
        systemPromptDiffBlocks.find((block) => getChangedRowCount(block.rows) > 0)
          ?.key ??
        systemPromptDiffBlocks[0]?.key ??
        ""
      );
    });
  }, [systemPromptDiffBlocks]);

  const renderVersionTitle = (label: string, version: PromptVersion | null) => (
    <span className="diff-version-title">
      {version ? (
        <StarToggleButton
          checked={Boolean(version.isGoodResult)}
          className="diff-inline-star-toggle borderless-star-toggle"
          ui={ui}
          onClick={() => onToggleGoodResult(version)}
        />
      ) : null}
      <span>{label}</span>
    </span>
  );

  const baseTitle = renderVersionTitle(
    compareBase?.label ?? ui.noPreviousVersion,
    compareBase,
  );
  const targetTitle = renderVersionTitle(compareTargetLabel, compareTargetVersion);
  const baseAudioGroupId = `diff:base:${compareBase?.id ?? "empty"}`;
  const targetAudioGroupId = `diff:target:${compareTargetVersion?.id ?? "draft"}`;
  const showResultPreview =
    compareTargetKind === "text" ||
    compareBaseImages.length > 0 ||
    compareTargetImages.length > 0 ||
    baseResultDiffCount > 0 ||
    targetResultDiffCount > 0;
  const currentBaseResultIndex = Math.min(
    baseResultDiffIndex,
    Math.max(0, baseResultDiffCount - 1),
  );
  const currentTargetResultIndex = Math.min(
    targetResultDiffIndex,
    Math.max(0, targetResultDiffCount - 1),
  );
  const renderResultControls = (
    count: number,
    currentIndex: number,
    onIndexChange: (index: number) => void,
    onDirectionChange: (direction: "next" | "previous") => void,
  ) => {
    if (count <= 1) {
      return null;
    }

    const goToPreviousResult = () => {
      startTransition(() => {
        onDirectionChange("previous");
        onIndexChange(currentIndex === 0 ? count - 1 : currentIndex - 1);
      });
    };
    const goToNextResult = () => {
      startTransition(() => {
        onDirectionChange("next");
        onIndexChange((currentIndex + 1) % count);
      });
    };
    const goToResult = (index: number) => {
      if (index === currentIndex) {
        return;
      }

      const direction =
        currentIndex === count - 1 && index === 0
          ? "next"
          : currentIndex === 0 && index === count - 1
            ? "previous"
            : index > currentIndex
              ? "next"
              : "previous";

      startTransition(() => {
        onDirectionChange(direction);
        onIndexChange(index);
      });
    };

    return (
      <span className="result-gallery-controls">
        <button
          type="button"
          className="result-gallery-arrow"
          onClick={goToPreviousResult}
          aria-label={ui.previousResultAria}
        >
          <ChevronLeft aria-hidden="true" size={14} />
        </button>
        <span className="result-gallery-dots" aria-label={ui.resultGalleryAria}>
          {Array.from({ length: count }, (_item, index) => (
            <button
              type="button"
              key={index}
              className={index === currentIndex ? "active" : ""}
              onClick={() => goToResult(index)}
              aria-label={ui.resultDotAria(index + 1)}
            />
          ))}
        </span>
        <button
          type="button"
          className="result-gallery-arrow"
          onClick={goToNextResult}
          aria-label={ui.nextResultAria}
        >
          <ChevronRight aria-hidden="true" size={14} />
        </button>
      </span>
    );
  };
  const baseResultControls = renderResultControls(
    baseResultDiffCount,
    currentBaseResultIndex,
    onBaseResultDiffIndexChange,
    (direction) => {
      baseResultSlideDirectionRef.current = direction;
    },
  );
  const targetResultControls = renderResultControls(
    targetResultDiffCount,
    currentTargetResultIndex,
    onTargetResultDiffIndexChange,
    (direction) => {
      targetResultSlideDirectionRef.current = direction;
    },
  );
  const showResultControlsHeader = Boolean(
    baseResultControls || targetResultControls,
  );
  const showVersionNavigationControls = Boolean(
    canNavigatePreviousVersion || canNavigateNextVersion,
  );
  const resultLabel = (
    <div className="result-diff-label">
      <span>{ui.result}</span>
    </div>
  );
  const renderPromptDiffBlock = (
    label: string,
    rows: LineDiffRow[],
    key?: string,
    isPrimary = false,
    tabs?: ReactNode,
  ) => (
    <div
      className={`prompt-diff-block ${isPrimary ? "primary-prompt-diff-block" : ""}`.trim()}
      key={key}
    >
      <div className={`prompt-diff-label ${tabs ? "with-tabs" : ""}`.trim()}>
        <span className="prompt-diff-label-text">{label}</span>
        {tabs}
      </div>
      <SplitDiffFiles
        ariaLabel={ui.promptDiffAria}
        baseTitle={baseTitle}
        className="prompt-diff-preview"
        showHeaders={false}
        targetTitle={targetTitle}
        rows={rows}
        emptyLabel={ui.emptyContent}
      />
    </div>
  );
  const activeSystemPromptBlock =
    systemPromptDiffBlocks.find((block) => block.key === activeSystemPromptKey) ??
    systemPromptDiffBlocks[0] ??
    null;
  const selectSystemPromptTab = (key: string) => {
    if (key === activeSystemPromptBlock?.key) {
      return;
    }

    startTransition(() => {
      setActiveSystemPromptKey(key);
    });
  };
  const systemPromptTabs =
    systemPromptDiffBlocks.length > 1 ? (
      <div className="prompt-diff-tabs" aria-label={ui.systemPrompt}>
        {systemPromptDiffBlocks.map((block) => {
          const changedRowCount = getChangedRowCount(block.rows);

          return (
            <button
              type="button"
              className={block.key === activeSystemPromptBlock?.key ? "active" : ""}
              key={block.key}
              onClick={() => selectSystemPromptTab(block.key)}
            >
              <span>{block.label}</span>
              {changedRowCount > 0 ? <b>{changedRowCount}</b> : null}
            </button>
          );
        })}
      </div>
    ) : null;

  return (
    <section className="panel diff-panel">
      <div className="diff-titlebar">
        <div className="editor-tab active">
          <Diff aria-hidden="true" size={15} />
          {"prompt.diff"}
        </div>
        {showCompareControls ? (
          <div className="diff-compare-controls" aria-label={ui.compareDirection}>
            <button
              type="button"
              className={compareDirection === "previous" ? "active" : ""}
              disabled={!canComparePrevious}
              onClick={() =>
                startTransition(() => onCompareDirectionChange("previous"))
              }
            >
              {ui.comparePrevious}
            </button>
            <button
              type="button"
              className={compareDirection === "next" ? "active" : ""}
              disabled={!canCompareNext}
              onClick={() =>
                startTransition(() => onCompareDirectionChange("next"))
              }
            >
              {ui.compareNext}
            </button>
          </div>
        ) : null}
        <div className="diff-title-actions">
          {showVersionNavigationControls ? (
            <div
              className="diff-version-navigation"
              aria-label={ui.versionNavigationAria}
            >
              <button
                type="button"
                disabled={!canNavigatePreviousVersion}
                onClick={() => startTransition(onNavigatePreviousVersion)}
                aria-label={ui.previousVersionAria}
                title={ui.previousVersionAria}
              >
                <ChevronLeft aria-hidden="true" size={14} />
              </button>
              <button
                type="button"
                disabled={!canNavigateNextVersion}
                onClick={() => startTransition(onNavigateNextVersion)}
                aria-label={ui.nextVersionAria}
                title={ui.nextVersionAria}
              >
                <ChevronRight aria-hidden="true" size={14} />
              </button>
            </div>
          ) : null}
          <div className="diff-summary">
            <span className="added">+{addedCount}</span>
            <span className="removed">-{removedCount}</span>
          </div>
        </div>
      </div>
      <div
        className={`diff-panel-body ${
          showResultPreview ? "with-result-preview" : ""
        }`}
      >
        <div className="diff-version-header-row">
          <div className="diff-version-header-cell">{baseTitle}</div>
          <div className="diff-version-header-cell">{targetTitle}</div>
        </div>
        <div className="prompt-diff-section">
          {activeSystemPromptBlock
            ? renderPromptDiffBlock(
                ui.systemPrompt,
                activeSystemPromptBlock.rows,
                "system-prompt-diff",
                true,
                systemPromptTabs,
              )
            : null}
          {renderPromptDiffBlock(ui.userPrompt, userPromptDiffRows)}
        </div>
        {compareTargetKind === "text" ? (
          <div className="result-diff-section">
            {resultLabel}
            <SplitDiffFiles
              ariaLabel={ui.resultTextDiffAria}
              baseTitle={baseResultControls}
              className="result-text-diff-preview"
              showHeaders={showResultControlsHeader}
              targetTitle={targetResultControls}
              rows={resultTextDiffRows}
              emptyLabel={ui.emptyContent}
            />
          </div>
        ) : baseResultDiffCount > 0 || targetResultDiffCount > 0 ? (
          <div className="result-diff-section">
            {resultLabel}
            <ImageDiffPreview
              ariaLabel={ui.resultFileDiffAria}
              baseActiveIndex={currentBaseResultIndex}
              baseAudioGroupId={baseAudioGroupId}
              baseTitle={baseResultControls}
              className="result-file-diff-preview"
              baseSlideDirection={baseResultSlideDirectionRef.current}
              showHeaders={showResultControlsHeader}
              targetActiveIndex={currentTargetResultIndex}
              targetAudioGroupId={targetAudioGroupId}
              targetTitle={targetResultControls}
              targetSlideDirection={targetResultSlideDirectionRef.current}
              baseImages={compareBaseImages}
              targetImages={compareTargetImages}
              emptyLabel={ui.emptyResultFile}
            />
          </div>
        ) : null}
      </div>
    </section>
  );
}
