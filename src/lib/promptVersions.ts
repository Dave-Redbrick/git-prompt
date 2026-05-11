import { createId } from "./db";
import type {
  DraftImage,
  ImageAsset,
  PromptVersion,
  PromptVersionKind,
  ResultMediaKind,
  SystemPrompt,
  Topic,
} from "../types";

export const defaultSystemPromptName = "default";

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

const systemPromptFallbackName = (index: number) =>
  index === 0 ? defaultSystemPromptName : `system-${index + 1}`;

const normalizeSystemPrompt = (
  prompt: Partial<SystemPrompt>,
  index: number,
): SystemPrompt => ({
  id: prompt.id?.trim() || `system-prompt-${index + 1}`,
  name: prompt.name?.trim() || systemPromptFallbackName(index),
  body: prompt.body ?? "",
});

export const normalizeSystemPrompts = (
  systemPrompts?: Partial<SystemPrompt>[],
  legacyBody = "",
) => {
  const source =
    Array.isArray(systemPrompts) && systemPrompts.length > 0
      ? systemPrompts
      : [{ body: legacyBody, name: defaultSystemPromptName }];

  return source.map((prompt, index) => normalizeSystemPrompt(prompt, index));
};

export const getVersionSystemPrompts = (
  version?: Pick<PromptVersion, "body" | "systemPrompts"> | null,
) => normalizeSystemPrompts(version?.systemPrompts, version?.body ?? "");

export const copySystemPromptsToDraft = (
  source?: Pick<PromptVersion, "body" | "systemPrompts"> | null,
) =>
  getVersionSystemPrompts(source).map((prompt) => ({
    ...prompt,
    id: createId(),
  }));

export const createSystemPrompt = (
  body = "",
  name = defaultSystemPromptName,
): SystemPrompt => ({
  id: createId(),
  name,
  body,
});

export const getSystemPromptText = (
  systemPrompts: Array<Pick<SystemPrompt, "body">>,
) =>
  systemPrompts
    .map((prompt) => prompt.body)
    .filter((body) => body.trim().length > 0)
    .join("\n\n");

export const getVersionSystemPromptText = (
  version?: Pick<PromptVersion, "body" | "systemPrompts"> | null,
) => getSystemPromptText(getVersionSystemPrompts(version));

export const systemPromptListsMatch = (
  left: Array<Partial<SystemPrompt>>,
  right: Array<Partial<SystemPrompt>>,
) => {
  const leftPrompts = normalizeSystemPrompts(left);
  const rightPrompts = normalizeSystemPrompts(right);

  return (
    leftPrompts.length === rightPrompts.length &&
    leftPrompts.every((prompt, index) => {
      const rightPrompt = rightPrompts[index];

      return (
        prompt.name === rightPrompt?.name && prompt.body === rightPrompt?.body
      );
    })
  );
};

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
  systemPrompts,
  userPrompt,
}: {
  body?: string;
  systemPrompts?: Array<Pick<SystemPrompt, "body">>;
  userPrompt?: string;
}) =>
  [
    systemPrompts ? getSystemPromptText(systemPrompts) : (body ?? ""),
    userPrompt ?? "",
  ]
    .filter((part) => part.trim().length > 0)
    .join("\n\n");

export const getCommitMemo = (notes: string | undefined, fallback: string) =>
  notes?.trim() || fallback;

export const copyImagesToDraft = (images: ImageAsset[]): DraftImage[] =>
  images.map((image, index) => ({
    id: createId(),
    sourceId: image.id,
    order: image.order ?? index,
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
