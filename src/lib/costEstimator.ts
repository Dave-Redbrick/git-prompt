import type {
  CostSnapshotModelItem,
  DraftImage,
  ImageAsset,
  PromptVersion,
  PromptVersionKind,
  TopicModelConfig,
  TopicModelId,
  VersionCostSnapshot,
} from "../types";
import { getVersionKind, getVersionResultText } from "./promptVersions";

const usdPerToken = (usdPerMillionTokens: number) =>
  usdPerMillionTokens / 1_000_000;

export const costEstimatorVersion = 1;
export type CostCurrencyLocale = "ko" | "en";

export type TopicModelOption = TopicModelConfig & {
  label: string;
};

export type ModelCostItem = CostSnapshotModelItem;

type VersionBaseMetrics = Omit<
  VersionCostMetrics,
  "charDelta" | "costDeltaUsd" | "modelAddedIds" | "modelRemovedIds" | "tokenDelta" | "versionId"
>;

const builtInModelConfigs: TopicModelConfig[] = [
  {
    id: "xai/grok-4-1-fast-non-reasoning",
    provider: "xAI",
    kind: "text",
    role: "chat-input",
    pricingType: "input",
    inputUsdPerMillion: 0.2,
  },
  {
    id: "openai/text-embedding-3-small",
    provider: "OpenAI",
    kind: "text",
    role: "embedding",
    pricingType: "input",
    inputUsdPerMillion: 0.02,
  },
  {
    id: "xai/grok-4-1-fast-non-reasoning",
    provider: "xAI",
    kind: "image",
    role: "prompt-refiner",
    pricingType: "input",
    inputUsdPerMillion: 0.2,
  },
  {
    id: "fal-ai/bytedance/seedream/v4.5/edit",
    provider: "fal.ai",
    kind: "image",
    role: "image-generation",
    pricingType: "image",
    costPerImageUsd: 0.04,
  },
];

export const defaultModelIdsByKind: Record<PromptVersionKind, TopicModelId[]> = {
  text: ["xai/grok-4-1-fast-non-reasoning", "openai/text-embedding-3-small"],
  image: [
    "xai/grok-4-1-fast-non-reasoning",
    "fal-ai/bytedance/seedream/v4.5/edit",
  ],
};

const isValidModelConfig = (model: TopicModelConfig) => {
  if (!model.id.trim() || !model.provider.trim()) {
    return false;
  }

  if (model.pricingType === "image") {
    return typeof model.costPerImageUsd === "number" && model.costPerImageUsd >= 0;
  }

  return (
    typeof model.inputUsdPerMillion === "number" && model.inputUsdPerMillion >= 0
  );
};

export const getAvailableModelConfigs = (
  kind: PromptVersionKind,
  customModels: TopicModelConfig[] = [],
): TopicModelConfig[] => {
  const modelMap = new Map<TopicModelId, TopicModelConfig>();

  for (const model of builtInModelConfigs) {
    if (model.kind === kind) {
      modelMap.set(model.id, model);
    }
  }

  for (const model of customModels) {
    if (model.kind === kind && isValidModelConfig(model)) {
      modelMap.set(model.id, model);
    }
  }

  return Array.from(modelMap.values());
};

export const resolveTopicModelIds = (
  kind: PromptVersionKind,
  modelIds?: string[],
  customModels?: TopicModelConfig[],
): TopicModelId[] => {
  const availableModelIds = new Set(
    getAvailableModelConfigs(kind, customModels).map((model) => model.id),
  );
  const normalizedModelIds = Array.from(new Set(modelIds ?? [])).filter((modelId) =>
    availableModelIds.has(modelId),
  );

  return normalizedModelIds.length > 0 ? normalizedModelIds : defaultModelIdsByKind[kind];
};

export const resolveTopicModels = (
  kind: PromptVersionKind,
  modelIds?: string[],
  customModels?: TopicModelConfig[],
): TopicModelConfig[] => {
  const availableModels = getAvailableModelConfigs(kind, customModels);
  const availableModelMap = new Map(availableModels.map((model) => [model.id, model]));
  const resolvedModelIds = resolveTopicModelIds(kind, modelIds, customModels);

  return resolvedModelIds
    .map((modelId) => availableModelMap.get(modelId))
    .filter((model): model is TopicModelConfig => Boolean(model));
};

