import { Diff } from "lucide-react";
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

type DiffPanelProps = {
  addedCount: number;
  canCompareNext: boolean;
  canComparePrevious: boolean;
  compareBase: PromptVersion | null;
  compareBaseImages: Array<ImageAsset | DraftImage>;
  compareDirection: "previous" | "next";
  compareTargetImages: Array<ImageAsset | DraftImage>;
  compareTargetKind: PromptVersionKind;
  compareTargetLabel: string;
  compareTargetVersion: PromptVersion | null;
  lineDiffRows: LineDiffRow[];
  removedCount: number;
  showCompareControls: boolean;
  ui: UiMessages;
  onCompareDirectionChange: (direction: "previous" | "next") => void;
  onToggleGoodResult: (version: PromptVersion) => void;
};

export function DiffPanel({
  addedCount,
  canCompareNext,
  canComparePrevious,
  compareBase,
  compareBaseImages,
  compareDirection,
  compareTargetImages,
  compareTargetKind,
  compareTargetLabel,
  compareTargetVersion,
  lineDiffRows,
  removedCount,
  showCompareControls,
  ui,
  onCompareDirectionChange,
  onToggleGoodResult,
}: DiffPanelProps) {
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
              onClick={() => onCompareDirectionChange("previous")}
            >
              {ui.comparePrevious}
            </button>
            <button
              type="button"
              className={compareDirection === "next" ? "active" : ""}
              disabled={!canCompareNext}
              onClick={() => onCompareDirectionChange("next")}
            >
              {ui.compareNext}
            </button>
          </div>
        ) : null}
        <div className="diff-title-actions">
          <div className="diff-summary">
            <span className="added">+{addedCount}</span>
            <span className="removed">-{removedCount}</span>
          </div>
        </div>
      </div>
      {compareTargetKind === "image" ? (
        <ImageDiffPreview
          ariaLabel={ui.imageDiffAria}
          baseTitle={renderVersionTitle(
            compareBase?.label ?? ui.noPreviousVersion,
            compareBase,
          )}
          targetTitle={renderVersionTitle(compareTargetLabel, compareTargetVersion)}
          baseImage={compareBaseImages[0]}
          targetImage={compareTargetImages[0]}
          emptyLabel={ui.emptyImage}
        />
      ) : (
        <SplitDiffFiles
          ariaLabel={ui.promptDiffAria}
          baseTitle={renderVersionTitle(
            compareBase?.label ?? ui.noPreviousVersion,
            compareBase,
          )}
          targetTitle={renderVersionTitle(compareTargetLabel, compareTargetVersion)}
          rows={lineDiffRows}
          emptyLabel={ui.emptyContent}
        />
      )}
    </section>
  );
}
