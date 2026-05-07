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

const tokensPerTenThousandUnit = 10_000;

export const defaultInputTokenUnitInTenThousands = 100;

export const getInputRateParts = (model: {
  inputPriceUsd?: number;
  inputTokenUnitInTenThousands?: number;
}) => {
  const hasDirectInputRate =
    typeof model.inputPriceUsd === "number" &&
    Number.isFinite(model.inputPriceUsd) &&
    model.inputPriceUsd >= 0 &&
    typeof model.inputTokenUnitInTenThousands === "number" &&
    Number.isFinite(model.inputTokenUnitInTenThousands) &&
    model.inputTokenUnitInTenThousands > 0;

  return {
    inputPriceUsd: hasDirectInputRate ? (model.inputPriceUsd ?? 0) : 0,
    inputTokenUnitInTenThousands: hasDirectInputRate
      ? (model.inputTokenUnitInTenThousands ?? defaultInputTokenUnitInTenThousands)
      : defaultInputTokenUnitInTenThousands,
  };
};

export const costEstimatorVersion = 3;
export type CostCurrencyLocale = "ko" | "en";

export type TopicModelOption = TopicModelConfig & {
  label: string;
  selectionId: TopicModelId;
};

export type ModelCostItem = CostSnapshotModelItem;

type VersionBaseMetrics = Omit<
  VersionCostMetrics,
  "charDelta" | "costDeltaUsd" | "modelAddedIds" | "modelRemovedIds" | "tokenDelta" | "versionId"
>;

const builtInModelConfigs: TopicModelConfig[] = [
  {
    id: "grok-4-1-fast-non-reasoning",
    provider: "xAI",
    kind: "text",
    role: "chat-input",
    pricingType: "input",
    inputPriceUsd: 0.2,
    inputTokenUnitInTenThousands: 100,
  },
  {
    id: "text-embedding-3-small",
    provider: "OpenAI",
    kind: "text",
    role: "embedding",
    pricingType: "input",
    inputPriceUsd: 0.02,
    inputTokenUnitInTenThousands: 100,
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
  text: [
    "text:grok-4-1-fast-non-reasoning",
    "text:text-embedding-3-small",
  ],
  image: [
    "text:grok-4-1-fast-non-reasoning",
    "image:fal-ai/bytedance/seedream/v4.5/edit",
  ],
};

const legacyModelSelectionIdMap = new Map<TopicModelId, TopicModelId>([
  ["text:xai/grok-4-1-fast-non-reasoning", "text:grok-4-1-fast-non-reasoning"],
  ["xai/grok-4-1-fast-non-reasoning", "text:grok-4-1-fast-non-reasoning"],
  ["text:openai/text-embedding-3-small", "text:text-embedding-3-small"],
  ["openai/text-embedding-3-small", "text:text-embedding-3-small"],
]);

export const normalizeLegacyModelSelectionId = (modelId: TopicModelId) =>
  legacyModelSelectionIdMap.get(modelId) ?? modelId;

const isValidModelConfig = (model: TopicModelConfig) => {
  if (!model.id.trim() || !model.provider.trim()) {
    return false;
  }

  if (model.pricingType === "image") {
    return typeof model.costPerImageUsd === "number" && model.costPerImageUsd >= 0;
  }

  return (
    typeof model.inputPriceUsd === "number" &&
    Number.isFinite(model.inputPriceUsd) &&
    model.inputPriceUsd >= 0 &&
    typeof model.inputTokenUnitInTenThousands === "number" &&
    Number.isFinite(model.inputTokenUnitInTenThousands) &&
    model.inputTokenUnitInTenThousands > 0
  );
};

export const getModelSelectionId = (model: Pick<TopicModelConfig, "id" | "kind">) =>
  `${model.kind}:${model.id}`;

const modelAppliesToTopicKind = (
  topicKind: PromptVersionKind,
  modelKind: TopicModelConfig["kind"],
) => modelKind === "text" || modelKind === topicKind;

export const modelKindOrder: Record<TopicModelConfig["kind"], number> = {
  text: 0,
  image: 1,
  voice: 2,
  video: 3,
};

export const getAvailableModelConfigs = (
  kind: PromptVersionKind,
  customModels: TopicModelConfig[] = [],
): TopicModelConfig[] => {
  const modelMap = new Map<TopicModelId, TopicModelConfig>();
  const validCustomModels = customModels.filter(
    (model) => modelAppliesToTopicKind(kind, model.kind) && isValidModelConfig(model),
  );
  const overriddenModelKeys = new Set(
    validCustomModels
      .map((model) =>
        model.overridesModelKey
          ? normalizeLegacyModelSelectionId(model.overridesModelKey)
          : undefined,
      )
      .filter((modelKey): modelKey is TopicModelId => Boolean(modelKey)),
  );

  for (const model of builtInModelConfigs) {
    const modelKey = getModelSelectionId(model);

    if (modelAppliesToTopicKind(kind, model.kind) && !overriddenModelKeys.has(modelKey)) {
      modelMap.set(modelKey, model);
    }
  }

  for (const model of validCustomModels) {
    modelMap.set(getModelSelectionId(model), model);
  }

  return Array.from(modelMap.values()).sort(
    (a, b) => modelKindOrder[a.kind] - modelKindOrder[b.kind],
  );
};

export const resolveTopicModelIds = (
  kind: PromptVersionKind,
  modelIds?: string[],
  customModels?: TopicModelConfig[],
): TopicModelId[] => {
  const availableModels = getAvailableModelConfigs(kind, customModels);
  const availableModelIds = new Set(
    availableModels.map((model) => getModelSelectionId(model)),
  );
  const normalizedModelIds = Array.from(
    new Set(
      (modelIds ?? [])
        .map((modelId) => {
          const normalizedLegacyModelId = normalizeLegacyModelSelectionId(modelId);

          if (availableModelIds.has(normalizedLegacyModelId)) {
            return normalizedLegacyModelId;
          }

          const overrideMatch = availableModels.find(
            (model) =>
              model.overridesModelKey &&
              normalizeLegacyModelSelectionId(model.overridesModelKey) ===
                normalizedLegacyModelId,
          );
          if (overrideMatch) {
            return getModelSelectionId(overrideMatch);
          }

          const legacyMatch = availableModels.find(
            (model) =>
              model.id === normalizedLegacyModelId ||
              getModelSelectionId(model) === normalizedLegacyModelId,
          );

          return legacyMatch ? getModelSelectionId(legacyMatch) : null;
        })
        .filter((modelId): modelId is TopicModelId => Boolean(modelId)),
    ),
  );

  return normalizedModelIds.length > 0 ? normalizedModelIds : defaultModelIdsByKind[kind];
};

export const resolveTopicModels = (
  kind: PromptVersionKind,
  modelIds?: string[],
  customModels?: TopicModelConfig[],
): TopicModelConfig[] => {
  const availableModels = getAvailableModelConfigs(kind, customModels);
  const availableModelMap = new Map(
    availableModels.map((model) => [getModelSelectionId(model), model]),
  );
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
    selectionId: getModelSelectionId(model),
  }));