export const getModelOptions = (
  kind: PromptVersionKind,
  customModels?: TopicModelConfig[],
): TopicModelOption[] =>
  getAvailableModelConfigs(kind, customModels).map((model) => ({
    ...model,
    label: model.id,
  }));

export const getModelDisplayName = (modelId: string) => {
  const slashIndex = modelId.indexOf("/");
  return slashIndex >= 0 ? modelId.slice(slashIndex + 1) : modelId;
};

export type VersionCostMetrics = {
  charDelta: number;
  costDeltaUsd: number;
  embeddingCostUsd: number;
  embeddingTokens: number;
  imageCostUsd: number;
  imageCount: number;
  inputCostUsd: number;
  inputTokens: number;
  kind: PromptVersionKind;
  modelAddedIds: TopicModelId[];
  modelCostItems: ModelCostItem[];
  modelIds: TopicModelId[];
  modelRemovedIds: TopicModelId[];
  outputCostUsd: number;
  outputTokens: number;
  promptChars: number;
  promptTokens: number;
  resultChars: number;
  totalCostUsd: number;
  tokenDelta: number;
  versionId: string;
};

export const countTextChars = (text: string) => Array.from(text).length;

export const estimateTextTokens = (text: string) => {
  const chars = Array.from(text);
  if (chars.length === 0) {
    return 0;
  }

  const weightedCharacters = chars.reduce((total, char) => {
    if (/\s/.test(char)) {
      return total + 0.25;
    }

    return total + (char.charCodeAt(0) <= 0x7f ? 0.25 : 0.5);
  }, 0);

  return Math.max(1, Math.ceil(weightedCharacters));
};

const estimateInputCost = (tokens: number, usdPerMillion: number) =>
  tokens * usdPerToken(usdPerMillion);

const formatTinyDecimal = (value: number) => {
  if (value >= 0.01) {
    return value.toFixed(2);
  }

  if (value >= 0.0001) {
    return value.toFixed(4);
  }

  if (value >= 0.000001) {
    return value.toFixed(6);
  }

  return value.toFixed(8);
};

const formatKrwAmount = (value: number) => {
  if (value === 0) {
    return "0";
  }

  if (value >= 1) {
    return Math.round(value).toLocaleString("ko-KR");
  }

  if (value >= 0.01) {
    return value.toFixed(2);
  }

  if (value >= 0.0001) {
    return value.toFixed(4);
  }

  return value.toFixed(6);
};

export const formatUsd = (value: number) => {
  if (value === 0) {
    return "$0.00";
  }

  return `${value < 0 ? "-" : ""}$${formatTinyDecimal(Math.abs(value))}`;
};

export const formatCurrency = (
  valueUsd: number,
  locale: CostCurrencyLocale,
  usdKrwRate?: number | null,
) => {
  if (
    locale === "ko" &&
    typeof usdKrwRate === "number" &&
    Number.isFinite(usdKrwRate)
  ) {
    const valueKrw = valueUsd * usdKrwRate;

    return `${valueKrw < 0 ? "-" : ""}₩${formatKrwAmount(Math.abs(valueKrw))}`;
  }

  return formatUsd(valueUsd);
};

export const formatSignedNumber = (value: number) =>
  `${value > 0 ? "+" : ""}${value.toLocaleString()}`;

export const formatSignedCurrency = (
  valueUsd: number,
  locale: CostCurrencyLocale,
  usdKrwRate?: number | null,
) => {
  if (valueUsd === 0) {
    return formatCurrency(0, locale, usdKrwRate);
  }

  return `${valueUsd > 0 ? "+" : "-"}${formatCurrency(
    Math.abs(valueUsd),
    locale,
    usdKrwRate,
  )}`;
};

export const formatSignedUsd = (value: number) =>
  formatSignedCurrency(value, "en");

const getImageCount = (
  version: PromptVersion,
  imagesByVersion: Record<string, Array<ImageAsset | DraftImage>>,
) => imagesByVersion[version.id]?.length ?? 0;

