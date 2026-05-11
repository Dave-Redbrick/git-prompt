import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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

type DiffOverviewMarkerType = Exclude<LineDiffRow["type"], "same">;

type DiffOverviewMarker = {
  endIndex: number;
  id: string;
  startIndex: number;
  type: DiffOverviewMarkerType;
};

type DiffOverviewMarkerLayout = Record<string, { top: number; height: number }>;

type RenderedDiffOverviewMarker = {
  height: number;
  id: string;
  top: number;
  type: DiffOverviewMarkerType;
};

const MIN_OVERVIEW_MARKER_HEIGHT = 3;
const FALLBACK_DIFF_ROW_HEIGHT = 24;
const OVERVIEW_MARKER_BLEND_GAP = 2;

const getOverviewMarkerType = (
  types: DiffOverviewMarkerType[],
): DiffOverviewMarkerType => {
  const firstType = types[0] ?? "changed";

  return types.every((type) => type === firstType) ? firstType : "changed";
};

const getOverviewMarkers = (rows: LineDiffRow[]) => {
  if (rows.length === 0) {
    return [];
  }

  const markers: DiffOverviewMarker[] = [];
  let index = 0;

  while (index < rows.length) {
    if (rows[index].type === "same") {
      index += 1;
      continue;
    }

    const startIndex = index;
    const startRow = rows[index];
    let endRow = startRow;
    const blockTypes: DiffOverviewMarkerType[] = [];

    while (index < rows.length && rows[index].type !== "same") {
      endRow = rows[index];
      blockTypes.push(rows[index].type as DiffOverviewMarkerType);
      index += 1;
    }

    markers.push({
      endIndex: index - 1,
      id: `${startRow.id}:${endRow.id}`,
      startIndex,
      type: getOverviewMarkerType(blockTypes),
    });
  }

  return markers;
};

const getFallbackOverviewMarkerLayout = (marker: DiffOverviewMarker) => ({
  height: Math.max(
    (marker.endIndex - marker.startIndex + 1) * FALLBACK_DIFF_ROW_HEIGHT,
    MIN_OVERVIEW_MARKER_HEIGHT,
  ),
  top: marker.startIndex * FALLBACK_DIFF_ROW_HEIGHT,
});

const getOverviewMarkerStyle = (
  marker: RenderedDiffOverviewMarker,
) => {
  return {
    height: `${marker.height}px`,
    top: `${marker.top}px`,
  };
};

const getScrollableChildTop = (
  containerElement: HTMLElement,
  childElement: HTMLElement,
) => {
  if (childElement.offsetParent === containerElement) {
    return childElement.offsetTop;
  }

  if (childElement.offsetParent === containerElement.offsetParent) {
    return childElement.offsetTop - containerElement.offsetTop;
  }

  const containerRect = containerElement.getBoundingClientRect();
  const childRect = childElement.getBoundingClientRect();

  return childRect.top - containerRect.top + containerElement.scrollTop;
};

const areOverviewMarkerLayoutsEqual = (
  left: DiffOverviewMarkerLayout,
  right: DiffOverviewMarkerLayout,
) => {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);

  if (leftKeys.length !== rightKeys.length) {
    return false;
  }

  return leftKeys.every((key) => {
    const leftValue = left[key];
    const rightValue = right[key];

    return (
      rightValue &&
      Math.abs(leftValue.top - rightValue.top) < 0.5 &&
      Math.abs(leftValue.height - rightValue.height) < 0.5
    );
  });
};

const getRenderedOverviewMarkers = (
  markers: DiffOverviewMarker[],
  layout: DiffOverviewMarkerLayout,
) => {
  const positionedMarkers = markers
    .map((marker) => {
      const markerLayout =
        layout[marker.id] ?? getFallbackOverviewMarkerLayout(marker);

      return {
        height: markerLayout.height,
        id: marker.id,
        top: markerLayout.top,
        type: marker.type,
      };
    })
    .sort((left, right) => left.top - right.top);

  return positionedMarkers.reduce<RenderedDiffOverviewMarker[]>(
    (mergedMarkers, marker) => {
      const previousMarker = mergedMarkers[mergedMarkers.length - 1];

      if (!previousMarker) {
        return [marker];
      }

      const previousBottom = previousMarker.top + previousMarker.height;

      if (marker.top > previousBottom + OVERVIEW_MARKER_BLEND_GAP) {
        return [...mergedMarkers, marker];
      }

      const nextBottom = Math.max(previousBottom, marker.top + marker.height);
      const nextMarker: RenderedDiffOverviewMarker = {
        height: nextBottom - previousMarker.top,
        id: `${previousMarker.id}:${marker.id}`,
        top: previousMarker.top,
        type:
          previousMarker.type === marker.type ? previousMarker.type : "changed",
      };

      return [...mergedMarkers.slice(0, -1), nextMarker];
    },
    [],
  );
};

