import type { LineDiffRow } from "../lib/diff";
import type { DraftImage, ImageAsset } from "../types";

type DiffSide = "left" | "right";

type SplitDiffFilesProps = {
  ariaLabel: string;
  baseTitle: string;
  emptyLabel: string;
  rows: LineDiffRow[];
  targetTitle: string;
};

const getDiffCell = (row: LineDiffRow, side: DiffSide) => {
  const isLeft = side === "left";
  const visible =
    row.type === "same" ||
    (isLeft && row.type === "removed") ||
    (!isLeft && row.type === "added");

  return {
    className: visible ? row.type : "empty",
    lineNumber: isLeft ? row.leftLineNumber : row.rightLineNumber,
    marker: row.type === "same" || !visible ? "" : isLeft ? "-" : "+",
    text: visible ? (isLeft ? row.leftText : row.rightText) || " " : "",
  };
};

function DiffLineCell({ row, side }: { row: LineDiffRow; side: DiffSide }) {
  const cell = getDiffCell(row, side);

  return (
    <div className={`code-line ${cell.className}`}>
      <span className="line-number">{cell.lineNumber ?? ""}</span>
      <span className="change-marker">{cell.marker}</span>
      <code>{cell.text}</code>
    </div>
  );
}

export function SplitDiffFiles({
  ariaLabel,
  baseTitle,
  emptyLabel,
  rows,
  targetTitle,
}: SplitDiffFilesProps) {
  return (
    <div className="split-diff" aria-label={ariaLabel}>
      <div className="diff-file-header">
        <span>{baseTitle}</span>
      </div>
      <div className="diff-file-header">
        <span>{targetTitle}</span>
      </div>
      <div className="code-lines">
        {rows.length > 0 ? (
          rows.map((row) => (
            <div key={row.id} className="split-code-row">
              <DiffLineCell row={row} side="left" />
              <DiffLineCell row={row} side="right" />
            </div>
          ))
        ) : (
          <div className="split-code-row">
            <div className="code-line empty-message">
              <span className="line-number" />
              <span className="change-marker" />
              <code>{emptyLabel}</code>
            </div>
            <div className="code-line empty-message">
              <span className="line-number" />
              <span className="change-marker" />
              <code>{emptyLabel}</code>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

type ImageDiffPreviewProps = {
  ariaLabel: string;
  baseImage?: ImageAsset | DraftImage;
  baseTitle: string;
  emptyLabel: string;
  targetImage?: ImageAsset | DraftImage;
  targetTitle: string;
};

function ImageDiffCell({
  emptyLabel,
  image,
}: {
  emptyLabel: string;
  image?: ImageAsset | DraftImage;
}) {
  return (
    <div className="image-diff-cell">
      {image ? (
        <figure className="image-diff-frame">
          <img src={image.dataUrl} alt={image.name} />
        </figure>
      ) : (
        <div className="empty-image large">{emptyLabel}</div>
      )}
    </div>
  );
}

export function ImageDiffPreview({
  ariaLabel,
  baseImage,
  baseTitle,
  emptyLabel,
  targetImage,
  targetTitle,
}: ImageDiffPreviewProps) {
  return (
    <div className="split-diff image-diff-preview" aria-label={ariaLabel}>
      <div className="diff-file-header">
        <span>{baseTitle}</span>
      </div>
      <div className="diff-file-header">
        <span>{targetTitle}</span>
      </div>
      <div className="image-diff-body">
        <ImageDiffCell image={baseImage} emptyLabel={emptyLabel} />
        <ImageDiffCell image={targetImage} emptyLabel={emptyLabel} />
      </div>
    </div>
  );
}
