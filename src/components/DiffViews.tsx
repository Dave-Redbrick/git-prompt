import { useLayoutEffect, useMemo, useRef } from "react";
import type { ReactNode } from "react";
import type { LineDiffRow } from "../lib/diff";
import { pauseOtherAudioInGroup } from "../lib/audioPlayback";
import { getResultMediaKind } from "../lib/promptVersions";
import type { DraftImage, ImageAsset } from "../types";

type DiffSide = "left" | "right";

type SplitDiffFilesProps = {
  ariaLabel: string;
  baseTitle: ReactNode;
  className?: string;
  emptyLabel: string;
  rows: LineDiffRow[];
  showHeaders?: boolean;
  targetTitle: ReactNode;
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
  className = "",
  emptyLabel,
  rows,
  showHeaders = true,
  targetTitle,
}: SplitDiffFilesProps) {
  return (
    <div
      className={`split-diff ${showHeaders ? "" : "without-file-headers"} ${className}`.trim()}
      aria-label={ariaLabel}
    >
      {showHeaders ? (
        <>
          <div className="diff-file-header">
            <span>{baseTitle}</span>
          </div>
          <div className="diff-file-header">
            <span>{targetTitle}</span>
          </div>
        </>
      ) : null}
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
  baseActiveIndex: number;
  baseAudioGroupId: string;
  baseImages: Array<ImageAsset | DraftImage>;
  baseSlideDirection: "next" | "previous";
  baseTitle: ReactNode;
  className?: string;
  emptyLabel: string;
  showHeaders?: boolean;
  targetActiveIndex: number;
  targetAudioGroupId: string;
  targetImages: Array<ImageAsset | DraftImage>;
  targetSlideDirection: "next" | "previous";
  targetTitle: ReactNode;
};

function ImageDiffCell({
  activeIndex,
  audioGroupId,
  emptyLabel,
  images,
  slideDirection,
}: {
  activeIndex: number;
  audioGroupId: string;
  emptyLabel: string;
  images: Array<ImageAsset | DraftImage>;
  slideDirection: "next" | "previous";
}) {
  const safeActiveIndex = Math.min(activeIndex, Math.max(0, images.length - 1));
  const imageKey = useMemo(
    () => images.map((image) => image.id).join("|"),
    [images],
  );
  const trackRef = useRef<HTMLDivElement | null>(null);
  const previousIndexRef = useRef(safeActiveIndex);
  const animationFrameRef = useRef<number | null>(null);
  const transitionTimerRef = useRef<number | null>(null);
  const transitionMs = 220;

  const setTrackPosition = (index: number, animate: boolean) => {
    const track = trackRef.current;

    if (!track) {
      return;
    }

    const slideWidth = track.parentElement?.getBoundingClientRect().width ?? 0;
    const offset = slideWidth * index;

    track.style.transition = animate
      ? `transform ${transitionMs}ms ease`
      : "none";
    track.style.transform = `translate3d(-${offset}px, 0, 0)`;
  };

  useLayoutEffect(() => {
    if (animationFrameRef.current) {
      window.cancelAnimationFrame(animationFrameRef.current);
    }

    if (transitionTimerRef.current) {
      window.clearTimeout(transitionTimerRef.current);
    }

    setTrackPosition(images.length > 1 ? safeActiveIndex + 1 : 0, false);
    previousIndexRef.current = safeActiveIndex;

    return () => {
      if (animationFrameRef.current) {
        window.cancelAnimationFrame(animationFrameRef.current);
      }

      if (transitionTimerRef.current) {
        window.clearTimeout(transitionTimerRef.current);
      }
    };
  }, [imageKey, images.length]);

  useLayoutEffect(() => {
    if (images.length <= 1) {
      setTrackPosition(0, false);
      previousIndexRef.current = safeActiveIndex;
      return;
    }

    const previousIndex = previousIndexRef.current;

    if (previousIndex === safeActiveIndex) {
      return;
    }

    if (animationFrameRef.current) {
      window.cancelAnimationFrame(animationFrameRef.current);
    }

    if (transitionTimerRef.current) {
      window.clearTimeout(transitionTimerRef.current);
    }

    const direction = slideDirection;
    const startTrackIndex = previousIndex + 1;
    const endTrackIndex =
      direction === "next" && safeActiveIndex === 0
        ? images.length + 1
        : direction === "previous" && safeActiveIndex === images.length - 1
          ? 0
          : safeActiveIndex + 1;

    setTrackPosition(startTrackIndex, false);
    trackRef.current?.getBoundingClientRect();
    animationFrameRef.current = window.requestAnimationFrame(() => {
      setTrackPosition(endTrackIndex, true);
    });
    transitionTimerRef.current = window.setTimeout(() => {
      setTrackPosition(safeActiveIndex + 1, false);
    }, transitionMs);
    previousIndexRef.current = safeActiveIndex;
  }, [images.length, safeActiveIndex, slideDirection]);

  const carouselImages =
    images.length > 1
      ? [images[images.length - 1], ...images, images[0]]
      : images;

  return (
    <div className="image-diff-cell">
      {images.length > 0 ? (
        <div className="image-diff-carousel">
          <div
            className="image-diff-track"
            ref={trackRef}
          >
            {carouselImages.map((image, index) => (
              <div className="image-diff-slide" key={`${image.id}-${index}`}>
                <figure className="image-diff-frame">
                  {getResultMediaKind(image) === "video" ? (
                    <video src={image.dataUrl} controls preload="metadata" />
                  ) : getResultMediaKind(image) === "audio" ? (
                    <div className="media-audio-preview">
                      <audio
                        src={image.dataUrl}
                        controls
                        data-audio-group={audioGroupId}
                        onPlay={(event) =>
                          pauseOtherAudioInGroup(event.currentTarget)
                        }
                      />
                    </div>
                  ) : (
                    <img src={image.dataUrl} alt={image.name} />
                  )}
                </figure>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="empty-image large">{emptyLabel}</div>
      )}
    </div>
  );
}

export function ImageDiffPreview({
  ariaLabel,
  baseActiveIndex,
  baseAudioGroupId,
  baseImages,
  baseSlideDirection,
  baseTitle,
  className = "",
  emptyLabel,
  showHeaders = true,
  targetActiveIndex,
  targetAudioGroupId,
  targetImages,
  targetSlideDirection,
  targetTitle,
}: ImageDiffPreviewProps) {
  return (
    <div
      className={`split-diff image-diff-preview ${showHeaders ? "" : "without-file-headers"} ${className}`.trim()}
      aria-label={ariaLabel}
    >
      {showHeaders ? (
        <>
          <div className="diff-file-header">
            <span>{baseTitle}</span>
          </div>
          <div className="diff-file-header">
            <span>{targetTitle}</span>
          </div>
        </>
      ) : null}
      <div className="image-diff-body">
        <ImageDiffCell
          activeIndex={baseActiveIndex}
          audioGroupId={baseAudioGroupId}
          images={baseImages}
          emptyLabel={emptyLabel}
          slideDirection={baseSlideDirection}
        />
        <ImageDiffCell
          activeIndex={targetActiveIndex}
          audioGroupId={targetAudioGroupId}
          images={targetImages}
          emptyLabel={emptyLabel}
          slideDirection={targetSlideDirection}
        />
      </div>
    </div>
  );
}
