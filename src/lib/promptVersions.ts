import { createId } from "./db";
import type {
  DraftImage,
  ImageAsset,
  PromptVersion,
  PromptVersionKind,
  ResultMediaKind,
  Topic,
} from "../types";

export const getVersionKind = (
  version?: PromptVersion | null,
): PromptVersionKind => version?.kind ?? "text";

export const getTopicKind = (
  topic?: Topic | null,
  latestVersion?: PromptVersion | null,
): PromptVersionKind => topic?.kind ?? getVersionKind(latestVersion);

export const normalizeResultTexts = (texts: string[]) =>
  texts.map((text) => text.trim()).filter(Boolean);

export const joinResultTexts = (texts: string[]) => texts.join("\n\n");

export const getVersionResultTexts = (version?: PromptVersion | null) => {
  if (!version || getVersionKind(version) !== "text") {
    return [];
  }

  if (Array.isArray(version.resultTexts)) {
    return normalizeResultTexts(version.resultTexts);
  }

  const legacyResultText = version.resultText ?? version.body;

  return legacyResultText.trim() ? [legacyResultText] : [];
};

export const getVersionResultText = (version?: PromptVersion | null) =>
  joinResultTexts(getVersionResultTexts(version));

export const getVersionUserPrompt = (
  version?: Pick<PromptVersion, "userPrompt"> | null,
) =>
  version?.userPrompt ?? "";

export const getCombinedPromptText = ({
  body,
  userPrompt,
}: {
  body: string;
  userPrompt?: string;
}) => [body, userPrompt ?? ""].filter((part) => part.trim().length > 0).join("\n\n");

export const getCommitMemo = (notes: string | undefined, fallback: string) =>
  notes?.trim() || fallback;

export const copyImagesToDraft = (images: ImageAsset[]): DraftImage[] =>
  images.map((image) => ({
    id: createId(),
    sourceId: image.id,
    kind: image.kind,
    name: image.name,
    type: image.type,
    dataUrl: image.dataUrl,
  }));

const audioResultExtensions = new Set([
  "aac",
  "aif",
  "aiff",
  "flac",
  "m4a",
  "mp3",
  "oga",
  "ogg",
  "opus",
  "wav",
]);

const imageResultExtensions = new Set([
  "avif",
  "gif",
  "jpeg",
  "jpg",
  "png",
  "webp",
]);

const videoResultExtensions = new Set([
  "avi",
  "m4v",
  "mkv",
  "mov",
  "mp4",
  "webm",
]);

const getFileExtension = (name?: string) =>
  name?.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() ?? "";

export const getResultMediaKind = (
  media: Pick<ImageAsset | DraftImage, "type" | "kind"> & { name?: string },
): ResultMediaKind => {
  if (media.kind) {
    return media.kind;
  }

  const extension = getFileExtension(media.name);
  if (audioResultExtensions.has(extension)) {
    return "audio";
  }

  if (videoResultExtensions.has(extension)) {
    return "video";
  }

  if (imageResultExtensions.has(extension)) {
    return "image";
  }

  if (media.type.startsWith("audio/")) {
    return "audio";
  }

  if (media.type.startsWith("video/")) {
    return "video";
  }

  return "image";
};

export const countImageResultMedia = (
  mediaItems: Array<ImageAsset | DraftImage>,
) => mediaItems.filter((item) => getResultMediaKind(item) === "image").length;

export const draftImagesMatchStoredImages = (
  draftImages: DraftImage[],
  storedImages: ImageAsset[],
) => {
  if (draftImages.length !== storedImages.length) {
    return false;
  }

  return storedImages.every((storedImage, index) => {
    const draftImage = draftImages[index];
    return (
      draftImage?.sourceId === storedImage.id ||
      (draftImage?.name === storedImage.name &&
        getResultMediaKind(draftImage) === getResultMediaKind(storedImage) &&
        draftImage?.type === storedImage.type &&
        draftImage?.dataUrl === storedImage.dataUrl)
    );
  });
};