export const getModelDisplayName = (modelId: string) =>
  modelId.includes(":") ? modelId.slice(modelId.indexOf(":") + 1) : modelId;

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

const estimateInputCost = (
  tokens: number,
  model: {
    inputPriceUsd?: number;
    inputTokenUnitInTenThousands?: number;
  },
) => {
  const { inputPriceUsd, inputTokenUnitInTenThousands } =
    getInputRateParts(model);
  const pricedTokenCount =
    inputTokenUnitInTenThousands * tokensPerTenThousandUnit;

  return pricedTokenCount > 0 ? (tokens / pricedTokenCount) * inputPriceUsd : 0;
};

const getBillableImageCount = (kind: PromptVersionKind, rawImageCount: number) =>
  kind === "image" ? Math.max(1, rawImageCount) : 0;

const sumCostItems = (modelCostItems: ModelCostItem[]) =>
  modelCostItems.reduce((total, item) => total + item.costUsd, 0);

const sumInputTokens = (modelCostItems: ModelCostItem[]) =>
  modelCostItems
    .filter((item) => item.type === "input")
    .reduce((total, item) => total + (item.tokenCount ?? 0), 0);

const sumEmbeddingTokens = (modelCostItems: ModelCostItem[]) =>
  modelCostItems
    .filter((item) => item.role === "embedding")
    .reduce((total, item) => total + (item.tokenCount ?? 0), 0);

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
    if (!modelAppliesToTopicKind(kind, model.kind)) {
      return [];
    }

    if (model.pricingType === "image") {
      return [
        {
          costPerImageUsd: model.costPerImageUsd ?? 0,
          costUsd: (model.costPerImageUsd ?? 0) * (billableImages > 0 ? 1 : 0),
          imageCount: billableImages > 0 ? 1 : 0,
          modelId: model.id,
          provider: model.provider,
          role: model.role,
          type: "image",
        },
      ];
    }

    return [
      {
        costUsd: estimateInputCost(promptTokens, model),
        inputPriceUsd: getInputRateParts(model).inputPriceUsd,
        inputTokenUnitInTenThousands:
          getInputRateParts(model).inputTokenUnitInTenThousands,
        modelId: model.id,
        provider: model.provider,
        role: model.role,
        runCount: 1,
        tokenCount: promptTokens,
        tokensPerRun: promptTokens,
        type: "input",
      },
    ];
  });
};

