export type PromptVersionKind = "text" | "image";

export type TopicModelKind = PromptVersionKind | "voice" | "video";

export type TopicModelId = string;

export type TopicModelRole =
  | "chat-input"
  | "embedding"
  | "prompt-refiner"
  | "image-generation"
  | "voice"
  | "video";

export type TopicModelConfig = {
  id: TopicModelId;
  provider: string;
  kind: TopicModelKind;
  memo?: string;
  overridesModelKey?: TopicModelId;
  role: TopicModelRole;
  pricingType: "input" | "image";
  inputPriceUsd?: number;
  inputTokenUnitInTenThousands?: number;
  costPerImageUsd?: number;
};

export type CostSnapshotModelItem = {
  costPerImageUsd?: number;
  costUsd: number;
  imageCount?: number;
  inputPriceUsd?: number;
  inputTokenUnitInTenThousands?: number;
  modelId: TopicModelId;
  provider: string;
  role: TopicModelRole;
  tokenCount?: number;
  type: "input" | "image";
};

export type VersionCostSnapshot = {
  estimatorVersion: number;
  imageCount: number;
  modelCostItems: CostSnapshotModelItem[];
  promptChars: number;
  promptTokens: number;
  resultChars: number;
  totalCostUsd: number;
};

export type Project = {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
};

export type Theme = {
  id: string;
  projectId: string;
  name: string;
  color: string;
  createdAt: string;
  updatedAt: string;
};

export type Topic = {
  id: string;
  projectId: string;
  themeId?: string;
  kind?: PromptVersionKind;
  modelIds?: TopicModelId[];
  title: string;
  brief: string;
  createdAt: string;
  updatedAt: string;
};

export type PromptVersion = {
  id: string;
  topicId: string;
  kind?: PromptVersionKind;
  modelIds?: TopicModelId[];
  costSnapshot?: VersionCostSnapshot;
  label: string;
  body: string;
  resultText?: string;
  notes: string;
  createdAt: string;
};

export type ImageAsset = {
  id: string;
  topicId: string;
  versionId: string;
  name: string;
  type: string;
  dataUrl: string;
  createdAt: string;
};

export type DraftImage = Pick<ImageAsset, "id" | "name" | "type" | "dataUrl"> & {
  sourceId?: string;
};