const buildModelCostItems = ({
  billableImages,
  kind,
  models,
  promptTokens,
}: {
  billableImages: number;
  kind: PromptVersionKind;
  models: TopicModelConfig[];
  promptTokens: number;
}) => {
  return models.flatMap<ModelCostItem>((model) => {
    if (model.kind !== kind) {
      return [];
    }

    if (model.pricingType === "image") {
      return [
        {
          costPerImageUsd: model.costPerImageUsd ?? 0,
          costUsd: billableImages * (model.costPerImageUsd ?? 0),
          imageCount: billableImages,
          modelId: model.id,
          provider: model.provider,
          role: model.role,
          type: "image",
        },
      ];
    }

    return [
      {
        costUsd: estimateInputCost(promptTokens, model.inputUsdPerMillion ?? 0),
        inputUsdPerMillion: model.inputUsdPerMillion ?? 0,
        modelId: model.id,
        provider: model.provider,
        role: model.role,
        tokenCount: promptTokens,
        type: "input",
      },
    ];
  });
};

const summarizeModelCostItems = (modelCostItems: ModelCostItem[]) => {
  const inputCostUsd = modelCostItems
    .filter((item) => item.type === "input")
    .reduce((total, item) => total + item.costUsd, 0);
  const imageCostUsd = modelCostItems
    .filter((item) => item.type === "image")
    .reduce((total, item) => total + item.costUsd, 0);
  const embeddingCostUsd = modelCostItems
    .filter((item) => item.role === "embedding")
    .reduce((total, item) => total + item.costUsd, 0);

  return { embeddingCostUsd, imageCostUsd, inputCostUsd };
};

const estimateVersionBaseMetrics = (
  version: PromptVersion,
  imagesByVersion: Record<string, Array<ImageAsset | DraftImage>>,
  fallbackModels: TopicModelConfig[],
  modelConfigs?: TopicModelConfig[],
): VersionBaseMetrics => {
  const kind = getVersionKind(version);

  if (version.costSnapshot) {
    const snapshot = version.costSnapshot;
    const modelCostItems = snapshot.modelCostItems ?? [];
    const { embeddingCostUsd, imageCostUsd, inputCostUsd } =
      summarizeModelCostItems(modelCostItems);
    const modelIds = version.modelIds ?? modelCostItems.map((item) => item.modelId);

    return {
      embeddingCostUsd,
      embeddingTokens: modelCostItems.some((item) => item.role === "embedding")
        ? snapshot.promptTokens
        : 0,
      imageCostUsd,
      imageCount: snapshot.imageCount,
      inputCostUsd,
      inputTokens: snapshot.promptTokens,
      kind,
      modelCostItems,
      modelIds,
      outputCostUsd: 0,
      outputTokens: 0,
      promptChars: snapshot.promptChars,
      promptTokens: snapshot.promptTokens,
      resultChars: snapshot.resultChars,
      totalCostUsd: snapshot.totalCostUsd,
    };
  }

  const models = version.modelIds
    ? resolveTopicModels(kind, version.modelIds, modelConfigs)
    : fallbackModels;
  const promptChars = countTextChars(version.body);
  const promptTokens = estimateTextTokens(version.body);
  const resultText = kind === "text" ? getVersionResultText(version) : "";
  const resultChars = countTextChars(resultText);
  const rawImageCount =
    kind === "image" ? getImageCount(version, imagesByVersion) : 0;
  const billableImages = kind === "image" ? Math.max(1, rawImageCount) : 0;
  const modelCostItems = buildModelCostItems({
    billableImages,
    kind,
    models,
    promptTokens,
  });
  const { embeddingCostUsd, imageCostUsd, inputCostUsd } =
    summarizeModelCostItems(modelCostItems);

  return {
    embeddingCostUsd,
    embeddingTokens: modelCostItems.some((item) => item.role === "embedding")
      ? promptTokens
      : 0,
    imageCostUsd,
    imageCount: billableImages,
    inputCostUsd,
    inputTokens: promptTokens,
    kind,
    modelCostItems,
    modelIds: models.map((model) => model.id),
    outputCostUsd: 0,
    outputTokens: 0,
    promptChars,
    promptTokens,
    resultChars,
    totalCostUsd: inputCostUsd + imageCostUsd,
  };
};

