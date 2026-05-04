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

type DiffPanelProps = {
  addedCount: number;
  compareBase: PromptVersion | null;
  compareBaseImages: Array<ImageAsset | DraftImage>;
  compareTargetImages: Array<ImageAsset | DraftImage>;
  compareTargetKind: PromptVersionKind;
  compareTargetLabel: string;
  lineDiffRows: LineDiffRow[];
  removedCount: number;
  ui: UiMessages;
};

export function DiffPanel({
  addedCount,
  compareBase,
  compareBaseImages,
  compareTargetImages,
  compareTargetKind,
  compareTargetLabel,
  lineDiffRows,
  removedCount,
  ui,
}: DiffPanelProps) {
  return (
    <section className="panel diff-panel">
      <div className="diff-titlebar">
        <div className="editor-tab active">
          <Diff aria-hidden="true" size={15} />
          {"prompt.diff"}
        </div>
        <div className="diff-summary">
          <span className="added">+{addedCount}</span>
          <span className="removed">-{removedCount}</span>
        </div>
      </div>
      {compareTargetKind === "image" ? (
        <ImageDiffPreview
          ariaLabel={ui.imageDiffAria}
          baseTitle={compareBase?.label ?? ui.noPreviousVersion}
          targetTitle={compareTargetLabel}
          baseImage={compareBaseImages[0]}
          targetImage={compareTargetImages[0]}
          emptyLabel={ui.emptyImage}
        />
      ) : (
        <SplitDiffFiles
          ariaLabel={ui.promptDiffAria}
          baseTitle={compareBase?.label ?? ui.noPreviousVersion}
          targetTitle={compareTargetLabel}
          rows={lineDiffRows}
          emptyLabel={ui.emptyContent}
        />
      )}
    </section>
  );
}
