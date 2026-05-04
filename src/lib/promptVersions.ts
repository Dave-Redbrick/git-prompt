import { createId } from "./db";
import type {
  DraftImage,
  ImageAsset,
  PromptVersion,
  PromptVersionKind,
  Topic,
} from "../types";

export const getVersionKind = (
  version?: PromptVersion | null,
): PromptVersionKind => version?.kind ?? "text";

export const getTopicKind = (
  topic?: Topic | null,
  latestVersion?: PromptVersion | null,
): PromptVersionKind => topic?.kind ?? getVersionKind(latestVersion);

export const getVersionResultText = (version?: PromptVersion | null) => {
  if (!version || getVersionKind(version) !== "text") {
    return "";
  }

  return version.resultText ?? version.body;
};

export const getCommitMemo = (notes: string | undefined, fallback: string) =>
  notes?.trim() || fallback;

export const copyImagesToDraft = (images: ImageAsset[]): DraftImage[] =>
  images.map((image) => ({
    id: createId(),
    sourceId: image.id,
    name: image.name,
    type: image.type,
    dataUrl: image.dataUrl,
  }));

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
        draftImage?.type === storedImage.type &&
        draftImage?.dataUrl === storedImage.dataUrl)
    );
  });
};