const getModelDiff = (currentModelIds: string[], previousModelIds: string[]) => {
  const previousModelSet = new Set(previousModelIds);
  const currentModelSet = new Set(currentModelIds);

  return {
    modelAddedIds: currentModelIds.filter((modelId) => !previousModelSet.has(modelId)),
    modelRemovedIds: previousModelIds.filter((modelId) => !currentModelSet.has(modelId)),
  };
};

export const estimateVersionCostMetrics = (
  version: PromptVersion,
  previousVersion: PromptVersion | null,
  imagesByVersion: Record<string, Array<ImageAsset | DraftImage>>,
  fallbackModels: TopicModelConfig[],
  modelConfigs?: TopicModelConfig[],
): VersionCostMetrics => {
  const current = estimateVersionBaseMetrics(
    version,
    imagesByVersion,
    fallbackModels,
    modelConfigs,
  );
  const previous = previousVersion
    ? estimateVersionBaseMetrics(
        previousVersion,
        imagesByVersion,
        fallbackModels,
        modelConfigs,
      )
    : null;
  const { modelAddedIds, modelRemovedIds } = previous
    ? getModelDiff(current.modelIds, previous.modelIds)
    : { modelAddedIds: [], modelRemovedIds: [] };

  return {
    ...current,
    charDelta: previous
      ? current.promptChars - previous.promptChars
      : current.promptChars,
    costDeltaUsd: previous
      ? current.totalCostUsd - previous.totalCostUsd
      : current.totalCostUsd,
    modelAddedIds,
    modelRemovedIds,
    tokenDelta: previous
      ? current.promptTokens - previous.promptTokens
      : current.promptTokens,
    versionId: version.id,
  };
};

export const createCostSnapshot = (
  metrics: VersionCostMetrics,
): VersionCostSnapshot => ({
  estimatorVersion: costEstimatorVersion,
  imageCount: metrics.imageCount,
  modelCostItems: metrics.modelCostItems.map((item) => ({ ...item })),
  promptChars: metrics.promptChars,
  promptTokens: metrics.promptTokens,
  resultChars: metrics.resultChars,
  totalCostUsd: metrics.totalCostUsd,
});

export const estimateDraftCostMetrics = ({
  body,
  imageCount,
  imagesByVersion,
  kind,
  modelConfigs,
  modelIds,
  previousVersion,
  resultText,
}: {
  body: string;
  imageCount: number;
  imagesByVersion: Record<string, Array<ImageAsset | DraftImage>>;
  kind: PromptVersionKind;
  modelConfigs?: TopicModelConfig[];
  modelIds?: string[];
  previousVersion?: PromptVersion | null;
  resultText?: string;
}): VersionCostMetrics => {
  const resolvedModels = resolveTopicModels(kind, modelIds, modelConfigs);
  const draftVersion: PromptVersion = {
    id: "draft",
    topicId: "draft",
    kind,
    modelIds: resolvedModels.map((model) => model.id),
    label: "draft",
    body,
    resultText: kind === "text" ? resultText ?? "" : "",
    notes: "",
    createdAt: new Date().toISOString(),
  };
  const draftImagesByVersion = {
    ...imagesByVersion,
    draft: Array.from({ length: imageCount }, (_, index) => ({
      id: `draft-image-${index}`,
      name: `draft-image-${index + 1}`,
      type: "image/png",
      dataUrl: "",
    })),
  };

  return estimateVersionCostMetrics(
    draftVersion,
    previousVersion ?? null,
    draftImagesByVersion,
    resolvedModels,
    modelConfigs,
  );
};

export const buildVersionCostMetrics = (
  versions: PromptVersion[],
  imagesByVersion: Record<string, Array<ImageAsset | DraftImage>>,
  kind: PromptVersionKind,
  modelIds?: string[],
  modelConfigs?: TopicModelConfig[],
) => {
  const metricsByVersion: Record<string, VersionCostMetrics> = {};
  const resolvedModels = resolveTopicModels(kind, modelIds, modelConfigs);

  versions.forEach((version, index) => {
    metricsByVersion[version.id] = estimateVersionCostMetrics(
      version,
      versions[index - 1] ?? null,
      imagesByVersion,
      resolvedModels,
      modelConfigs,
    );
  });

  return metricsByVersion;
};