const getDiffCell = (row: LineDiffRow, side: DiffSide) => {
  const isLeft = side === "left";
  const isChanged = row.type === "changed";
  const visible =
    isChanged ||
    row.type === "same" ||
    (isLeft && row.type === "removed") ||
    (!isLeft && row.type === "added");

  return {
    className: isChanged
      ? isLeft
        ? "removed"
        : "added"
      : visible
        ? row.type
        : "empty",
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
  const codeLinesRef = useRef<HTMLDivElement | null>(null);
  const overviewRef = useRef<HTMLDivElement | null>(null);
  const overviewMarkers = useMemo(() => getOverviewMarkers(rows), [rows]);
  const [overviewMarkerLayout, setOverviewMarkerLayout] =
    useState<DiffOverviewMarkerLayout>({});
  const renderedOverviewMarkers = useMemo(
    () => getRenderedOverviewMarkers(overviewMarkers, overviewMarkerLayout),
    [overviewMarkerLayout, overviewMarkers],
  );

  const updateOverviewMarkerLayout = useCallback(() => {
    const codeLinesElement = codeLinesRef.current;
    const overviewElement = overviewRef.current;

    if (
      !codeLinesElement ||
      !overviewElement ||
      overviewMarkers.length === 0
    ) {
      setOverviewMarkerLayout((currentLayout) =>
        Object.keys(currentLayout).length > 0 ? {} : currentLayout,
      );
      return;
    }

    const rowElements = codeLinesElement.querySelectorAll<HTMLElement>(
      "[data-diff-row-index]",
    );
    const contentHeight = Math.max(
      codeLinesElement.scrollHeight,
      codeLinesElement.clientHeight,
      1,
    );
    const overviewHeight = overviewElement.clientHeight;

    if (overviewHeight <= 0) {
      setOverviewMarkerLayout((currentLayout) =>
        Object.keys(currentLayout).length > 0 ? {} : currentLayout,
      );
      return;
    }

    const nextLayout: DiffOverviewMarkerLayout = {};

    overviewMarkers.forEach((marker) => {
      const startElement = rowElements[marker.startIndex];
      const endElement = rowElements[marker.endIndex];

      if (!startElement || !endElement) {
        nextLayout[marker.id] = getFallbackOverviewMarkerLayout(marker);
        return;
      }

      const startTop = getScrollableChildTop(codeLinesElement, startElement);
      const endBottom =
        getScrollableChildTop(codeLinesElement, endElement) +
        endElement.offsetHeight;
      const top = (startTop / contentHeight) * overviewHeight;
      const rawHeight = ((endBottom - startTop) / contentHeight) * overviewHeight;
      const height = Math.max(rawHeight, MIN_OVERVIEW_MARKER_HEIGHT);
      const clampedTop = Math.min(
        top,
        Math.max(0, overviewHeight - MIN_OVERVIEW_MARKER_HEIGHT),
      );

      nextLayout[marker.id] = {
        height: Math.min(
          height,
          Math.max(MIN_OVERVIEW_MARKER_HEIGHT, overviewHeight - clampedTop),
        ),
        top: clampedTop,
      };
    });

    setOverviewMarkerLayout((currentLayout) =>
      areOverviewMarkerLayoutsEqual(currentLayout, nextLayout)
        ? currentLayout
        : nextLayout,
    );
  }, [overviewMarkers]);

  useEffect(() => {
    updateOverviewMarkerLayout();

    const codeLinesElement = codeLinesRef.current;
    const overviewElement = overviewRef.current;

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const resizeObserver = new ResizeObserver(updateOverviewMarkerLayout);

    if (codeLinesElement) {
      resizeObserver.observe(codeLinesElement);
    }

    if (overviewElement) {
      resizeObserver.observe(overviewElement);
    }

    return () => {
      resizeObserver.disconnect();
    };
  }, [updateOverviewMarkerLayout]);

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
      <div className="code-lines" ref={codeLinesRef}>
        {rows.length > 0 ? (
          rows.map((row, index) => (
            <div
              key={row.id}
              className="split-code-row"
              data-diff-row-index={index}
            >
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
      {renderedOverviewMarkers.length > 0 ? (
        <div
          className="diff-scroll-preview"
          aria-hidden="true"
          ref={overviewRef}
        >
          {renderedOverviewMarkers.map((marker) => (
            <span
              className={`diff-scroll-preview-marker ${marker.type}`}
              key={marker.id}
              style={getOverviewMarkerStyle(marker)}
            />
          ))}
        </div>
      ) : null}
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
