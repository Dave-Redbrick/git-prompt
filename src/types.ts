export type PromptVersionKind = "text" | "image" | "audio" | "video";

export type TopicModelKind = "text" | "image" | "voice" | "video";

export type ResultMediaKind = "image" | "audio" | "video";

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
  runCount?: number;
  tokenCount?: number;
  tokensPerRun?: number;
  type: "input" | "image";
};

export type VersionCostSnapshot = {
  estimatorVersion: number;
  imageCount: number;
  modelCostItems: CostSnapshotModelItem[];
  promptChars: number;
  promptTokens: number;
  resultCount?: number;
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

export type SystemPrompt = {
  id: string;
  name: string;
  body: string;
};

export type PromptVersion = {
  id: string;
  topicId: string;
  kind?: PromptVersionKind;
  modelIds?: TopicModelId[];
  costSnapshot?: VersionCostSnapshot;
  isGoodResult?: boolean;
  label: string;
  body: string;
  systemPrompts?: SystemPrompt[];
  userPrompt?: string;
  resultText?: string;
  resultTexts?: string[];
  notes: string;
  createdAt: string;
};

export type PromptDraft = {
  topicId: string;
  kind?: PromptVersionKind;
  label: string;
  body: string;
  systemPrompts?: SystemPrompt[];
  userPrompt?: string;
  resultTexts?: string[];
  notes: string;
  images: DraftImage[];
  updatedAt: string;
};

export type ImageAsset = {
  id: string;
  topicId: string;
  versionId: string;
  kind?: ResultMediaKind;
  name: string;
  type: string;
  dataUrl: string;
  createdAt: string;
};

export type DraftImage = Pick<
  ImageAsset,
  "id" | "kind" | "name" | "type" | "dataUrl"
> & {
  sourceId?: string;
};