const repriceSnapshotModelCostItems = (
  snapshot: VersionCostSnapshot,
  kind: PromptVersionKind,
): ModelCostItem[] => {
  const billableImages = getBillableImageCount(kind, snapshot.imageCount);

  return (snapshot.modelCostItems ?? []).map((item) => {
    if (kind !== "image") {
      return { ...item };
    }

    if (item.type === "image") {
      const costPerImageUsd =
        item.costPerImageUsd ??
        (item.imageCount && item.imageCount > 0
          ? item.costUsd / item.imageCount
          : 0);

      return {
        ...item,
        costPerImageUsd,
        costUsd: billableImages > 0 ? costPerImageUsd : 0,
        imageCount: billableImages > 0 ? 1 : 0,
      };
    }

    const tokensPerRun = item.tokensPerRun ?? snapshot.promptTokens;

    return {
      ...item,
      costUsd: estimateInputCost(tokensPerRun, item),
      runCount: 1,
      tokenCount: tokensPerRun,
      tokensPerRun,
    };
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
    const modelCostItems = repriceSnapshotModelCostItems(snapshot, kind);
    const { embeddingCostUsd, imageCostUsd, inputCostUsd } =
      summarizeModelCostItems(modelCostItems);
    const modelIds = version.modelIds ?? modelCostItems.map((item) => item.modelId);

    return {
      embeddingCostUsd,
      embeddingTokens: sumEmbeddingTokens(modelCostItems),
      imageCostUsd,
      imageCount: snapshot.imageCount,
      inputCostUsd,
      inputTokens: sumInputTokens(modelCostItems),
      kind,
      modelCostItems,
      modelIds,
      outputCostUsd: 0,
      outputTokens: 0,
      promptChars: snapshot.promptChars,
      promptTokens: snapshot.promptTokens,
      resultChars: snapshot.resultChars,
      totalCostUsd: sumCostItems(modelCostItems),
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
  const billableImages = getBillableImageCount(kind, rawImageCount);
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
    embeddingTokens: sumEmbeddingTokens(modelCostItems),
    imageCostUsd,
    imageCount: billableImages,
    inputCostUsd,
    inputTokens: sumInputTokens(modelCostItems),
    kind,
    modelCostItems,
    modelIds: models.map((model) => getModelSelectionId(model)),
    outputCostUsd: 0,
    outputTokens: 0,
    promptChars,
    promptTokens,
    resultChars,
    totalCostUsd: sumCostItems(modelCostItems),
  };
};

const getModelDiffKey = (modelId: string) => {
  const normalizedModelId = normalizeLegacyModelSelectionId(modelId);
  const separatorIndex = normalizedModelId.indexOf(":");

  return separatorIndex >= 0
    ? normalizedModelId.slice(separatorIndex + 1)
    : normalizedModelId;
};

const getModelDiff = (currentModelIds: string[], previousModelIds: string[]) => {
  const previousModelSet = new Set(previousModelIds.map(getModelDiffKey));
  const currentModelSet = new Set(currentModelIds.map(getModelDiffKey));

  return {
    modelAddedIds: currentModelIds.filter(
      (modelId) => !previousModelSet.has(getModelDiffKey(modelId)),
    ),
    modelRemovedIds: previousModelIds.filter(
      (modelId) => !currentModelSet.has(getModelDiffKey(modelId)),
    ),
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

export const repriceCostSnapshotForResultCount = ({
  kind,
  rawImageCount,
  resultText,
  snapshot,
}: {
  kind: PromptVersionKind;
  rawImageCount: number;
  resultText: string;
  snapshot: VersionCostSnapshot;
}): VersionCostSnapshot => {
  const imageCount = getBillableImageCount(kind, rawImageCount);
  const nextSnapshot = {
    ...snapshot,
    estimatorVersion: costEstimatorVersion,
    imageCount,
    resultChars: kind === "text" ? countTextChars(resultText) : 0,
  };
  const modelCostItems = repriceSnapshotModelCostItems(nextSnapshot, kind);

  return {
    ...nextSnapshot,
    modelCostItems,
    totalCostUsd: sumCostItems(modelCostItems),
  };
};

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
    modelIds: resolvedModels.map((model) => getModelSelectionId(model)),
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
