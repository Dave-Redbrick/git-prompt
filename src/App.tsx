import {
  ChangeEvent,
  DragEvent,
  Fragment,
  FormEvent,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import {
  ChartNoAxesColumnIncreasing,
  ChevronDown,
  Diff,
  Download,
  FileImage,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  GitBranch,
  ImageIcon,
  Mic,
  Moon,
  PanelLeft,
  Pencil,
  Plus,
  Save,
  Sparkles,
  Sun,
  Trash2,
  Upload,
  Video,
  X,
} from "lucide-react";
import {
  ConfirmModal,
  type ConfirmDialogState,
} from "./components/ConfirmModal";
import {
  CostTrendPanel,
  type ThemeCostSummary,
} from "./components/CostTrendPanel";
import { DiffPanel } from "./components/DiffPanel";
import { HistoryGraph } from "./components/HistoryGraph";
import { Toast, type ToastState, type ToastVariant } from "./components/Toast";
import { TagPopoverSelect } from "./components/TagPopoverSelect";
import { TreeRow } from "./components/TreeRow";
import { WritePanel } from "./components/WritePanel";
import {
  createId,
  deleteItem,
  getAll,
  nowIso,
  putItem,
  seedIfEmpty,
} from "./lib/db";
import {
  buildVersionCostMetrics,
  createCostSnapshot,
  defaultModelIdsByKind,
  estimateDraftCostMetrics,
  formatCurrency,
  getInputRateParts,
  getAvailableModelConfigs,
  getModelDisplayName,
  getModelOptions,
  modelKindOrder,
  normalizeLegacyModelSelectionId,
  repriceCostSnapshotForResultCount,
  resolveTopicModelIds,
} from "./lib/costEstimator";
import { diffLines } from "./lib/diff";
import { useUsdKrwExchangeRate } from "./lib/exchangeRate";
import {
  countImageResultMedia,
  copySystemPromptsToDraft,
  createSystemPrompt,
  copyImagesToDraft,
  draftImagesMatchStoredImages,
  getTopicKind,
  getCombinedPromptText,
  getSystemPromptText,
  getVersionKind,
  getVersionResultText,
  getVersionResultTexts,
  getVersionSystemPrompts,
  getVersionUserPrompt,
  joinResultTexts,
  normalizeResultTexts,
  normalizeSystemPrompts,
  getResultMediaKind,
  systemPromptListsMatch,
} from "./lib/promptVersions";
import {
  createProjectArchiveZip,
  downloadBlob,
  importProjectArchiveZip,
} from "./lib/projectArchive";
import { localeKey, messages, readLocale, type Locale } from "./i18n";
import type {
  DraftImage,
  ImageAsset,
  Project,
  PromptDraft,
  PromptVersion,
  PromptVersionKind,
  SystemPrompt,
  Theme,
  TopicModelConfig,
  TopicModelId,
  TopicModelKind,
  Topic,
} from "./types";

const selectionKey = "prompt-reinforcer-selection";
const folderStateKey = "prompt-reinforcer-folder-state";
const appearanceKey = "prompt-reinforcer-appearance";
const customModelsKey = "prompt-reinforcer-custom-models";
const themeColors = [
  "#EF4444",
  "#F97316",
  "#F6C453",
  "#4ADE80",
  "#38BDF8",
  "#5B8DEF",
  "#A78BFA",
];

type Selection = {
  projectId: string;
  themeId: string;
  topicId: string;
};

type FolderState = {
  projectThemeIds: Record<string, string>;
  themeTopicIds: Record<string, string>;
};

type AppearanceTheme = "light" | "dark";
type CompareDirection = "previous" | "next";
type SidebarView = "explorer" | "history" | "models";
type RenameTarget = {
  kind: "project" | "theme" | "topic";
  id: string;
  value: string;
};
type TreeDragTarget = {
  kind: RenameTarget["kind"];
  id: string;
};
type DropPreviewPosition = "before" | "after";
type TreeDropPreview = TreeDragTarget & {
  position: DropPreviewPosition;
};
type TreeDragOverlay = TreeDragTarget & {
  height: number;
  offsetX: number;
  offsetY: number;
  width: number;
  x: number;
  y: number;
};

type OrderedEntity = {
  id: string;
  order?: number;
};

type SystemPromptDiffBlock = {
  key: string;
  label: string;
  rows: ReturnType<typeof diffLines>;
};

type DraftHistorySnapshot = {
  images: DraftImage[];
  kind: PromptVersionKind;
  label: string;
  notes: string;
  resultTexts: string[];
  systemPrompts: SystemPrompt[];
  userPrompt: string;
};

type OrderHistorySnapshotItem = {
  id: string;
  order: number;
};

type TreeOrderHistorySnapshot = {
  projects: OrderHistorySnapshotItem[];
  themes: OrderHistorySnapshotItem[];
  topics: OrderHistorySnapshotItem[];
};

type HistoryActionKind = "draft" | "tree-order";

type StoreState = {
  projects: Project[];
  themes: Theme[];
  topics: Topic[];
  versions: PromptVersion[];
  images: ImageAsset[];
  drafts: PromptDraft[];
};

const emptyStoreState: StoreState = {
  projects: [],
  themes: [],
  topics: [],
  versions: [],
  images: [],
  drafts: [],
};

const compareCreatedAtAsc = <T extends { createdAt: string }>(left: T, right: T) =>
  left.createdAt.localeCompare(right.createdAt);

const compareUpdatedAtDesc = <T extends { updatedAt: string }>(left: T, right: T) =>
  right.updatedAt.localeCompare(left.updatedAt);

const getOrderedValue = (item: OrderedEntity, fallbackIndex: number) =>
  Number.isFinite(item.order) ? item.order ?? fallbackIndex : fallbackIndex;

const sortByDisplayOrder = <T extends OrderedEntity>(
  items: T[],
  fallbackCompare: (left: T, right: T) => number,
) => {
  const fallbackSortedItems = [...items].sort(fallbackCompare);
  const fallbackIndexById = new Map(
    fallbackSortedItems.map((item, index) => [item.id, index]),
  );

  return [...items].sort((left, right) => {
    const leftIndex = fallbackIndexById.get(left.id) ?? 0;
    const rightIndex = fallbackIndexById.get(right.id) ?? 0;
    const orderDelta =
      getOrderedValue(left, leftIndex) - getOrderedValue(right, rightIndex);

    return orderDelta || leftIndex - rightIndex;
  });
};

const sortProjectsByDisplayOrder = (projects: Project[]) =>
  sortByDisplayOrder(projects, compareCreatedAtAsc);

const sortThemesByDisplayOrder = (themes: Theme[]) =>
  sortByDisplayOrder(themes, compareCreatedAtAsc);

const sortTopicsByDisplayOrder = (topics: Topic[]) =>
  sortByDisplayOrder(topics, compareUpdatedAtDesc);

const getNextOrder = (items: OrderedEntity[]) =>
  items.reduce(
    (nextOrder, item, index) =>
      Math.max(nextOrder, getOrderedValue(item, index) + 1),
    0,
  );

const applySequentialOrder = <T extends OrderedEntity>(items: T[]) =>
  items.map((item, index) => ({ ...item, order: index }));

const moveItemById = <T extends OrderedEntity>(
  items: T[],
  draggedId: string,
  targetId: string,
  insertAfter: boolean,
) => {
  if (draggedId === targetId) {
    return items;
  }

  const draggedIndex = items.findIndex((item) => item.id === draggedId);
  const targetIndex = items.findIndex((item) => item.id === targetId);

  if (draggedIndex < 0 || targetIndex < 0) {
    return items;
  }

  const nextItems = [...items];
  const [draggedItem] = nextItems.splice(draggedIndex, 1);
  const targetIndexAfterRemoval = nextItems.findIndex(
    (item) => item.id === targetId,
  );
  const insertionIndex = targetIndexAfterRemoval + (insertAfter ? 1 : 0);

  nextItems.splice(insertionIndex, 0, draggedItem);
  return nextItems;
};

const moveItemByIndex = <T,>(
  items: T[],
  draggedIndex: number,
  targetIndex: number,
  insertAfter: boolean,
) => {
  if (draggedIndex === targetIndex) {
    return items;
  }

  const nextItems = [...items];
  const [draggedItem] = nextItems.splice(draggedIndex, 1);
  const targetIndexAfterRemoval =
    draggedIndex < targetIndex ? targetIndex - 1 : targetIndex;
  const insertionIndex = targetIndexAfterRemoval + (insertAfter ? 1 : 0);

  nextItems.splice(insertionIndex, 0, draggedItem);
  return nextItems;
};

const isDropAfterTarget = (
  event: DragEvent<HTMLElement>,
  anchorY = event.clientY,
) => {
  const rect = event.currentTarget.getBoundingClientRect();

  return anchorY > rect.top + rect.height / 2;
};

const readSelection = (): Selection => {
  try {
    return JSON.parse(localStorage.getItem(selectionKey) ?? "{}") as Selection;
  } catch {
    return { projectId: "", themeId: "", topicId: "" };
  }
};

const readFolderState = (): FolderState => {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(folderStateKey) ?? "{}",
    ) as Partial<FolderState>;

    return {
      projectThemeIds: parsed.projectThemeIds ?? {},
      themeTopicIds: parsed.themeTopicIds ?? {},
    };
  } catch {
    return { projectThemeIds: {}, themeTopicIds: {} };
  }
};

const readAppearanceTheme = (): AppearanceTheme => {
  try {
    return localStorage.getItem(appearanceKey) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
};

const isPromptVersionKind = (value: unknown): value is PromptVersionKind =>
  value === "text" ||
  value === "image" ||
  value === "audio" ||
  value === "video";

const isTopicModelKind = (value: unknown): value is TopicModelKind =>
  value === "text" ||
  value === "image" ||
  value === "voice" ||
  value === "video";

const getDefaultCustomModelPrice = (kind: TopicModelKind) =>
  kind === "image" ? "0.04" : "0.20";

const isTopicModelConfig = (value: unknown): value is TopicModelConfig => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const model = value as Partial<TopicModelConfig>;
  const hasInputPrice =
    model.pricingType === "input" &&
    typeof model.inputPriceUsd === "number" &&
    Number.isFinite(model.inputPriceUsd) &&
    model.inputPriceUsd >= 0 &&
    typeof model.inputTokenUnitInTenThousands === "number" &&
    Number.isFinite(model.inputTokenUnitInTenThousands) &&
    model.inputTokenUnitInTenThousands > 0;
  const hasImagePrice =
    model.pricingType === "image" &&
    typeof model.costPerImageUsd === "number" &&
    Number.isFinite(model.costPerImageUsd) &&
    model.costPerImageUsd >= 0;

  return (
    typeof model.id === "string" &&
    model.id.trim().length > 0 &&
    typeof model.provider === "string" &&
    model.provider.trim().length > 0 &&
    isTopicModelKind(model.kind) &&
    (model.role === "chat-input" ||
      model.role === "embedding" ||
      model.role === "prompt-refiner" ||
      model.role === "image-generation" ||
      model.role === "voice" ||
      model.role === "video") &&
    (hasInputPrice || hasImagePrice)
  );
};

const normalizeCustomModels = (models: TopicModelConfig[]) => {
  const modelMap = new Map<string, TopicModelConfig>();

  models.forEach((model) => {
    const provider = model.provider.trim();
    const id = model.id.trim();
    const inputRate =
      model.pricingType === "input" ? getInputRateParts(model) : null;

    modelMap.set(`${model.kind}:${id}`, {
      ...model,
      id,
      provider,
      memo: model.memo?.trim(),
      overridesModelKey: model.overridesModelKey
        ? normalizeLegacyModelSelectionId(model.overridesModelKey)
        : undefined,
      ...(inputRate
        ? {
            inputPriceUsd: inputRate.inputPriceUsd,
            inputTokenUnitInTenThousands:
              inputRate.inputTokenUnitInTenThousands,
          }
        : {}),
    });
  });

  return Array.from(modelMap.values());
};

const readCustomModels = (): TopicModelConfig[] => {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(customModelsKey) ?? "[]",
    ) as unknown;
    const models = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { models?: unknown }).models)
        ? (parsed as { models: unknown[] }).models
        : [];

    return normalizeCustomModels(models.filter(isTopicModelConfig));
  } catch {
    return [];
  }
};

const imageOptimizationMinBytes = 1_000_000;
const imageOptimizationQuality = 0.86;
const imageOptimizationTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const imageOptimizationExtensions: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const readBlobAsDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });

const getFhdImageBounds = (width: number, height: number) =>
  width >= height
    ? { width: 1920, height: 1080 }
    : { width: 1080, height: 1920 };

const getOptimizedImageName = (name: string, type: string) => {
  const extension = imageOptimizationExtensions[type];
  if (!extension) {
    return name;
  }

  return /\.[^.]+$/.test(name)
    ? name.replace(/\.[^.]+$/, `.${extension}`)
    : `${name}.${extension}`;
};

const canvasToBlob = (
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
): Promise<Blob | null> =>
  new Promise((resolve) => canvas.toBlob(resolve, type, quality));

const canvasHasTransparency = (
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
) => {
  const data = context.getImageData(0, 0, width, height).data;

  for (let index = 3; index < data.length; index += 4) {
    if (data[index] < 255) {
      return true;
    }
  }

  return false;
};

type DecodedImageSource = {
  cleanup: () => void;
  height: number;
  source: CanvasImageSource;
  width: number;
};

const decodeImageFile = async (file: File): Promise<DecodedImageSource> => {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file, {
      imageOrientation: "from-image",
    });

    return {
      cleanup: () => bitmap.close(),
      height: bitmap.height,
      source: bitmap,
      width: bitmap.width,
    };
  }

  const objectUrl = URL.createObjectURL(file);

  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Failed to decode image file."));
    };
    image.onload = () => {
      resolve({
        cleanup: () => URL.revokeObjectURL(objectUrl),
        height: image.naturalHeight || image.height,
        source: image,
        width: image.naturalWidth || image.width,
      });
    };
    image.src = objectUrl;
  });
};

const optimizeImageFile = async (
  file: File,
  name: string,
): Promise<{ blob: Blob; name: string; type: string } | null> => {
  const sourceType = file.type || "application/octet-stream";
  if (!imageOptimizationTypes.has(sourceType)) {
    return null;
  }

  let decodedImage: DecodedImageSource | null = null;

  try {
    decodedImage = await decodeImageFile(file);
    const bounds = getFhdImageBounds(decodedImage.width, decodedImage.height);
    const scale = Math.min(
      1,
      bounds.width / decodedImage.width,
      bounds.height / decodedImage.height,
    );

    if (scale === 1 && file.size < imageOptimizationMinBytes) {
      return null;
    }

    const targetWidth = Math.max(1, Math.round(decodedImage.width * scale));
    const targetHeight = Math.max(1, Math.round(decodedImage.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const context = canvas.getContext("2d");
    if (!context) {
      return null;
    }

    context.drawImage(decodedImage.source, 0, 0, targetWidth, targetHeight);

    const targetType =
      sourceType === "image/png" &&
      canvasHasTransparency(context, targetWidth, targetHeight)
        ? "image/png"
        : sourceType === "image/webp"
          ? "image/webp"
          : "image/jpeg";
    const blob = await canvasToBlob(
      canvas,
      targetType,
      targetType === "image/png" ? undefined : imageOptimizationQuality,
    );

    if (!blob || (scale === 1 && blob.size >= file.size)) {
      return null;
    }

    const blobType = blob.type || targetType;

    return {
      blob,
      name: getOptimizedImageName(name, blobType),
      type: blobType,
    };
  } catch {
    return null;
  } finally {
    decodedImage?.cleanup();
  }
};

const fileToDraftImage = async (
  file: File,
  fallbackName = "clipboard-image.png",
): Promise<DraftImage> => {
  const name = file.name || fallbackName;
  const type = file.type || "application/octet-stream";
  const kind = getResultMediaKind({ name, type });
  const optimizedImage =
    kind === "image" ? await optimizeImageFile(file, name) : null;
  const blob = optimizedImage?.blob ?? file;
  const dataUrl = await readBlobAsDataUrl(blob);

  return {
    id: createId(),
    name: optimizedImage?.name ?? name,
    kind,
    type: optimizedImage?.type ?? type,
    dataUrl,
  };
};

const getCurrentClipboardImageFiles = (clipboardData: DataTransfer) => {
  const types = Array.from(clipboardData.types);
  if (!types.includes("Files")) {
    return [];
  }

  const directFiles = Array.from(clipboardData.files).filter((file) =>
    file.type.startsWith("image/"),
  );
  if (directFiles.length > 0) {
    return directFiles;
  }

  return Array.from(clipboardData.items)
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));
};

const toEditableResultTexts = (texts: string[]) =>
  texts.length > 0 ? texts : [""];

const getEditableVersionResultTexts = (version?: PromptVersion | null) =>
  toEditableResultTexts(getVersionResultTexts(version));

const isFileResultTopicKind = (
  kind: PromptVersionKind,
): kind is Exclude<PromptVersionKind, "text"> => kind !== "text";

const fileMatchesResultTopicKind = (file: File, kind: PromptVersionKind) => {
  if (!isFileResultTopicKind(kind)) {
    return false;
  }

  const resultKind = getResultMediaKind({
    name: file.name,
    type: file.type || "application/octet-stream",
  });

  return resultKind === kind;
};

const getTopicIconComponent = (kind: PromptVersionKind) => {
  if (kind === "image") {
    return FileImage;
  }

  if (kind === "audio") {
    return Mic;
  }

  if (kind === "video") {
    return Video;
  }

  return FileText;
};

const upsertDraft = (drafts: PromptDraft[], draft: PromptDraft) => {
  const nextDrafts = drafts.filter((item) => item.topicId !== draft.topicId);

  return [...nextDrafts, draft];
};

const draftHistoryLimit = 30;

const cloneSystemPrompts = (systemPrompts: SystemPrompt[]) =>
  systemPrompts.map((prompt) => ({ ...prompt }));

const cloneDraftImages = (images: DraftImage[]) =>
  images.map((image) => ({ ...image }));

const draftImagesEqual = (left: DraftImage[], right: DraftImage[]) =>
  left.length === right.length &&
  left.every((image, index) => {
    const other = right[index];

    return (
      image.id === other?.id &&
      image.sourceId === other?.sourceId &&
      image.kind === other?.kind &&
      image.name === other?.name &&
      image.order === other?.order &&
      image.type === other?.type &&
      image.dataUrl === other?.dataUrl
    );
  });

const systemPromptsEqual = (left: SystemPrompt[], right: SystemPrompt[]) =>
  left.length === right.length &&
  left.every((prompt, index) => {
    const other = right[index];

    return (
      prompt.id === other?.id &&
      prompt.name === other?.name &&
      prompt.body === other?.body
    );
  });

const draftHistorySnapshotsEqual = (
  left: DraftHistorySnapshot,
  right: DraftHistorySnapshot,
) =>
  left.kind === right.kind &&
  left.label === right.label &&
  left.notes === right.notes &&
  left.userPrompt === right.userPrompt &&
  left.resultTexts.length === right.resultTexts.length &&
  left.resultTexts.every((text, index) => text === right.resultTexts[index]) &&
  systemPromptsEqual(left.systemPrompts, right.systemPrompts) &&
  draftImagesEqual(left.images, right.images);

const orderHistoryItemsEqual = (
  left: OrderHistorySnapshotItem[],
  right: OrderHistorySnapshotItem[],
) =>
  left.length === right.length &&
  left.every((item, index) => {
    const other = right[index];

    return item.id === other?.id && item.order === other?.order;
  });

const treeOrderHistorySnapshotsEqual = (
  left: TreeOrderHistorySnapshot,
  right: TreeOrderHistorySnapshot,
) =>
  orderHistoryItemsEqual(left.projects, right.projects) &&
  orderHistoryItemsEqual(left.themes, right.themes) &&
  orderHistoryItemsEqual(left.topics, right.topics);

const getSystemPromptBuckets = (systemPrompts: SystemPrompt[]) =>
  systemPrompts.reduce<Map<string, SystemPrompt[]>>((buckets, prompt) => {
    const prompts = buckets.get(prompt.name) ?? [];

    buckets.set(prompt.name, [...prompts, prompt]);

    return buckets;
  }, new Map());

const buildSystemPromptDiffBlocks = (
  baseSystemPrompts: SystemPrompt[],
  targetSystemPrompts: SystemPrompt[],
): SystemPromptDiffBlock[] => {
  const normalizedBasePrompts =
    baseSystemPrompts.length > 0 ? normalizeSystemPrompts(baseSystemPrompts) : [];
  const normalizedTargetPrompts =
    targetSystemPrompts.length > 0
      ? normalizeSystemPrompts(targetSystemPrompts)
      : [];
  const orderedNames: string[] = [];
  const addOrderedName = (name: string) => {
    if (!orderedNames.includes(name)) {
      orderedNames.push(name);
    }
  };

  normalizedBasePrompts.forEach((prompt) => addOrderedName(prompt.name));
  normalizedTargetPrompts.forEach((prompt) => addOrderedName(prompt.name));

  const baseBuckets = getSystemPromptBuckets(normalizedBasePrompts);
  const targetBuckets = getSystemPromptBuckets(normalizedTargetPrompts);

  return orderedNames.flatMap((name) => {
    const basePrompts = baseBuckets.get(name) ?? [];
    const targetPrompts = targetBuckets.get(name) ?? [];
    const count = Math.max(basePrompts.length, targetPrompts.length);

    return Array.from({ length: count }, (_item, index) => ({
      key: `${name}:${index}`,
      label: count > 1 ? `${name} #${index + 1}` : name,
      rows: diffLines(
        basePrompts[index]?.body ?? "",
        targetPrompts[index]?.body ?? "",
      ),
    }));
  });
};

const toStoredSystemPrompts = (systemPrompts: SystemPrompt[]) =>
  normalizeSystemPrompts(systemPrompts).map((prompt) => ({
    ...prompt,
    body: prompt.body.trim(),
  }));

export function App() {
  const savedSelection = useMemo(readSelection, []);
  const projectImportInputRef = useRef<HTMLInputElement>(null);
  const customModelImportInputRef = useRef<HTMLInputElement>(null);
  const customModelProviderPickerRef = useRef<HTMLDivElement>(null);
  const treeDragActiveRef = useRef(false);
  const suppressTreeSelectionUntilRef = useRef(0);
  const [folderState, setFolderState] = useState<FolderState>(readFolderState);
  const [appearanceTheme, setAppearanceTheme] =
    useState<AppearanceTheme>(readAppearanceTheme);
  const [locale, setLocale] = useState<Locale>(readLocale);
  const ui = messages[locale];

  const createDraftSystemPrompt = (body = "", index = 1) =>
    createSystemPrompt(body, ui.systemPromptNamePlaceholder(index));

  const [store, setStore] = useState<StoreState>(emptyStoreState);
  const [selectedProjectId, setSelectedProjectId] = useState(
    savedSelection.projectId,
  );
  const [selectedThemeId, setSelectedThemeId] = useState(
    savedSelection.themeId,
  );
  const [selectedTopicId, setSelectedTopicId] = useState(
    savedSelection.topicId,
  );
  const [activeVersionId, setActiveVersionId] = useState("draft");
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(
    null,
  );
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [sidebarView, setSidebarView] = useState<SidebarView>("explorer");
  const [mainView, setMainView] = useState<"write" | "diff" | "cost">("write");
  const [compareDirection, setCompareDirection] =
    useState<CompareDirection>("previous");
  const [baseResultDiffIndex, setBaseResultDiffIndex] = useState(0);
  const [targetResultDiffIndex, setTargetResultDiffIndex] = useState(0);
  const [createPanel, setCreatePanel] = useState<
    "project" | "theme" | "topic" | null
  >(null);
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null);
  const [draggedTreeTarget, setDraggedTreeTarget] =
    useState<TreeDragTarget | null>(null);
  const [treeDropPreview, setTreeDropPreview] =
    useState<TreeDropPreview | null>(null);
  const [treeDragOverlay, setTreeDragOverlay] =
    useState<TreeDragOverlay | null>(null);
  const [treeDragSourceHidden, setTreeDragSourceHidden] = useState(false);
  const treeDragSourceHideFrameRef = useRef<number | null>(null);
  const treeDragOverlayFrameRef = useRef<number | null>(null);
  const treeDragOverlayPointRef = useRef<{ x: number; y: number } | null>(null);
  const [customModels, setCustomModels] =
    useState<TopicModelConfig[]>(readCustomModels);
  const [customModelKind, setCustomModelKind] =
    useState<TopicModelKind>("text");

  const [newProjectName, setNewProjectName] = useState("");
  const [newThemeName, setNewThemeName] = useState("");
  const [newThemeColor, setNewThemeColor] = useState(themeColors[0]);
  const [newTopicTitle, setNewTopicTitle] = useState("");
  const [newTopicBrief, setNewTopicBrief] = useState("");
  const [newTopicKind, setNewTopicKind] = useState<PromptVersionKind>("text");
  const [newTopicModelIds, setNewTopicModelIds] = useState<TopicModelId[]>(
    defaultModelIdsByKind.text,
  );
  const [customModelProvider, setCustomModelProvider] = useState("xAI");
  const [customModelProviderDraft, setCustomModelProviderDraft] = useState("");
  const [customModelProviderOpen, setCustomModelProviderOpen] = useState(false);
  const [customModelId, setCustomModelId] = useState("");
  const [customModelMemo, setCustomModelMemo] = useState("");
  const [customModelPrice, setCustomModelPrice] = useState(
    getDefaultCustomModelPrice("text"),
  );
  const [editingModelKey, setEditingModelKey] = useState<string | null>(null);
  const [
    customModelTokenUnitInTenThousands,
    setCustomModelTokenUnitInTenThousands,
  ] = useState("100");

  const [draftKind, setDraftKind] = useState<PromptVersionKind>("text");
  const [draftLabel, setDraftLabel] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [draftSystemPrompts, setDraftSystemPrompts] = useState<SystemPrompt[]>(
    () => [createDraftSystemPrompt()],
  );
  const [draftUserPrompt, setDraftUserPrompt] = useState("");
  const [draftResultTexts, setDraftResultTexts] = useState<string[]>([""]);
  const [draftNotes, setDraftNotes] = useState("");
  const [draftImages, setDraftImages] = useState<DraftImage[]>([]);
  const [editingVersionId, setEditingVersionId] = useState<string | null>(null);
  const [pasteTargetActive, setPasteTargetActive] = useState(false);
  const [draftUndoStack, setDraftUndoStack] = useState<DraftHistorySnapshot[]>(
    [],
  );
  const [draftRedoStack, setDraftRedoStack] = useState<DraftHistorySnapshot[]>(
    [],
  );
  const [treeOrderUndoStack, setTreeOrderUndoStack] = useState<
    TreeOrderHistorySnapshot[]
  >([]);
  const [treeOrderRedoStack, setTreeOrderRedoStack] = useState<
    TreeOrderHistorySnapshot[]
  >([]);
  const [historyUndoStack, setHistoryUndoStack] = useState<HistoryActionKind[]>(
    [],
  );
  const [historyRedoStack, setHistoryRedoStack] = useState<HistoryActionKind[]>(
    [],
  );
  const usdKrwExchangeRate = useUsdKrwExchangeRate(locale === "ko");

  const showToast = (message: string, variant: ToastVariant = "success") => {
    setToast({ id: Date.now(), message, variant });
  };

  const requestConfirm = (dialog: ConfirmDialogState) => {
    setConfirmDialog(dialog);
  };

  const pushHistoryUndoAction = (kind: HistoryActionKind) => {
    setHistoryUndoStack((current) => [...current, kind].slice(-draftHistoryLimit));
    setHistoryRedoStack([]);
  };

  const clearDraftHistory = () => {
    setDraftUndoStack([]);
    setDraftRedoStack([]);
    setHistoryUndoStack((current) => current.filter((kind) => kind !== "draft"));
    setHistoryRedoStack((current) => current.filter((kind) => kind !== "draft"));
  };

  const selectCustomModelKind = (kind: TopicModelKind) => {
    setCustomModelKind((previousKind) => {
      setCustomModelPrice((currentPrice) => {
        const trimmedPrice = currentPrice.trim();
        const previousDefaultPrice = getDefaultCustomModelPrice(previousKind);

        return trimmedPrice === "" || trimmedPrice === previousDefaultPrice
          ? getDefaultCustomModelPrice(kind)
          : currentPrice;
      });

      return kind;
    });
  };

  const resetCustomModelForm = (kind = customModelKind) => {
    setEditingModelKey(null);
    setCustomModelProvider("xAI");
    setCustomModelProviderDraft("");
    setCustomModelProviderOpen(false);
    setCustomModelId("");
    setCustomModelMemo("");
    setCustomModelPrice(getDefaultCustomModelPrice(kind));
    setCustomModelTokenUnitInTenThousands("100");
  };

  const startModelEdit = (model: TopicModelConfig) => {
    const inputRate =
      model.pricingType === "input" ? getInputRateParts(model) : null;

    setEditingModelKey(`${model.kind}:${model.id}`);
    setCustomModelKind(model.kind);
    setCustomModelProvider(model.provider);
    setCustomModelProviderDraft("");
    setCustomModelProviderOpen(false);
    setCustomModelId(model.id);
    setCustomModelMemo(model.memo ?? "");
    setCustomModelPrice(
      model.pricingType === "image"
        ? String(model.costPerImageUsd ?? getDefaultCustomModelPrice("image"))
        : String(
            inputRate?.inputPriceUsd ?? getDefaultCustomModelPrice(model.kind),
          ),
    );
    setCustomModelTokenUnitInTenThousands(
      String(inputRate?.inputTokenUnitInTenThousands ?? 100),
    );
  };

  useEffect(() => {
    const parsedPrice = Number(customModelPrice);

    if (
      customModelPrice.trim() !== "" &&
      Number.isFinite(parsedPrice) &&
      parsedPrice > 0 &&
      parsedPrice < 0.001
    ) {
      setCustomModelPrice(getDefaultCustomModelPrice(customModelKind));
    }
  }, [customModelKind, customModelPrice]);

  useEffect(() => {
    if (!customModelProviderOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!customModelProviderPickerRef.current?.contains(event.target as Node)) {
        setCustomModelProviderOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);

    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [customModelProviderOpen]);

  const closeConfirm = () => {
    if (!confirmBusy) {
      setConfirmDialog(null);
    }
  };

  const confirmCurrentAction = async () => {
    if (!confirmDialog) {
      return;
    }

    try {
      setConfirmBusy(true);
      await confirmDialog.onConfirm();
      setConfirmDialog(null);
    } catch (confirmError) {
      showToast(
        confirmError instanceof Error ? confirmError.message : ui.actionFailed,
        "error",
      );
    } finally {
      setConfirmBusy(false);
    }
  };

  const loadData = async (seedInitialData = false) => {
    if (seedInitialData) {
      await seedIfEmpty();
    }
    const [projects, themes, topics, versions, images, drafts] = await Promise.all([
      getAll("projects"),
      getAll("themes"),
      getAll("topics"),
      getAll("versions"),
      getAll("images"),
      getAll("drafts"),
    ]);

    setStore({
      projects: sortProjectsByDisplayOrder(projects),
      themes: sortThemesByDisplayOrder(themes),
      topics: sortTopicsByDisplayOrder(topics),
      versions: versions.sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      images,
      drafts,
    });
  };

  useEffect(() => {
    let mounted = true;

    const boot = async () => {
      try {
        await loadData(true);
      } catch (loadError) {
        if (mounted) {
          showToast(
            loadError instanceof Error
              ? loadError.message
              : ui.indexedDbOpenFailed,
            "error",
          );
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    void boot();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(appearanceKey, appearanceTheme);
    } catch {
      // Ignore storage failures so theme switching still works for the session.
    }
    document.documentElement.dataset.theme = appearanceTheme;
    document.documentElement.style.colorScheme = appearanceTheme;
  }, [appearanceTheme]);

  useEffect(() => {
    try {
      localStorage.setItem(localeKey, locale);
    } catch {
      // Ignore storage failures so language switching still works for the session.
    }
    document.documentElement.lang = locale;
    document.documentElement.dataset.locale = locale;
    document.title = ui.appName;
  }, [locale]);

  useEffect(() => {
    try {
      localStorage.setItem(customModelsKey, JSON.stringify(customModels));
    } catch {
      // Ignore storage failures; in-memory custom models still work for the session.
    }
  }, [customModels]);

  const displayProjects = sortProjectsByDisplayOrder(store.projects);
  const selectedProject = displayProjects.find(
    (project) => project.id === selectedProjectId,
  );
  const projectThemes = sortThemesByDisplayOrder(
    store.themes.filter((theme) => theme.projectId === selectedProjectId),
  );
  const selectedTheme = projectThemes.find(
    (theme) => theme.id === selectedThemeId,
  );
  const themeTopics = sortTopicsByDisplayOrder(
    store.topics.filter(
      (topic) =>
        topic.projectId === selectedProjectId &&
        topic.themeId === selectedThemeId,
    ),
  );
  const selectedTopic = themeTopics.find(
    (topic) => topic.id === selectedTopicId,
  );
  const topicVersions = store.versions.filter(
    (version) => version.topicId === selectedTopicId,
  );
  const latestVersion = topicVersions[topicVersions.length - 1] ?? null;
  const selectedTopicKind = getTopicKind(selectedTopic, latestVersion);
  const selectedTopicDraft =
    store.drafts.find((draft) => draft.topicId === selectedTopicId) ?? null;

  function syncDraftSystemPrompts(systemPrompts: SystemPrompt[]) {
    const nextSystemPrompts =
      systemPrompts.length > 0 ? systemPrompts : [createDraftSystemPrompt()];

    setDraftSystemPrompts(nextSystemPrompts);
    setDraftBody(getSystemPromptText(nextSystemPrompts));
  }

  function createDefaultDraftState(updatedAt = nowIso()): PromptDraft | null {
    if (!selectedTopicId) {
      return null;
    }

    const systemPrompts = latestVersion
      ? copySystemPromptsToDraft(latestVersion)
      : [createDraftSystemPrompt()];

    return {
      topicId: selectedTopicId,
      kind: selectedTopicKind,
      label: latestVersion ? `v${topicVersions.length + 1}` : ui.draftLabel,
      body: getSystemPromptText(systemPrompts),
      systemPrompts,
      userPrompt: getVersionUserPrompt(latestVersion),
      resultTexts: [""],
      notes: "",
      images: [],
      updatedAt,
    };
  }

  function applyDraftState(draft: PromptDraft | null) {
    if (!draft) {
      return;
    }

    setDraftLabel(draft.label);
    setDraftKind(draft.kind ?? selectedTopicKind);
    syncDraftSystemPrompts(copySystemPromptsToDraft(draft));
    setDraftUserPrompt(draft.userPrompt ?? "");
    setDraftResultTexts(toEditableResultTexts(draft.resultTexts ?? []));
    setDraftNotes(draft.notes);
    setDraftImages(draft.images.map((image) => ({ ...image })));
  }

  function buildCurrentDraftState(updatedAt = nowIso()): PromptDraft | null {
    if (!selectedTopicId) {
      return null;
    }

    return {
      topicId: selectedTopicId,
      kind: draftKind,
      label: draftLabel,
      body: getSystemPromptText(draftSystemPrompts),
      systemPrompts: normalizeSystemPrompts(draftSystemPrompts),
      userPrompt: draftUserPrompt,
      resultTexts: draftResultTexts,
      notes: draftNotes,
      images: draftImages,
      updatedAt,
    };
  }

  const imagesByVersion = useMemo(() => {
    const groupedImages = store.images.reduce<Record<string, ImageAsset[]>>((acc, image) => {
      acc[image.versionId] = [...(acc[image.versionId] ?? []), image];
      return acc;
    }, {});

    Object.keys(groupedImages).forEach((versionId) => {
      groupedImages[versionId] = sortByDisplayOrder(
        groupedImages[versionId],
        compareCreatedAtAsc,
      );
    });

    return groupedImages;
  }, [store.images]);
  const normalizedDraftResultTexts = useMemo(
    () => normalizeResultTexts(draftResultTexts),
    [draftResultTexts],
  );
  const draftResultText = useMemo(
    () => joinResultTexts(normalizedDraftResultTexts),
    [normalizedDraftResultTexts],
  );
  const draftResultCount = normalizedDraftResultTexts.length + draftImages.length;
  const draftImageResultCount = useMemo(
    () => countImageResultMedia(draftImages),
    [draftImages],
  );

  const selectedTopicModelIds = useMemo(
    () =>
      resolveTopicModelIds(
        selectedTopicKind,
        selectedTopic?.modelIds,
        customModels,
      ),
    [customModels, selectedTopic?.modelIds, selectedTopicKind],
  );

  const metricsByVersion = useMemo(
    () =>
      buildVersionCostMetrics(
        topicVersions,
        imagesByVersion,
        selectedTopicKind,
        selectedTopicModelIds,
        customModels,
      ),
    [
      topicVersions,
      imagesByVersion,
      selectedTopicKind,
      selectedTopicModelIds,
      customModels,
    ],
  );

  const currentDraftCostMetrics = useMemo(
    () =>
      estimateDraftCostMetrics({
        body: draftBody,
        imageCount: selectedTopicKind === "image" ? draftImageResultCount : 0,
        imagesByVersion,
        kind: selectedTopicKind,
        modelConfigs: customModels,
        modelIds: selectedTopicModelIds,
        previousVersion: latestVersion,
        resultText: draftResultText,
        resultTexts: normalizedDraftResultTexts,
        resultCount: draftResultCount,
        userPrompt: draftUserPrompt,
      }),
    [
      draftBody,
      draftImageResultCount,
      draftImages.length,
      draftResultCount,
      draftResultText,
      normalizedDraftResultTexts,
      draftUserPrompt,
      imagesByVersion,
      latestVersion,
      customModels,
      selectedTopicKind,
      selectedTopicModelIds,
    ],
  );

  const themeCostSummary = useMemo<ThemeCostSummary | null>(() => {
    if (!selectedTheme) {
      return null;
    }

    const topics = store.topics
      .filter(
        (topic) =>
          topic.projectId === selectedProjectId &&
          topic.themeId === selectedTheme.id,
      )
      .map((topic) => {
        const versions = store.versions.filter(
          (version) => version.topicId === topic.id,
        );
        const latest = versions[versions.length - 1] ?? null;
        const kind = getTopicKind(topic, latest);
        const modelIds = resolveTopicModelIds(
          kind,
          topic.modelIds,
          customModels,
        );
        const topicMetricsByVersion = buildVersionCostMetrics(
          versions,
          imagesByVersion,
          kind,
          modelIds,
          customModels,
        );
        const summary = versions.reduce(
          (acc, version) => {
            const metrics = topicMetricsByVersion[version.id];
            if (!metrics) {
              return acc;
            }

            const billableRuns = Math.max(1, metrics.resultCount);

            return {
              inputTokens: acc.inputTokens + metrics.inputTokens * billableRuns,
              resultCount: acc.resultCount + metrics.resultCount,
              runCount: acc.runCount + 1,
              totalCostUsd:
                acc.totalCostUsd + metrics.totalCostUsd * billableRuns,
            };
          },
          {
            inputTokens: 0,
            resultCount: 0,
            runCount: 0,
            totalCostUsd: 0,
          },
        );

        return {
          ...summary,
          id: topic.id,
          title: topic.title,
        };
      })
      .sort(
        (a, b) =>
          b.totalCostUsd - a.totalCostUsd ||
          b.runCount - a.runCount ||
          a.title.localeCompare(b.title),
      );

    return {
      inputTokens: topics.reduce((total, topic) => total + topic.inputTokens, 0),
      resultCount: topics.reduce((total, topic) => total + topic.resultCount, 0),
      runCount: topics.reduce((total, topic) => total + topic.runCount, 0),
      themeName: selectedTheme.name,
      topics,
      totalCostUsd: topics.reduce(
        (total, topic) => total + topic.totalCostUsd,
        0,
      ),
    };
  }, [
    customModels,
    imagesByVersion,
    selectedProjectId,
    selectedTheme,
    store.topics,
    store.versions,
  ]);

  const themeCountByProject = useMemo(() => {
    return store.themes.reduce<Record<string, number>>((acc, theme) => {
      acc[theme.projectId] = (acc[theme.projectId] ?? 0) + 1;
      return acc;
    }, {});
  }, [store.themes]);

  const topicCountByTheme = useMemo(() => {
    return store.topics.reduce<Record<string, number>>((acc, topic) => {
      if (topic.themeId) {
        acc[topic.themeId] = (acc[topic.themeId] ?? 0) + 1;
      }
      return acc;
    }, {});
  }, [store.topics]);

  const getOpenTopicIdForTheme = (
    projectId: string,
    themeId: string,
    source: Pick<StoreState, "topics"> = store,
  ) => {
    const topics = sortTopicsByDisplayOrder(
      source.topics.filter(
        (topic) => topic.projectId === projectId && topic.themeId === themeId,
      ),
    );
    const savedTopicId = folderState.themeTopicIds[themeId];
    return (
      topics.find((topic) => topic.id === savedTopicId)?.id ??
      topics[0]?.id ??
      ""
    );
  };

  const getOpenPathForProject = (
    projectId: string,
    source: Pick<StoreState, "themes" | "topics"> = store,
  ): Pick<Selection, "themeId" | "topicId"> => {
    const themes = sortThemesByDisplayOrder(
      source.themes.filter((theme) => theme.projectId === projectId),
    );
    const savedThemeId = folderState.projectThemeIds[projectId];
    const theme =
      themes.find((item) => item.id === savedThemeId) ?? themes[0] ?? null;

    if (!theme) {
      return { themeId: "", topicId: "" };
    }

    return {
      themeId: theme.id,
      topicId: getOpenTopicIdForTheme(projectId, theme.id, source),
    };
  };

  const shouldIgnoreTreeSelectionClick = () =>
    treeDragActiveRef.current || Date.now() < suppressTreeSelectionUntilRef.current;

  const openProjectPath = (projectId: string) => {
    if (shouldIgnoreTreeSelectionClick()) {
      return;
    }

    const { themeId, topicId } = getOpenPathForProject(projectId);
    startTransition(() => {
      setSelectedProjectId(projectId);
      setSelectedThemeId(themeId);
      setSelectedTopicId(topicId);
      setCreatePanel(null);
    });
  };

  const openThemePath = (themeId: string) => {
    if (shouldIgnoreTreeSelectionClick()) {
      return;
    }

    const topicId = getOpenTopicIdForTheme(selectedProjectId, themeId);

    startTransition(() => {
      setSelectedThemeId(themeId);
      setSelectedTopicId(topicId);
      setCreatePanel(null);
    });
  };

  const openTopicPath = (topicId: string) => {
    if (shouldIgnoreTreeSelectionClick()) {
      return;
    }

    startTransition(() => {
      setSelectedTopicId(topicId);
      setCreatePanel(null);
    });
  };

  useEffect(() => {
    if (loading) {
      return;
    }

    if (!store.projects.length) {
      setSelectedProjectId("");
      setSelectedThemeId("");
      setSelectedTopicId("");
      return;
    }

    if (selectedProjectId && !selectedProject) {
      setSelectedProjectId("");
      setSelectedThemeId("");
      setSelectedTopicId("");
    }
  }, [loading, selectedProject, selectedProjectId, store.projects.length]);

  useEffect(() => {
    if (loading) {
      return;
    }

    if (!selectedProjectId) {
      setSelectedThemeId("");
      setSelectedTopicId("");
      return;
    }

    if (!selectedThemeId || !selectedTheme) {
      const { themeId, topicId } = getOpenPathForProject(selectedProjectId);
      if (selectedThemeId !== themeId) {
        setSelectedThemeId(themeId);
      }
      if (selectedTopicId !== topicId) {
        setSelectedTopicId(topicId);
      }
    }
  }, [
    folderState,
    loading,
    selectedProjectId,
    selectedTheme,
    selectedThemeId,
    selectedTopicId,
    store.themes,
    store.topics,
  ]);

  useEffect(() => {
    if (loading) {
      return;
    }

    if (!selectedThemeId) {
      setSelectedTopicId("");
      return;
    }

    if (!selectedTopicId || !selectedTopic) {
      const topicId = getOpenTopicIdForTheme(
        selectedProjectId,
        selectedThemeId,
      );
      if (selectedTopicId !== topicId) {
        setSelectedTopicId(topicId);
      }
    }
  }, [
    folderState,
    loading,
    selectedProjectId,
    selectedThemeId,
    selectedTopic,
    selectedTopicId,
    store.topics,
  ]);

  useEffect(() => {
    localStorage.setItem(
      selectionKey,
      JSON.stringify({
        projectId: selectedProjectId,
        themeId: selectedThemeId,
        topicId: selectedTopicId,
      }),
    );
  }, [selectedProjectId, selectedThemeId, selectedTopicId]);

  useEffect(() => {
    try {
      localStorage.setItem(folderStateKey, JSON.stringify(folderState));
    } catch {
      // Ignore storage failures so folder state still works for the session.
    }
  }, [folderState]);

  useEffect(() => {
    if (loading || !selectedProjectId) {
      return;
    }

    setFolderState((current) => {
      const projectThemeIds = { ...current.projectThemeIds };
      const themeTopicIds = { ...current.themeTopicIds };

      if (selectedThemeId) {
        projectThemeIds[selectedProjectId] = selectedThemeId;
      }

      if (selectedThemeId && selectedTopicId) {
        themeTopicIds[selectedThemeId] = selectedTopicId;
      }

      const projectThemeUnchanged =
        current.projectThemeIds[selectedProjectId] ===
        projectThemeIds[selectedProjectId];
      const themeTopicUnchanged =
        !selectedThemeId ||
        current.themeTopicIds[selectedThemeId] ===
          themeTopicIds[selectedThemeId];

      if (projectThemeUnchanged && themeTopicUnchanged) {
        return current;
      }

      return { projectThemeIds, themeTopicIds };
    });
  }, [loading, selectedProjectId, selectedThemeId, selectedTopicId]);

  useEffect(() => {
    if (loading) {
      return;
    }

    if (!selectedTopicId) {
      setDraftKind("text");
      setDraftLabel("");
      setDraftBody("");
      setDraftSystemPrompts([createDraftSystemPrompt()]);
      setDraftUserPrompt("");
      setDraftResultTexts([""]);
      setDraftNotes("");
      setDraftImages([]);
      setEditingVersionId(null);
      setActiveVersionId("draft");
      setMainView("write");
      clearDraftHistory();
      return;
    }

    applyDraftState(selectedTopicDraft ?? createDefaultDraftState());
    setEditingVersionId(null);
    setActiveVersionId("draft");
    setMainView("write");
    clearDraftHistory();
  }, [loading, selectedTopicId]);

  const selectedStoredVersion =
    activeVersionId === "draft"
      ? null
      : (topicVersions.find((version) => version.id === activeVersionId) ??
        null);
  const editingVersion = editingVersionId
    ? (topicVersions.find((version) => version.id === editingVersionId) ?? null)
    : null;
  const isVersionView = Boolean(selectedStoredVersion && !editingVersion);
  const selectedStoredVersionImages = selectedStoredVersion
    ? (imagesByVersion[selectedStoredVersion.id] ?? [])
    : [];
  const editorTopicKind = editingVersion
    ? getVersionKind(editingVersion)
    : selectedStoredVersion
      ? getVersionKind(selectedStoredVersion)
    : selectedTopicKind;
  const editorModelIds =
    editingVersion?.modelIds ??
    selectedStoredVersion?.modelIds ??
    selectedTopicModelIds;
  const writePanelSystemPrompts = isVersionView
    ? getVersionSystemPrompts(selectedStoredVersion)
    : draftSystemPrompts;
  const writePanelResultTexts = isVersionView
    ? getEditableVersionResultTexts(selectedStoredVersion)
    : draftResultTexts;
  const writePanelUserPrompt = isVersionView
    ? getVersionUserPrompt(selectedStoredVersion)
    : draftUserPrompt;
  const writePanelNotes = isVersionView
    ? (selectedStoredVersion?.notes ?? "")
    : draftNotes;
  const writePanelLabel = isVersionView
    ? (selectedStoredVersion?.label ?? "")
    : draftLabel;
  const writePanelImages = isVersionView ? selectedStoredVersionImages : draftImages;
  const selectedStoredVersionMetrics = selectedStoredVersion
    ? (metricsByVersion[selectedStoredVersion.id] ?? null)
    : null;
  const activeCostMetrics =
    isVersionView && selectedStoredVersionMetrics
      ? selectedStoredVersionMetrics
      : currentDraftCostMetrics;
  const activeCostLabel =
    isVersionView && selectedStoredVersion
      ? ui.selectedVersionEstimate(selectedStoredVersion.label)
      : ui.currentDraftEstimate;
  const editingVersionStoredImages = editingVersion
    ? (imagesByVersion[editingVersion.id] ?? [])
    : [];
  const selectedStoredIndex = selectedStoredVersion
    ? topicVersions.findIndex(
        (version) => version.id === selectedStoredVersion.id,
      )
    : -1;
  const previousStoredVersion =
    selectedStoredVersion && selectedStoredIndex > 0
      ? topicVersions[selectedStoredIndex - 1]
      : null;
  const nextStoredVersion =
    selectedStoredVersion &&
    selectedStoredIndex >= 0 &&
    selectedStoredIndex < topicVersions.length - 1
      ? topicVersions[selectedStoredIndex + 1]
      : null;
  const canCompareStoredPrevious = Boolean(previousStoredVersion);
  const canCompareStoredNext = Boolean(nextStoredVersion);
  const previousNavigableVersion = selectedStoredVersion
    ? previousStoredVersion
    : latestVersion;
  const previousNavigableVersionId = previousNavigableVersion?.id ?? null;
  const nextNavigableVersionId = selectedStoredVersion
    ? (nextStoredVersion?.id ?? "draft")
    : null;
  const navigateDiffVersion = (versionId: string | null) => {
    if (!versionId) {
      return;
    }

    setEditingVersionId(null);
    setActiveVersionId(versionId);
    setCompareDirection("previous");
    setMainView("diff");
  };
  const effectiveCompareDirection: CompareDirection =
    selectedStoredVersion && compareDirection === "next"
      ? canCompareStoredNext
        ? "next"
        : "previous"
      : selectedStoredVersion && !canCompareStoredPrevious && canCompareStoredNext
        ? "next"
        : "previous";
  const compareBase = selectedStoredVersion
    ? effectiveCompareDirection === "next"
      ? selectedStoredVersion
      : previousStoredVersion
    : activeVersionId === "draft"
      ? latestVersion
      : null;
  const compareTargetVersion = selectedStoredVersion
    ? effectiveCompareDirection === "next"
      ? nextStoredVersion
      : selectedStoredVersion
    : null;
  const compareTargetKind = compareTargetVersion
    ? getVersionKind(compareTargetVersion)
    : selectedTopicKind;
  const compareBaseSystemPrompts = compareBase
    ? getVersionSystemPrompts(compareBase)
    : [];
  const compareBaseUserPrompt = compareBase
    ? getVersionUserPrompt(compareBase)
    : "";
  const compareTargetSystemPrompts = compareTargetVersion
    ? getVersionSystemPrompts(compareTargetVersion)
    : draftSystemPrompts;
  const compareTargetUserPrompt = compareTargetVersion
    ? getVersionUserPrompt(compareTargetVersion)
    : draftUserPrompt;
  const compareBaseResultTexts =
    compareTargetKind === "text" ? getVersionResultTexts(compareBase) : [];
  const compareTargetResultTexts =
    compareTargetKind === "text"
      ? compareTargetVersion
        ? getVersionResultTexts(compareTargetVersion)
        : normalizedDraftResultTexts
      : [];
  const compareTargetLabel = compareTargetVersion?.label ?? ui.draftMessage;
  const compareBaseImages = compareBase
    ? (imagesByVersion[compareBase.id] ?? [])
    : [];
  const compareTargetImages = compareTargetVersion
    ? (imagesByVersion[compareTargetVersion.id] ?? [])
    : draftImages;
  const baseResultDiffCount =
    compareTargetKind === "text"
      ? compareBaseResultTexts.length
      : compareBaseImages.length;
  const targetResultDiffCount =
    compareTargetKind === "text"
      ? compareTargetResultTexts.length
      : compareTargetImages.length;
  const effectiveBaseResultDiffIndex = Math.min(
    baseResultDiffIndex,
    Math.max(0, baseResultDiffCount - 1),
  );
  const effectiveTargetResultDiffIndex = Math.min(
    targetResultDiffIndex,
    Math.max(0, targetResultDiffCount - 1),
  );
  const compareBaseResultText =
    compareBaseResultTexts[effectiveBaseResultDiffIndex] ?? "";
  const compareTargetResultText =
    compareTargetResultTexts[effectiveTargetResultDiffIndex] ?? "";
  const latestImages = latestVersion
    ? (imagesByVersion[latestVersion.id] ?? [])
    : [];
  const comparableLatestImages = latestImages;
  const comparableDraftImages = draftImages;
  const systemPromptDiffBlocks = useMemo(
    () =>
      buildSystemPromptDiffBlocks(
        compareBaseSystemPrompts,
        compareTargetSystemPrompts,
      ),
    [compareBaseSystemPrompts, compareTargetSystemPrompts],
  );
  const userPromptDiffRows = useMemo(
    () => diffLines(compareBaseUserPrompt, compareTargetUserPrompt),
    [compareBaseUserPrompt, compareTargetUserPrompt],
  );
  const resultTextDiffRows = useMemo(
    () => diffLines(compareBaseResultText, compareTargetResultText),
    [compareBaseResultText, compareTargetResultText],
  );
  useEffect(() => {
    setBaseResultDiffIndex((current) =>
      Math.min(current, Math.max(0, baseResultDiffCount - 1)),
    );
  }, [baseResultDiffCount]);
  useEffect(() => {
    setTargetResultDiffIndex((current) =>
      Math.min(current, Math.max(0, targetResultDiffCount - 1)),
    );
  }, [targetResultDiffCount]);
  useEffect(() => {
    setBaseResultDiffIndex(0);
    setTargetResultDiffIndex(0);
  }, [activeVersionId, compareDirection, compareTargetKind]);
  const systemPromptDiffRows = systemPromptDiffBlocks.flatMap(
    (block) => block.rows,
  );
  const promptDiffRows = [...systemPromptDiffRows, ...userPromptDiffRows];
  const addedCount = promptDiffRows.filter(
    (row) => row.type === "added" || row.type === "changed",
  ).length;
  const removedCount = promptDiffRows.filter(
    (row) => row.type === "removed" || row.type === "changed",
  ).length;
  const latestComparableResultText =
    selectedTopicKind === "text" ? getVersionResultText(latestVersion) : "";
  const draftComparableResultText =
    selectedTopicKind === "text" ? draftResultText : "";
  const hasDraftModelChanges =
    currentDraftCostMetrics.modelAddedIds.length > 0 ||
    currentDraftCostMetrics.modelRemovedIds.length > 0;
  const rawDraftChanges =
    !systemPromptListsMatch(
      getVersionSystemPrompts(latestVersion),
      draftSystemPrompts,
    ) ||
    getVersionUserPrompt(latestVersion) !== draftUserPrompt ||
    (latestVersion?.notes ?? "") !== draftNotes.trim() ||
    latestComparableResultText !== draftComparableResultText ||
    !draftImagesMatchStoredImages(
      comparableDraftImages,
      comparableLatestImages,
    ) ||
    hasDraftModelChanges;
  const hasVersionEditChanges = editingVersion
    ? (draftLabel.trim() || editingVersion.label) !== editingVersion.label ||
      draftNotes.trim() !== editingVersion.notes ||
      (editorTopicKind === "text" &&
        draftResultText.trim() !== getVersionResultText(editingVersion)) ||
      !draftImagesMatchStoredImages(draftImages, editingVersionStoredImages)
    : false;
  const hasDraftGraphChanges = !editingVersion && rawDraftChanges;
  const hasDraftChanges = !editingVersion && !isVersionView && rawDraftChanges;
  const hasDraftPromptInput =
    getCombinedPromptText({
      systemPrompts: draftSystemPrompts,
      userPrompt: draftUserPrompt,
    }).trim().length > 0;
  const canSaveDraft =
    !editingVersion &&
    hasDraftChanges &&
    hasDraftPromptInput &&
    draftResultCount > 0;
  const canSaveVersionEdit =
    Boolean(editingVersion) &&
    hasVersionEditChanges &&
    getCombinedPromptText({
      systemPrompts: draftSystemPrompts,
      userPrompt: draftUserPrompt,
    }).trim().length > 0 &&
    draftResultCount > 0;
  const canSaveCurrentVersion = editingVersion
    ? canSaveVersionEdit
    : canSaveDraft;

  const createDraftHistorySnapshot = (): DraftHistorySnapshot => ({
    images: cloneDraftImages(draftImages),
    kind: draftKind,
    label: draftLabel,
    notes: draftNotes,
    resultTexts: [...draftResultTexts],
    systemPrompts: cloneSystemPrompts(draftSystemPrompts),
    userPrompt: draftUserPrompt,
  });

  const createScopedOrderSnapshot = <T extends OrderedEntity>(
    items: T[],
    getScopeKey: (item: T) => string,
    sortItems: (scopedItems: T[]) => T[],
  ): OrderHistorySnapshotItem[] => {
    const groups = new Map<string, T[]>();

    items.forEach((item) => {
      const scopeKey = getScopeKey(item);
      groups.set(scopeKey, [...(groups.get(scopeKey) ?? []), item]);
    });

    return Array.from(groups.values()).flatMap((group) =>
      sortItems(group).map((item, index) => ({ id: item.id, order: index })),
    );
  };

  const createTreeOrderHistorySnapshot = (): TreeOrderHistorySnapshot => ({
    projects: sortProjectsByDisplayOrder(store.projects).map((project, index) => ({
      id: project.id,
      order: index,
    })),
    themes: createScopedOrderSnapshot(
      store.themes,
      (theme) => theme.projectId,
      sortThemesByDisplayOrder,
    ),
    topics: createScopedOrderSnapshot(
      store.topics,
      (topic) => `${topic.projectId}:${topic.themeId ?? ""}`,
      sortTopicsByDisplayOrder,
    ),
  });

  const applyOrderSnapshotItems = <T extends OrderedEntity>(
    items: T[],
    snapshotItems: OrderHistorySnapshotItem[],
    sortItems: (nextItems: T[]) => T[],
  ) => {
    const orderById = new Map(
      snapshotItems.map((item) => [item.id, item.order]),
    );

    return sortItems(
      items.map((item, index) => ({
        ...item,
        order: orderById.get(item.id) ?? getOrderedValue(item, index),
      })),
    );
  };

  const restoreTreeOrderHistorySnapshot = async (
    snapshot: TreeOrderHistorySnapshot,
  ) => {
    const nextProjects = applyOrderSnapshotItems(
      store.projects,
      snapshot.projects,
      sortProjectsByDisplayOrder,
    );
    const nextThemes = applyOrderSnapshotItems(
      store.themes,
      snapshot.themes,
      sortThemesByDisplayOrder,
    );
    const nextTopics = applyOrderSnapshotItems(
      store.topics,
      snapshot.topics,
      sortTopicsByDisplayOrder,
    );

    setStore((current) => ({
      ...current,
      projects: nextProjects,
      themes: nextThemes,
      topics: nextTopics,
    }));

    await Promise.all([
      ...nextProjects.map((project) => putItem("projects", project)),
      ...nextThemes.map((theme) => putItem("themes", theme)),
      ...nextTopics.map((topic) => putItem("topics", topic)),
    ]);
  };

  const restoreDraftHistorySnapshot = (snapshot: DraftHistorySnapshot) => {
    setDraftKind(snapshot.kind);
    setDraftLabel(snapshot.label);
    syncDraftSystemPrompts(cloneSystemPrompts(snapshot.systemPrompts));
    setDraftUserPrompt(snapshot.userPrompt);
    setDraftResultTexts([...snapshot.resultTexts]);
    setDraftNotes(snapshot.notes);
    setDraftImages(cloneDraftImages(snapshot.images));
    setActiveVersionId(editingVersionId ?? "draft");
  };

  const recordDraftHistorySnapshot = (force = false) => {
    if (
      !force &&
      (loading ||
        !selectedTopicId ||
        editingVersionId ||
        isVersionView)
    ) {
      return;
    }

    const snapshot = createDraftHistorySnapshot();
    const lastSnapshot = draftUndoStack[draftUndoStack.length - 1];

    if (lastSnapshot && draftHistorySnapshotsEqual(lastSnapshot, snapshot)) {
      return;
    }

    setDraftUndoStack([...draftUndoStack, snapshot].slice(-draftHistoryLimit));
    setDraftRedoStack([]);
    pushHistoryUndoAction("draft");
  };

  const recordTreeOrderHistorySnapshot = (
    snapshot = createTreeOrderHistorySnapshot(),
  ) => {
    const lastSnapshot = treeOrderUndoStack[treeOrderUndoStack.length - 1];

    if (
      lastSnapshot &&
      treeOrderHistorySnapshotsEqual(lastSnapshot, snapshot)
    ) {
      return;
    }

    setTreeOrderUndoStack(
      [...treeOrderUndoStack, snapshot].slice(-draftHistoryLimit),
    );
    setTreeOrderRedoStack([]);
    pushHistoryUndoAction("tree-order");
  };

  const undoDraftHistory = () => {
    if (draftUndoStack.length === 0) {
      return;
    }

    const previousSnapshot = draftUndoStack[draftUndoStack.length - 1];
    const currentSnapshot = createDraftHistorySnapshot();

    setDraftUndoStack(draftUndoStack.slice(0, -1));
    setDraftRedoStack((current) =>
      [currentSnapshot, ...current].slice(0, draftHistoryLimit),
    );
    setHistoryUndoStack((current) => current.slice(0, -1));
    setHistoryRedoStack((current) =>
      [("draft" as HistoryActionKind), ...current].slice(
        0,
        draftHistoryLimit,
      ),
    );
    restoreDraftHistorySnapshot(previousSnapshot);
  };

  const redoDraftHistory = () => {
    if (draftRedoStack.length === 0) {
      return;
    }

    const nextSnapshot = draftRedoStack[0];
    const currentSnapshot = createDraftHistorySnapshot();

    setDraftRedoStack(draftRedoStack.slice(1));
    setDraftUndoStack((current) =>
      [...current, currentSnapshot].slice(-draftHistoryLimit),
    );
    setHistoryRedoStack((current) => current.slice(1));
    setHistoryUndoStack((current) =>
      [...current, ("draft" as HistoryActionKind)].slice(
        -draftHistoryLimit,
      ),
    );
    restoreDraftHistorySnapshot(nextSnapshot);
  };

  const undoTreeOrderHistory = async () => {
    if (treeOrderUndoStack.length === 0) {
      return;
    }

    const previousSnapshot = treeOrderUndoStack[treeOrderUndoStack.length - 1];
    const currentSnapshot = createTreeOrderHistorySnapshot();

    setTreeOrderUndoStack(treeOrderUndoStack.slice(0, -1));
    setTreeOrderRedoStack((current) =>
      [currentSnapshot, ...current].slice(0, draftHistoryLimit),
    );
    setHistoryUndoStack((current) => current.slice(0, -1));
    setHistoryRedoStack((current) =>
      [("tree-order" as HistoryActionKind), ...current].slice(
        0,
        draftHistoryLimit,
      ),
    );
    await restoreTreeOrderHistorySnapshot(previousSnapshot);
  };

  const redoTreeOrderHistory = async () => {
    if (treeOrderRedoStack.length === 0) {
      return;
    }

    const nextSnapshot = treeOrderRedoStack[0];
    const currentSnapshot = createTreeOrderHistorySnapshot();

    setTreeOrderRedoStack(treeOrderRedoStack.slice(1));
    setTreeOrderUndoStack((current) =>
      [...current, currentSnapshot].slice(-draftHistoryLimit),
    );
    setHistoryRedoStack((current) => current.slice(1));
    setHistoryUndoStack((current) =>
      [...current, ("tree-order" as HistoryActionKind)].slice(
        -draftHistoryLimit,
      ),
    );
    await restoreTreeOrderHistorySnapshot(nextSnapshot);
  };

  useEffect(() => {
    const handleDraftHistoryKeydown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const modifierPressed = event.ctrlKey || event.metaKey;
      const isUndoShortcut =
        modifierPressed && key === "z" && !event.altKey && !event.shiftKey;
      const isRedoShortcut =
        modifierPressed &&
        !event.altKey &&
        ((key === "z" && event.shiftKey) || key === "y");

      if (
        confirmDialog ||
        editingVersionId ||
        isVersionView ||
        (!isUndoShortcut && !isRedoShortcut)
      ) {
        return;
      }

      const canUndoDraft =
        mainView === "write" && Boolean(selectedTopicId) && draftUndoStack.length > 0;
      const canRedoDraft =
        mainView === "write" && Boolean(selectedTopicId) && draftRedoStack.length > 0;
      const nextUndoKind = historyUndoStack[historyUndoStack.length - 1];
      const nextRedoKind = historyRedoStack[0];

      if (isUndoShortcut) {
        const undoKind =
          nextUndoKind === "tree-order" && treeOrderUndoStack.length > 0
            ? "tree-order"
            : nextUndoKind === "draft" && canUndoDraft
              ? "draft"
              : canUndoDraft
                ? "draft"
                : treeOrderUndoStack.length > 0
                  ? "tree-order"
                  : null;

        if (!undoKind) {
          return;
        }

        event.preventDefault();

        if (undoKind === "draft") {
          undoDraftHistory();
        } else {
          void undoTreeOrderHistory();
        }
      }

      if (isRedoShortcut) {
        const redoKind =
          nextRedoKind === "tree-order" && treeOrderRedoStack.length > 0
            ? "tree-order"
            : nextRedoKind === "draft" && canRedoDraft
              ? "draft"
              : canRedoDraft
                ? "draft"
                : treeOrderRedoStack.length > 0
                  ? "tree-order"
                  : null;

        if (!redoKind) {
          return;
        }

        event.preventDefault();

        if (redoKind === "draft") {
          redoDraftHistory();
        } else {
          void redoTreeOrderHistory();
        }
      }
    };

    document.addEventListener("keydown", handleDraftHistoryKeydown);
    return () => {
      document.removeEventListener("keydown", handleDraftHistoryKeydown);
    };
  });

  useEffect(() => {
    if (
      loading ||
      !selectedTopicId ||
      editingVersionId ||
      activeVersionId !== "draft"
    ) {
      return;
    }

    const draft = buildCurrentDraftState();
    if (!draft) {
      return;
    }

    void putItem("drafts", draft)
      .then(() => {
        setStore((current) => ({
          ...current,
          drafts: upsertDraft(current.drafts, draft),
        }));
      })
      .catch(() => {
        // Draft autosave should not interrupt editing.
      });
  }, [
    activeVersionId,
    draftBody,
    draftImages,
    draftKind,
    draftLabel,
    draftNotes,
    draftResultTexts,
    draftSystemPrompts,
    draftUserPrompt,
    editingVersionId,
    loading,
    selectedTopicId,
  ]);

  const markEditorChanged = () => {
    setActiveVersionId(editingVersionId ?? "draft");
  };

  const openCurrentDraft = () => {
    setEditingVersionId(null);
    setActiveVersionId("draft");
    setCompareDirection("previous");
    setMainView("write");
  };

  const refresh = async () => {
    try {
      await loadData();
    } catch (refreshError) {
      showToast(
        refreshError instanceof Error ? refreshError.message : ui.refreshFailed,
        "error",
      );
    }
  };

  const persistReorderedProjects = async (projects: Project[]) => {
    const orderedProjects = applySequentialOrder(projects);

    setStore((current) => ({
      ...current,
      projects: sortProjectsByDisplayOrder(
        current.projects.map(
          (project) =>
            orderedProjects.find((item) => item.id === project.id) ?? project,
        ),
      ),
    }));

    await Promise.all(
      orderedProjects.map((project) => putItem("projects", project)),
    );
  };

  const persistReorderedThemes = async (themes: Theme[]) => {
    const orderedThemes = applySequentialOrder(themes);

    setStore((current) => ({
      ...current,
      themes: sortThemesByDisplayOrder(
        current.themes.map(
          (theme) => orderedThemes.find((item) => item.id === theme.id) ?? theme,
        ),
      ),
    }));

    await Promise.all(orderedThemes.map((theme) => putItem("themes", theme)));
  };

  const persistReorderedTopics = async (topics: Topic[]) => {
    const orderedTopics = applySequentialOrder(topics);

    setStore((current) => ({
      ...current,
      topics: sortTopicsByDisplayOrder(
        current.topics.map(
          (topic) => orderedTopics.find((item) => item.id === topic.id) ?? topic,
        ),
      ),
    }));

    await Promise.all(orderedTopics.map((topic) => putItem("topics", topic)));
  };

  const finishTreeDragInteraction = () => {
    treeDragActiveRef.current = false;
    suppressTreeSelectionUntilRef.current = Date.now() + 350;
  };

  const cancelTreeDragOverlayFrame = () => {
    if (treeDragOverlayFrameRef.current !== null) {
      window.cancelAnimationFrame(treeDragOverlayFrameRef.current);
      treeDragOverlayFrameRef.current = null;
    }

    treeDragOverlayPointRef.current = null;
  };

  const cancelTreeDragSourceHideFrame = () => {
    if (treeDragSourceHideFrameRef.current !== null) {
      window.cancelAnimationFrame(treeDragSourceHideFrameRef.current);
      treeDragSourceHideFrameRef.current = null;
    }
  };

  const scheduleTreeDragSourceHide = () => {
    cancelTreeDragSourceHideFrame();
    treeDragSourceHideFrameRef.current = window.requestAnimationFrame(() => {
      treeDragSourceHideFrameRef.current = null;
      setTreeDragSourceHidden(true);
    });
  };

  const scheduleTreeDragOverlayPosition = (
    kind: RenameTarget["kind"],
    id: string,
    event: DragEvent<HTMLElement>,
  ) => {
    if (event.clientX === 0 && event.clientY === 0) {
      return;
    }

    treeDragOverlayPointRef.current = { x: event.clientX, y: event.clientY };

    if (treeDragOverlayFrameRef.current !== null) {
      return;
    }

    treeDragOverlayFrameRef.current = window.requestAnimationFrame(() => {
      treeDragOverlayFrameRef.current = null;
      const point = treeDragOverlayPointRef.current;

      if (!point) {
        return;
      }

      setTreeDragOverlay((current) => {
        if (!current || current.kind !== kind || current.id !== id) {
          return current;
        }

        if (
          Math.abs(current.x - point.x) < 1 &&
          Math.abs(current.y - point.y) < 1
        ) {
          return current;
        }

        return { ...current, x: point.x, y: point.y };
      });
    });
  };

  const getTreeDropAnchorY = (event: DragEvent<HTMLElement>) => {
    if (
      treeDragOverlay &&
      draggedTreeTarget &&
      treeDragOverlay.kind === draggedTreeTarget.kind &&
      treeDragOverlay.id === draggedTreeTarget.id
    ) {
      return event.clientY - treeDragOverlay.offsetY + treeDragOverlay.height / 2;
    }

    return event.clientY;
  };

  const getTreeInsertAfterTarget = (event: DragEvent<HTMLElement>) =>
    isDropAfterTarget(event, getTreeDropAnchorY(event));

  const handleTreeDragStart = (
    kind: RenameTarget["kind"],
    id: string,
    event: DragEvent<HTMLElement>,
  ) => {
    treeDragActiveRef.current = true;
    suppressTreeSelectionUntilRef.current = Number.POSITIVE_INFINITY;
    cancelTreeDragOverlayFrame();
    cancelTreeDragSourceHideFrame();
    setTreeDragSourceHidden(false);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", id);
    const row = event.currentTarget.closest<HTMLElement>(`.${kind}-row`);
    const rect = row?.getBoundingClientRect();

    setTreeDragOverlay({
      kind,
      id,
      height: rect?.height ?? 32,
      offsetX: rect
        ? Math.max(0, Math.min(rect.width, event.clientX - rect.left))
        : 0,
      offsetY: rect
        ? Math.max(0, Math.min(rect.height, event.clientY - rect.top))
        : 0,
      width: rect?.width ?? 220,
      x: event.clientX,
      y: event.clientY,
    });
    setTreeDropPreview({ kind, id, position: "after" });
    setDraggedTreeTarget({ kind, id });
    scheduleTreeDragSourceHide();
  };

  const handleTreeDrag = (
    kind: RenameTarget["kind"],
    id: string,
    event: DragEvent<HTMLElement>,
  ) => {
    scheduleTreeDragOverlayPosition(kind, id, event);
  };

  const updateTreeDragOverlayPosition = (event: DragEvent<HTMLElement>) => {
    if (!treeDragOverlay) {
      return;
    }

    scheduleTreeDragOverlayPosition(
      treeDragOverlay.kind,
      treeDragOverlay.id,
      event,
    );
  };

  const handleTreeDragOver = (
    kind: RenameTarget["kind"],
    id: string,
    event: DragEvent<HTMLElement>,
    positionOverride?: DropPreviewPosition,
  ) => {
    if (!draggedTreeTarget || draggedTreeTarget.kind !== kind) {
      setTreeDropPreview(null);
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";

    if (draggedTreeTarget.id === id) {
      setTreeDropPreview((current) =>
        current?.kind === kind && current.id === id
          ? current
          : {
              kind,
              id,
              position: "after",
            },
      );
      return;
    }

    const position =
      positionOverride ?? (getTreeInsertAfterTarget(event) ? "after" : "before");
    setTreeDropPreview((current) =>
      current?.kind === kind &&
      current.id === id &&
      current.position === position
        ? current
        : { kind, id, position },
    );
  };

  const isTreeRowDragEvent = (
    kind: RenameTarget["kind"],
    event: DragEvent<HTMLDivElement>,
  ) => {
    const target = event.target;

    if (!(target instanceof Element)) {
      return false;
    }

    const row = target.closest(`.${kind}-row`);
    return Boolean(row && event.currentTarget.contains(row));
  };

  const handleTreeListDragOver = (
    kind: RenameTarget["kind"],
    lastId: string | undefined,
    event: DragEvent<HTMLDivElement>,
  ) => {
    if (
      !lastId ||
      !draggedTreeTarget ||
      draggedTreeTarget.kind !== kind ||
      isTreeRowDragEvent(kind, event)
    ) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setTreeDropPreview((current) =>
      current?.kind === kind &&
      current.id === lastId &&
      current.position === "after"
        ? current
        : { kind, id: lastId, position: "after" },
    );
  };

  const handleTreeListDrop = async (
    kind: RenameTarget["kind"],
    lastId: string | undefined,
    event: DragEvent<HTMLDivElement>,
  ) => {
    if (!lastId || isTreeRowDragEvent(kind, event)) {
      return;
    }

    await handleTreeDrop(kind, lastId, event, true);
  };

  const handleTreeDrop = async (
    kind: RenameTarget["kind"],
    id: string,
    event: DragEvent<HTMLElement>,
    insertAfterOverride?: boolean,
  ) => {
    const draggedTarget = draggedTreeTarget;

    if (
      !draggedTarget ||
      draggedTarget.kind !== kind ||
      draggedTarget.id === id
    ) {
      flushSync(() => {
        cancelTreeDragOverlayFrame();
        cancelTreeDragSourceHideFrame();
        finishTreeDragInteraction();
        setTreeDragSourceHidden(false);
        setDraggedTreeTarget(null);
        setTreeDropPreview(null);
        setTreeDragOverlay(null);
      });
      return;
    }

    event.preventDefault();
    const insertAfter = insertAfterOverride ?? getTreeInsertAfterTarget(event);
    const previousOrderSnapshot = createTreeOrderHistorySnapshot();

    try {
      let reorderPromise: Promise<void> = Promise.resolve();

      flushSync(() => {
        cancelTreeDragOverlayFrame();
        cancelTreeDragSourceHideFrame();

        if (kind === "project") {
          reorderPromise = persistReorderedProjects(
            moveItemById(
              sortProjectsByDisplayOrder(store.projects),
              draggedTarget.id,
              id,
              insertAfter,
            ),
          );
        } else if (kind === "theme") {
          reorderPromise = persistReorderedThemes(
            moveItemById(projectThemes, draggedTarget.id, id, insertAfter),
          );
        } else {
          reorderPromise = persistReorderedTopics(
            moveItemById(themeTopics, draggedTarget.id, id, insertAfter),
          );
        }

        finishTreeDragInteraction();
        setTreeDragSourceHidden(false);
        setDraggedTreeTarget(null);
        setTreeDropPreview(null);
        setTreeDragOverlay(null);
      });

      await reorderPromise;
      recordTreeOrderHistorySnapshot(previousOrderSnapshot);
    } catch (reorderError) {
      showToast(
        reorderError instanceof Error ? reorderError.message : ui.actionFailed,
        "error",
      );
      await refresh();
    } finally {
      setDraggedTreeTarget(null);
      setTreeDropPreview(null);
      setTreeDragOverlay(null);
    }
  };

  const handleTreeDragEnd = () => {
    cancelTreeDragOverlayFrame();
    cancelTreeDragSourceHideFrame();
    finishTreeDragInteraction();
    setTreeDragSourceHidden(false);
    setDraggedTreeTarget(null);
    setTreeDropPreview(null);
    setTreeDragOverlay(null);
  };

  const handleProjectCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = newProjectName.trim();
    if (!name) {
      return;
    }

    const createdAt = nowIso();
    const id = createId();
    await putItem("projects", {
      id,
      order: getNextOrder(displayProjects),
      name,
      description: "",
      createdAt,
      updatedAt: createdAt,
    });
    setNewProjectName("");
    setSelectedProjectId(id);
    setSelectedThemeId("");
    setSelectedTopicId("");
    setCreatePanel(null);
    showToast(ui.projectSaved);
    await refresh();
  };

  const handleProjectExport = async () => {
    if (!selectedProject) {
      showToast(ui.selectProject, "error");
      return;
    }

    try {
      const { blob, fileName } = await createProjectArchiveZip(
        selectedProject.id,
        { ...store, customModels },
      );
      downloadBlob(blob, fileName);
      showToast(ui.projectExported);
    } catch (archiveError) {
      showToast(
        archiveError instanceof Error ? archiveError.message : ui.actionFailed,
        "error",
      );
    }
  };

  const handleProjectImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const imported = await importProjectArchiveZip(file);
      const { themeId, topicId } = getOpenPathForProject(imported.project.id, {
        themes: imported.themes,
        topics: imported.topics,
      });
      setSelectedProjectId(imported.project.id);
      setSelectedThemeId(themeId);
      setSelectedTopicId(topicId);
      if (imported.customModels.length > 0) {
        const incomingModels = normalizeCustomModels(
          imported.customModels.filter(isTopicModelConfig),
        );

        setCustomModels((current) =>
          normalizeCustomModels([
            ...current.filter(
              (currentModel) =>
                !incomingModels.some(
                  (incomingModel) =>
                    incomingModel.kind === currentModel.kind &&
                    incomingModel.id === currentModel.id,
                ),
            ),
            ...incomingModels,
          ]),
        );
      }
      setCreatePanel(null);
      setSidebarView("explorer");
      showToast(ui.projectImported(imported.project.name));
      await refresh();
    } catch (archiveError) {
      showToast(
        archiveError instanceof Error ? archiveError.message : ui.actionFailed,
        "error",
      );
    } finally {
      event.target.value = "";
    }
  };

  const startRename = (target: RenameTarget) => {
    setCreatePanel(null);
    setRenameTarget(target);
  };

  const updateRenameValue = (value: string) => {
    setRenameTarget((current) => (current ? { ...current, value } : current));
  };

  const cancelRename = () => {
    setRenameTarget(null);
  };

  const commitRename = async () => {
    const target = renameTarget;
    if (!target) {
      return;
    }

    const nextValue = target.value.trim();
    setRenameTarget(null);
    if (!nextValue) {
      return;
    }

    try {
      if (target.kind === "project") {
        const project = store.projects.find((item) => item.id === target.id);
        if (project && project.name !== nextValue) {
          await putItem("projects", {
            ...project,
            name: nextValue,
            updatedAt: nowIso(),
          });
          await refresh();
        }
        return;
      }

      if (target.kind === "theme") {
        const theme = store.themes.find((item) => item.id === target.id);
        if (theme && theme.name !== nextValue) {
          await putItem("themes", {
            ...theme,
            name: nextValue,
            updatedAt: nowIso(),
          });
          await refresh();
        }
        return;
      }

      const topic = store.topics.find((item) => item.id === target.id);
      if (topic && topic.title !== nextValue) {
        await putItem("topics", {
          ...topic,
          title: nextValue,
          updatedAt: nowIso(),
        });
        await refresh();
      }
    } catch (renameError) {
      showToast(
        renameError instanceof Error ? renameError.message : ui.actionFailed,
        "error",
      );
    }
  };

  const handleProjectDelete = (projectToDelete = selectedProject) => {
    if (!projectToDelete) {
      return;
    }

    requestConfirm({
      title: ui.projectDeleteTitle,
      message: ui.projectDeleteMessage(projectToDelete.name),
      confirmLabel: ui.delete,
      onConfirm: () => deleteProject(projectToDelete),
    });
  };

  const deleteProject = async (projectToDelete: Project) => {
    const topicIds = store.topics
      .filter((topic) => topic.projectId === projectToDelete.id)
      .map((topic) => topic.id);
    const versionIds = store.versions
      .filter((version) => topicIds.includes(version.topicId))
      .map((version) => version.id);
    const imageIds = store.images
      .filter(
        (image) =>
          topicIds.includes(image.topicId) ||
          versionIds.includes(image.versionId),
      )
      .map((image) => image.id);
    const themeIds = store.themes
      .filter((theme) => theme.projectId === projectToDelete.id)
      .map((theme) => theme.id);

    await Promise.all([
      ...imageIds.map((id) => deleteItem("images", id)),
      ...versionIds.map((id) => deleteItem("versions", id)),
      ...topicIds.map((id) => deleteItem("drafts", id)),
      ...topicIds.map((id) => deleteItem("topics", id)),
      ...themeIds.map((id) => deleteItem("themes", id)),
      deleteItem("projects", projectToDelete.id),
    ]);

    if (projectToDelete.id === selectedProjectId) {
      setSelectedProjectId("");
      setSelectedThemeId("");
      setSelectedTopicId("");
    }
    setCreatePanel(null);
    showToast(ui.projectDeleted);
    await refresh();
  };

  const handleThemeCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = newThemeName.trim();
    if (!name || !selectedProjectId) {
      return;
    }

    const createdAt = nowIso();
    const id = createId();
    await putItem("themes", {
      id,
      projectId: selectedProjectId,
      order: getNextOrder(projectThemes),
      name,
      color: newThemeColor,
      createdAt,
      updatedAt: createdAt,
    });
    setNewThemeName("");
    setSelectedThemeId(id);
    setSelectedTopicId("");
    setCreatePanel(null);
    showToast(ui.themeSaved);
    await refresh();
  };

  const handleTopicCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const title = newTopicTitle.trim();
    if (!title || !selectedProjectId || !selectedThemeId) {
      return;
    }

    const createdAt = nowIso();
    const id = createId();
    await putItem("topics", {
      id,
      projectId: selectedProjectId,
      themeId: selectedThemeId,
      order: getNextOrder(themeTopics),
      kind: newTopicKind,
      modelIds: newTopicModelIds,
      title,
      brief: newTopicBrief.trim(),
      createdAt,
      updatedAt: createdAt,
    });
    setNewTopicTitle("");
    setNewTopicBrief("");
    setNewTopicKind("text");
    setNewTopicModelIds(defaultModelIdsByKind.text);
    setSelectedTopicId(id);
    setCreatePanel(null);
    showToast(ui.topicSaved);
    await refresh();
  };

  const updateSelectedTopicModels = async (modelIds: string[]) => {
    if (!selectedTopic) {
      return;
    }

    const updatedAt = nowIso();
    const nextTopic = {
      ...selectedTopic,
      modelIds: modelIds as TopicModelId[],
      updatedAt,
    };

    setStore((current) => ({
      ...current,
      topics: current.topics.map((topic) =>
        topic.id === selectedTopic.id ? nextTopic : topic,
      ),
    }));
    setActiveVersionId("draft");
    await putItem("topics", nextTopic);
    await refresh();
  };

  const handleCustomModelAdd = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const provider = customModelProvider.trim();
    const id = customModelId.trim();
    if (!provider || !id) {
      showToast(ui.modelRequired, "error");
      return;
    }

    const price = Number(customModelPrice);
    if (!Number.isFinite(price) || price < 0) {
      showToast(ui.modelPriceInvalid, "error");
      return;
    }

    const pricingType = customModelKind === "image" ? "image" : "input";
    const tokenUnitInTenThousands = Number(customModelTokenUnitInTenThousands);
    if (
      pricingType === "input" &&
      (!Number.isFinite(tokenUnitInTenThousands) ||
        tokenUnitInTenThousands <= 0)
    ) {
      showToast(ui.modelTokenUnitInvalid, "error");
      return;
    }

    const editingModel = editingModelKey
      ? customModels.find(
          (item) => `${item.kind}:${item.id}` === editingModelKey,
        )
      : null;
    const overrideModelKey = editingModelKey
      ? (editingModel?.overridesModelKey ?? editingModelKey)
      : null;
    const model: TopicModelConfig = {
      id,
      provider,
      kind: customModelKind,
      memo: customModelMemo.trim(),
      role:
        customModelKind === "image"
          ? "image-generation"
          : customModelKind === "voice"
            ? "voice"
            : customModelKind === "video"
              ? "video"
              : "chat-input",
      pricingType,
      ...(overrideModelKey ? { overridesModelKey: overrideModelKey } : {}),
      ...(pricingType === "image"
        ? { costPerImageUsd: price }
        : {
            inputPriceUsd: price,
            inputTokenUnitInTenThousands: tokenUnitInTenThousands,
          }),
    };

    const nextModelKey = `${customModelKind}:${id}`;

    setCustomModels((current) =>
      normalizeCustomModels([
        ...current.filter((item) => {
          const itemKey = `${item.kind}:${item.id}`;

          return itemKey !== nextModelKey && itemKey !== editingModelKey;
        }),
        model,
      ]),
    );
    resetCustomModelForm(customModelKind);
    showToast(editingModelKey ? ui.modelUpdated : ui.modelSaved);
  };

  const handleCustomModelDelete = (
    modelOrModels: TopicModelConfig | TopicModelConfig[],
  ) => {
    const modelsToDelete = Array.isArray(modelOrModels)
      ? modelOrModels
      : [modelOrModels];

    setCustomModels((current) =>
      current.filter(
        (item) =>
          !modelsToDelete.some(
            (model) => item.kind === model.kind && item.id === model.id,
          ),
      ),
    );
    showToast(ui.modelDeleted);
  };

  const handleCustomModelsExport = () => {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            app: "Git Prompt",
            schema: "git-prompt.custom-models",
            version: 1,
            exportedAt: nowIso(),
            models: customModels,
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );

    downloadBlob(blob, "git-prompt-models.json");
    showToast(ui.modelsExported);
  };

  const handleCustomModelsImport = async (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      const incoming = Array.isArray(parsed)
        ? parsed
        : Array.isArray((parsed as { models?: unknown }).models)
          ? (parsed as { models: unknown[] }).models
          : [];
      const incomingModels = normalizeCustomModels(
        incoming.filter(isTopicModelConfig),
      );

      if (incomingModels.length === 0) {
        showToast(ui.noModelOptions, "error");
        return;
      }

      setCustomModels((current) =>
        normalizeCustomModels([
          ...current.filter(
            (currentModel) =>
              !incomingModels.some(
                (incomingModel) =>
                  incomingModel.kind === currentModel.kind &&
                  incomingModel.id === currentModel.id,
              ),
          ),
          ...incomingModels,
        ]),
      );
      showToast(ui.modelsImported(incomingModels.length));
    } catch (importError) {
      showToast(
        importError instanceof Error ? importError.message : ui.actionFailed,
        "error",
      );
    } finally {
      event.target.value = "";
    }
  };

  const handleThemeDelete = (theme: Theme) => {
    requestConfirm({
      title: ui.themeDeleteTitle,
      message: ui.themeDeleteMessage(theme.name),
      confirmLabel: ui.delete,
      onConfirm: () => deleteTheme(theme),
    });
  };

  const deleteTheme = async (theme: Theme) => {
    const topicIds = store.topics
      .filter((topic) => topic.themeId === theme.id)
      .map((topic) => topic.id);
    const versionIds = store.versions
      .filter((version) => topicIds.includes(version.topicId))
      .map((version) => version.id);
    const imageIds = store.images
      .filter(
        (image) =>
          topicIds.includes(image.topicId) ||
          versionIds.includes(image.versionId),
      )
      .map((image) => image.id);

    await Promise.all([
      ...imageIds.map((id) => deleteItem("images", id)),
      ...versionIds.map((id) => deleteItem("versions", id)),
      ...topicIds.map((id) => deleteItem("drafts", id)),
      ...topicIds.map((id) => deleteItem("topics", id)),
      deleteItem("themes", theme.id),
    ]);

    if (theme.id === selectedThemeId) {
      setSelectedThemeId("");
      setSelectedTopicId("");
    }
    setCreatePanel(null);
    showToast(ui.themeDeleted);
    await refresh();
  };

  const handleTopicDelete = (topic: Topic) => {
    requestConfirm({
      title: ui.topicDeleteTitle,
      message: ui.topicDeleteMessage(topic.title),
      confirmLabel: ui.delete,
      onConfirm: () => deleteTopic(topic),
    });
  };

  const deleteTopic = async (topic: Topic) => {
    const versionIds = store.versions
      .filter((version) => version.topicId === topic.id)
      .map((version) => version.id);
    const imageIds = store.images
      .filter(
        (image) =>
          image.topicId === topic.id || versionIds.includes(image.versionId),
      )
      .map((image) => image.id);

    await Promise.all([
      ...imageIds.map((id) => deleteItem("images", id)),
      ...versionIds.map((id) => deleteItem("versions", id)),
      deleteItem("drafts", topic.id),
      deleteItem("topics", topic.id),
    ]);

    if (topic.id === selectedTopicId) {
      setSelectedTopicId("");
    }
    setCreatePanel(null);
    showToast(ui.topicDeleted);
    await refresh();
  };

  const commitDraftSystemPrompts = (systemPrompts: SystemPrompt[]) => {
    recordDraftHistorySnapshot();
    syncDraftSystemPrompts(systemPrompts);
    markEditorChanged();
  };

  const handleAddDraftSystemPrompt = () => {
    commitDraftSystemPrompts([
      ...draftSystemPrompts,
      createDraftSystemPrompt("", draftSystemPrompts.length + 1),
    ]);
  };

  const handleDraftSystemPromptNameChange = (index: number, value: string) => {
    commitDraftSystemPrompts(
      draftSystemPrompts.map((prompt, currentIndex) =>
        currentIndex === index ? { ...prompt, name: value } : prompt,
      ),
    );
  };

  const handleDraftSystemPromptBodyChange = (index: number, value: string) => {
    commitDraftSystemPrompts(
      draftSystemPrompts.map((prompt, currentIndex) =>
        currentIndex === index ? { ...prompt, body: value } : prompt,
      ),
    );
  };

  const deleteDraftSystemPrompt = (index: number) => {
    const nextSystemPrompts = draftSystemPrompts.filter(
      (_prompt, currentIndex) => currentIndex !== index,
    );

    commitDraftSystemPrompts(nextSystemPrompts);
    showToast(ui.systemPromptDeleted);
  };

  const handleDraftSystemPromptDelete = (index: number) => {
    const systemPrompt = draftSystemPrompts[index];
    const systemPromptName =
      systemPrompt?.name.trim() || ui.systemPromptIndex(index + 1);

    requestConfirm({
      title: ui.deleteSystemPromptTitle,
      message: ui.deleteSystemPromptMessage(systemPromptName),
      confirmLabel: ui.delete,
      onConfirm: () => deleteDraftSystemPrompt(index),
    });
  };

  const resetDraftSystemPrompts = () => {
    commitDraftSystemPrompts(copySystemPromptsToDraft(editingVersion ?? latestVersion));
  };

  const handleAddDraftResultText = () => {
    recordDraftHistorySnapshot();
    setDraftResultTexts((current) => [...toEditableResultTexts(current), ""]);
    markEditorChanged();
  };

  const handleDraftResultTextChange = (index: number, value: string) => {
    recordDraftHistorySnapshot();
    setDraftResultTexts((current) => {
      const next = [...toEditableResultTexts(current)];
      next[index] = value;
      return next;
    });
    markEditorChanged();
  };

  const deleteDraftResultText = (index: number) => {
    recordDraftHistorySnapshot();
    setDraftResultTexts((current) => {
      const next = toEditableResultTexts(current).filter(
        (_text, currentIndex) => currentIndex !== index,
      );

      return next.length > 0 ? next : [""];
    });
    markEditorChanged();
    showToast(ui.resultTextDeleted);
  };

  const handleDraftResultTextDelete = (index: number) => {
    requestConfirm({
      title: ui.deleteResultTextTitle,
      message: ui.deleteResultTextMessage(ui.resultTextIndex(index + 1)),
      confirmLabel: ui.delete,
      onConfirm: () => deleteDraftResultText(index),
    });
  };

  const handleDraftResultTextReorder = (
    draggedIndex: number,
    targetIndex: number,
    insertAfter: boolean,
  ) => {
    const sourceTexts = toEditableResultTexts(draftResultTexts);
    const nextTexts = moveItemByIndex(
      sourceTexts,
      draggedIndex,
      targetIndex,
      insertAfter,
    );

    if (nextTexts === sourceTexts) {
      return;
    }

    recordDraftHistorySnapshot();
    setDraftResultTexts(nextTexts);
    markEditorChanged();
  };

  const resetDraftResultTexts = () => {
    recordDraftHistorySnapshot();
    setDraftResultTexts(getEditableVersionResultTexts(editingVersion ?? latestVersion));
    markEditorChanged();
  };

  const handleImageUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []).filter((file) =>
      fileMatchesResultTopicKind(file, editorTopicKind),
    );
    if (!files.length) {
      event.target.value = "";
      return;
    }

    const loadedImages = await Promise.all(
      files.map((file) => fileToDraftImage(file)),
    );
    recordDraftHistorySnapshot();
    setDraftImages((current) => [...current, ...loadedImages]);
    markEditorChanged();
    event.target.value = "";
  };

  const pasteClipboardImages = useCallback(
    async (
      clipboardData: DataTransfer | null,
      preventDefault: () => void,
    ) => {
      if (!selectedTopicId || editorTopicKind !== "image") {
        return;
      }

      const files = clipboardData
        ? getCurrentClipboardImageFiles(clipboardData)
        : [];
      if (files.length === 0) {
        setToast({
          id: Date.now(),
          message: ui.noClipboardImage,
          variant: "error",
        });
        return;
      }

      preventDefault();
      const pastedAt = new Date();
      const timeLabel = `${pastedAt.getHours()}${pastedAt.getMinutes()}${pastedAt.getSeconds()}`;
      const images = await Promise.all(
        files.map((file, index) =>
          fileToDraftImage(file, `clipboard-${timeLabel}-${index + 1}.png`),
        ),
      );

      recordDraftHistorySnapshot();
      setDraftImages((current) => [...current, ...images]);
      setActiveVersionId(editingVersionId ?? "draft");
      setToast({ id: Date.now(), message: ui.imagesPasted, variant: "success" });
    },
    [
      editingVersionId,
      editorTopicKind,
      recordDraftHistorySnapshot,
      selectedTopicId,
      ui.imagesPasted,
      ui.noClipboardImage,
    ],
  );

  useEffect(() => {
    if (
      !pasteTargetActive ||
      mainView !== "write" ||
      isVersionView ||
      editorTopicKind !== "image"
    ) {
      return;
    }

    const handleDocumentPaste = (event: ClipboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }

      void pasteClipboardImages(event.clipboardData, () => event.preventDefault());
    };

    document.addEventListener("paste", handleDocumentPaste);
    return () => {
      document.removeEventListener("paste", handleDocumentPaste);
    };
  }, [
    editorTopicKind,
    isVersionView,
    mainView,
    pasteClipboardImages,
    pasteTargetActive,
  ]);

  const deleteDraftImage = async (imageId: string) => {
    const image = draftImages.find((item) => item.id === imageId);
    if (!image) {
      return;
    }

    const nextDraftImages = draftImages
      .filter((item) => item.id !== imageId)
      .map((item, index) => ({ ...item, order: index }));
    const sourceImageId = editingVersion ? image.sourceId : undefined;

    if (sourceImageId && editingVersion) {
      const nextVersion = {
        ...editingVersion,
        costSnapshot: createEditedVersionSnapshot(
          editingVersion,
          getVersionResultText(editingVersion),
          countImageResultMedia(nextDraftImages),
          getVersionResultTexts(editingVersion).length + nextDraftImages.length,
        ),
      };

      await deleteItem("images", sourceImageId);
      await putItem("versions", nextVersion);
      setStore((current) => ({
        ...current,
        images: current.images.filter((item) => item.id !== sourceImageId),
        versions: current.versions.map((version) =>
          version.id === nextVersion.id ? nextVersion : version,
        ),
      }));
    } else {
      recordDraftHistorySnapshot();
      markEditorChanged();
    }

    setDraftImages(nextDraftImages);
    showToast(ui.resultFileDeleted);
  };

  const handleDraftImageDelete = (imageId: string) => {
    const image = draftImages.find((item) => item.id === imageId);
    if (!image) {
      return;
    }

    requestConfirm({
      title: ui.deleteResultMediaTitle,
      message: ui.deleteResultMediaMessage(image.name),
      confirmLabel: ui.delete,
      onConfirm: () => deleteDraftImage(imageId),
    });
  };

  const handleDraftImageReorder = (
    draggedImageId: string,
    targetImageId: string,
    insertAfter: boolean,
  ) => {
    const movedImages = moveItemById(
      draftImages,
      draggedImageId,
      targetImageId,
      insertAfter,
    );

    if (movedImages === draftImages) {
      return;
    }

    const nextImages = movedImages.map((image, index) => ({
      ...image,
      order: index,
    }));

    recordDraftHistorySnapshot();
    setDraftImages(nextImages);
    markEditorChanged();
  };

  const handleVersionSave = async () => {
    if (!selectedTopic) {
      return;
    }

    const systemPrompts = toStoredSystemPrompts(draftSystemPrompts);
    const body = getSystemPromptText(systemPrompts);
    const userPrompt = draftUserPrompt.trim();
    if (!getCombinedPromptText({ body, userPrompt }).trim()) {
      showToast(ui.promptEmpty, "error");
      return;
    }

    const resultTexts = normalizeResultTexts(draftResultTexts);
    const resultText = joinResultTexts(resultTexts);
    const resultCount = resultTexts.length + draftImages.length;
    if (resultCount === 0) {
      showToast(ui.enterPromptResult, "error");
      return;
    }

    const snapshotMetrics = estimateDraftCostMetrics({
      body,
      imageCount: selectedTopicKind === "image" ? draftImageResultCount : 0,
      imagesByVersion,
      kind: selectedTopicKind,
      modelConfigs: customModels,
      modelIds: selectedTopicModelIds,
      previousVersion: latestVersion,
      resultText,
      resultTexts,
      resultCount,
      userPrompt,
    });
    const createdAt = nowIso();
    const versionId = createId();
    const nextVersion: PromptVersion = {
      id: versionId,
      topicId: selectedTopic.id,
      kind: selectedTopicKind,
      modelIds: selectedTopicModelIds,
      costSnapshot: createCostSnapshot(snapshotMetrics),
      label: draftLabel.trim() || `v${topicVersions.length + 1}`,
      body,
      systemPrompts,
      userPrompt,
      resultText: selectedTopicKind === "text" ? resultText : "",
      resultTexts: selectedTopicKind === "text" ? resultTexts : [],
      notes: draftNotes.trim(),
      createdAt,
    };
    await putItem("versions", nextVersion);

    const imagesToSave: ImageAsset[] = draftImages.map((image, index) => {
      const { kind, name, type, dataUrl } = image;
      return {
        id: createId(),
        order: index,
        kind,
        name,
        type,
        dataUrl,
        topicId: selectedTopic.id,
        versionId,
        createdAt,
      };
    });
    await Promise.all(
      imagesToSave.map((image) => putItem("images", image)),
    );

    const nextTopic = {
      ...selectedTopic,
      kind: selectedTopicKind,
      modelIds: selectedTopicModelIds,
      updatedAt: createdAt,
    };
    const nextDraftSystemPrompts = systemPrompts.map((prompt) => ({
      ...prompt,
      id: createId(),
    }));
    const nextDraft: PromptDraft = {
      topicId: selectedTopic.id,
      kind: selectedTopicKind,
      label: `v${topicVersions.length + 2}`,
      body: getSystemPromptText(nextDraftSystemPrompts),
      systemPrompts: nextDraftSystemPrompts,
      userPrompt,
      resultTexts: [""],
      notes: "",
      images: [],
      updatedAt: createdAt,
    };
    await putItem("topics", nextTopic);
    await putItem("drafts", nextDraft);

    setStore((current) => ({
      ...current,
      topics: current.topics.map((topic) =>
        topic.id === nextTopic.id ? nextTopic : topic,
      ),
      versions: [...current.versions, nextVersion].sort((a, b) =>
        a.createdAt.localeCompare(b.createdAt),
      ),
      images: [...current.images, ...imagesToSave],
      drafts: upsertDraft(current.drafts, nextDraft),
    }));
    applyDraftState(nextDraft);
    clearDraftHistory();
    setActiveVersionId(versionId);
    setCompareDirection("previous");
    setBaseResultDiffIndex(0);
    setTargetResultDiffIndex(0);
    setMainView("diff");
    showToast(ui.versionSaved);
  };

  const createEditedVersionSnapshot = (
    version: PromptVersion,
    resultText: string,
    rawImageCount: number,
    resultCount: number,
  ) => {
    const kind = getVersionKind(version);
    if (version.costSnapshot) {
      return repriceCostSnapshotForResultCount({
        kind,
        rawImageCount,
        resultCount,
        resultText,
        snapshot: version.costSnapshot,
      });
    }

    const metrics = estimateDraftCostMetrics({
      body: version.body,
      imageCount: rawImageCount,
      imagesByVersion,
      kind,
      modelConfigs: customModels,
      modelIds: version.modelIds ?? selectedTopicModelIds,
      previousVersion: null,
      resultText,
      resultTexts: resultText ? [resultText] : [],
      resultCount,
      userPrompt: getVersionUserPrompt(version),
    });

    return createCostSnapshot(metrics);
  };

  const handleVersionEditSave = async () => {
    if (!editingVersion || !selectedTopic) {
      return;
    }

    const kind = getVersionKind(editingVersion);
    const resultTexts = normalizeResultTexts(draftResultTexts);
    const resultText = joinResultTexts(resultTexts);
    const resultCount = resultTexts.length + draftImages.length;
    if (resultCount === 0) {
      showToast(ui.enterPromptResult, "error");
      return;
    }

    const savedAt = nowIso();
    const imagesToSave = draftImages;
    const existingImageMap = new Map(
      store.images
        .filter((image) => image.versionId === editingVersion.id)
        .map((image) => [image.id, image]),
    );
    const existingImageIds = store.images
      .filter((image) => image.versionId === editingVersion.id)
      .map((image) => image.id);
    const nextVersion = {
      ...editingVersion,
      costSnapshot: createEditedVersionSnapshot(
        editingVersion,
        resultText,
        kind === "image" ? countImageResultMedia(imagesToSave) : 0,
        resultCount,
      ),
      label: draftLabel.trim() || editingVersion.label,
      notes: draftNotes.trim(),
      resultText: kind === "text" ? resultText : "",
      resultTexts: kind === "text" ? resultTexts : [],
    };

    await putItem("versions", nextVersion);
    await Promise.all(existingImageIds.map((id) => deleteItem("images", id)));
    await Promise.all(
      imagesToSave.map((image, index) => {
        const { kind: mediaKind, name, type, dataUrl } = image;
        const id = image.sourceId ?? image.id;
        const existingImage = existingImageMap.get(id);

        return putItem("images", {
          id,
          order: index,
          kind: mediaKind,
          name,
          type,
          dataUrl,
          topicId: selectedTopic.id,
          versionId: editingVersion.id,
          createdAt: existingImage?.createdAt ?? savedAt,
        });
      }),
    );

    await refresh();
    applyDraftState(selectedTopicDraft ?? createDefaultDraftState());
    clearDraftHistory();
    setEditingVersionId(null);
    setActiveVersionId(editingVersion.id);
    setMainView("write");
    showToast(ui.versionUpdated);
  };

  const handleVersionDelete = (versionId: string) => {
    const version = topicVersions.find((item) => item.id === versionId);

    requestConfirm({
      title: ui.versionDeleteTitle,
      message: ui.versionDeleteMessage(
        version?.label ?? ui.versionDeleteFallback,
      ),
      confirmLabel: ui.delete,
      onConfirm: () => deleteVersion(versionId),
    });
  };

  const toggleGoodResult = async (version: PromptVersion) => {
    const nextVersion = {
      ...version,
      isGoodResult: !version.isGoodResult,
    };

    setStore((current) => ({
      ...current,
      versions: current.versions.map((item) =>
        item.id === version.id ? nextVersion : item,
      ),
    }));
    await putItem("versions", nextVersion);
    await refresh();
    showToast(
      nextVersion.isGoodResult
        ? ui.goodResultMarked(version.label)
        : ui.goodResultUnmarked(version.label),
    );
  };

  const deleteVersion = async (versionId: string) => {
    const imageIds = store.images
      .filter((image) => image.versionId === versionId)
      .map((image) => image.id);

    await Promise.all([
      deleteItem("versions", versionId),
      ...imageIds.map((id) => deleteItem("images", id)),
    ]);
    const remainingVersions = topicVersions.filter(
      (version) => version.id !== versionId,
    );
    const remainingLatest =
      remainingVersions[remainingVersions.length - 1] ?? null;
    const fallbackSystemPrompts = remainingLatest
      ? copySystemPromptsToDraft(remainingLatest)
      : [createDraftSystemPrompt()];
    applyDraftState(
      selectedTopicDraft ?? {
        topicId: selectedTopicId,
        kind: getTopicKind(selectedTopic, remainingLatest),
        label: remainingLatest
          ? `v${remainingVersions.length + 1}`
          : ui.draftLabel,
        body: getSystemPromptText(fallbackSystemPrompts),
        systemPrompts: fallbackSystemPrompts,
        userPrompt: getVersionUserPrompt(remainingLatest),
        resultTexts: [""],
        notes: "",
        images: [],
        updatedAt: nowIso(),
      },
    );
    clearDraftHistory();
    if (editingVersionId === versionId) {
      setEditingVersionId(null);
    }
    await refresh();
    setActiveVersionId("draft");
    showToast(ui.versionDeleted);
  };

  const checkoutVersion = (version: PromptVersion) => {
    setEditingVersionId(null);
    setActiveVersionId(version.id);
    setCompareDirection("previous");
    setMainView("diff");
  };

  const cherryPickVersion = (version: PromptVersion) => {
    setEditingVersionId(null);
    recordDraftHistorySnapshot(true);
    setDraftKind(selectedTopicKind);
    syncDraftSystemPrompts(copySystemPromptsToDraft(version));
    setDraftUserPrompt(getVersionUserPrompt(version));
    setDraftResultTexts([""]);
    setDraftNotes("");
    setDraftImages([]);
    if (version.modelIds?.length) {
      void updateSelectedTopicModels(version.modelIds);
    }
    setActiveVersionId("draft");
    setMainView("write");
    showToast(ui.cherryPickApplied(version.label));
  };

  const editVersion = (version: PromptVersion) => {
    const kind = getVersionKind(version);

    setEditingVersionId(version.id);
    setDraftLabel(version.label);
    setDraftKind(kind);
    syncDraftSystemPrompts(copySystemPromptsToDraft(version));
    setDraftUserPrompt(getVersionUserPrompt(version));
    setDraftResultTexts(getEditableVersionResultTexts(version));
    setDraftNotes(version.notes);
    setDraftImages(
      kind !== "text" ? copyImagesToDraft(imagesByVersion[version.id] ?? []) : [],
    );
    clearDraftHistory();
    setActiveVersionId(version.id);
    setMainView("write");
  };

  const cancelVersionEdit = () => {
    setEditingVersionId(null);
    applyDraftState(selectedTopicDraft ?? createDefaultDraftState());
    clearDraftHistory();
    setActiveVersionId("draft");
    setMainView("write");
  };

  if (loading) {
    return (
      <main className="loading-screen">
        <Sparkles aria-hidden="true" />
        <span>{ui.loading}</span>
      </main>
    );
  }

  const isDarkTheme = appearanceTheme === "dark";
  const emptyStateTitle = !selectedProject
    ? ui.selectProject
    : !selectedTheme
      ? ui.selectTheme
      : ui.selectTopic;

  const selectedTopicModelOptions = selectedTopic
    ? getModelOptions(editorTopicKind, customModels).map((option) => ({
        description: [option.provider, option.memo].filter(Boolean).join(" · "),
        displayLabel: getModelDisplayName(option.id),
        group: ui.modelUse(option.kind),
        id: option.selectionId,
        label: option.label,
      }))
    : [];
  const isCustomModelImage = customModelKind === "image";
  const customModelPricePlaceholder = isCustomModelImage
    ? ui.imageUsdPlaceholder
    : ui.usdAmountPlaceholder;
  const customModelKeySet = new Set(
    customModels.map((model) => `${model.kind}:${model.id}`),
  );
  const customModelOverrideKeySet = new Set(
    customModels
      .map((model) =>
        model.overridesModelKey
          ? normalizeLegacyModelSelectionId(model.overridesModelKey)
          : undefined,
      )
      .filter((modelKey): modelKey is TopicModelId => Boolean(modelKey)),
  );
  const builtInLibraryModels = [
    ...getAvailableModelConfigs("text").filter(
      (model) => model.kind === "text",
    ),
    ...getAvailableModelConfigs("image").filter(
      (model) => model.kind === "image",
    ),
  ];
  type ModelLibrarySource = "builtin" | "custom";
  type ModelLibraryItem = {
    model: TopicModelConfig;
    source: ModelLibrarySource;
  };
  const modelLibraryItems: ModelLibraryItem[] = [
    ...builtInLibraryModels
      .filter(
        (model) =>
          !customModelKeySet.has(`${model.kind}:${model.id}`) &&
          !customModelOverrideKeySet.has(`${model.kind}:${model.id}`),
      )
      .map((model) => ({ model, source: "builtin" as const })),
    ...customModels.map((model) => ({ model, source: "custom" as const })),
  ].sort(
    (a, b) =>
      modelKindOrder[a.model.kind] - modelKindOrder[b.model.kind] ||
      a.model.provider.localeCompare(b.model.provider) ||
      a.model.id.localeCompare(b.model.id),
  );
  const modelLibraryGroups: Array<{
    kind: TopicModelKind;
    items: ModelLibraryItem[];
  }> = [];
  modelLibraryItems.forEach((item) => {
    const group = modelLibraryGroups.find(
      (groupItem) => groupItem.kind === item.model.kind,
    );
    if (group) {
      group.items.push(item);
      return;
    }
    modelLibraryGroups.push({ kind: item.model.kind, items: [item] });
  });
  const modelUnitPrice = (model: TopicModelConfig) => {
    if (model.pricingType === "image") {
      return ui.imageRate(
        formatCurrency(
          model.costPerImageUsd ?? 0,
          locale,
          usdKrwExchangeRate?.rate ?? null,
        ),
      );
    }

    const inputRate = getInputRateParts(model);

    return ui.modelRate(
      formatCurrency(
        inputRate.inputPriceUsd,
        locale,
        usdKrwExchangeRate?.rate ?? null,
      ),
      inputRate.inputTokenUnitInTenThousands.toLocaleString(),
    );
  };

  const modelProviderOptions = Array.from(
    new Set(
      [
        ...builtInLibraryModels.map((model) => model.provider),
        ...customModels.map((model) => model.provider),
        customModelProvider,
      ]
        .map((provider) => provider.trim())
        .filter(Boolean),
    ),
  ).sort((a, b) => a.localeCompare(b));

  const commitCustomModelProvider = (provider: string) => {
    const trimmedProvider = provider.trim();

    if (!trimmedProvider) {
      return;
    }

    setCustomModelProvider(trimmedProvider);
    setCustomModelProviderDraft("");
    setCustomModelProviderOpen(false);
  };

  const historySidebar = (
    <div className="history-pane">
      <HistoryGraph
        activeVersionId={activeVersionId}
        draftNotes={draftNotes}
        hasDraftChanges={hasDraftGraphChanges}
        selectedTopic={selectedTopic ?? null}
        topicVersions={topicVersions}
        locale={locale}
        metricsByVersion={metricsByVersion}
        ui={ui}
        usdKrwRate={usdKrwExchangeRate?.rate ?? null}
        onCheckout={checkoutVersion}
        onCherryPick={cherryPickVersion}
        onDelete={handleVersionDelete}
        onEdit={editVersion}
        onOpenDraftDiff={() => {
          setEditingVersionId(null);
          setActiveVersionId("draft");
          setCompareDirection("previous");
          setMainView("diff");
        }}
        onOpenVersionDiff={(versionId) => {
          setEditingVersionId(null);
          setActiveVersionId(versionId);
          setCompareDirection("previous");
          setMainView("diff");
        }}
        onToggleGoodResult={(version) => void toggleGoodResult(version)}
      />
    </div>
  );

  const modelsSidebar = (
    <div className="models-pane">
      <section className="models-toolbar">
        <span className="models-toolbar-title">
          <span>{editingModelKey ? ui.modelEditMode : ui.addModel}</span>
          {editingModelKey ? (
            <button
              type="button"
              className="mini-icon-button"
              onClick={() => resetCustomModelForm()}
              aria-label={ui.modelEditCancel}
              title={ui.modelEditCancel}
            >
              <X aria-hidden="true" size={13} />
            </button>
          ) : null}
        </span>
        <div className="models-toolbar-actions">
          <button
            type="button"
            className="mini-icon-button"
            onClick={handleCustomModelsExport}
            disabled={customModels.length === 0}
            aria-label={ui.modelExportTitle}
            title={ui.modelExportTitle}
          >
            <Download aria-hidden="true" size={13} />
          </button>
          <button
            type="button"
            className="mini-icon-button"
            onClick={() => customModelImportInputRef.current?.click()}
            aria-label={ui.modelImportTitle}
            title={ui.modelImportTitle}
          >
            <Upload aria-hidden="true" size={13} />
          </button>
          <input
            ref={customModelImportInputRef}
            className="visually-hidden"
            type="file"
            accept=".json,application/json"
            onChange={handleCustomModelsImport}
          />
        </div>
      </section>

      <form
        className="custom-model-form model-library-form"
        onSubmit={handleCustomModelAdd}
      >
        <div
          className="result-type-control compact-kind-control model-kind-toggle"
          aria-label={ui.modelKind}
        >
          <button
            type="button"
            className={`segment-button ${customModelKind === "text" ? "active" : ""}`}
            onClick={() => selectCustomModelKind("text")}
            disabled={Boolean(editingModelKey)}
          >
            <FileText aria-hidden="true" size={14} />
            {ui.text}
          </button>
          <button
            type="button"
            className={`segment-button ${customModelKind === "image" ? "active" : ""}`}
            onClick={() => selectCustomModelKind("image")}
            disabled={Boolean(editingModelKey)}
          >
            <ImageIcon aria-hidden="true" size={14} />
            {ui.image}
          </button>
          <button
            type="button"
            className={`segment-button ${customModelKind === "voice" ? "active" : ""}`}
            onClick={() => selectCustomModelKind("voice")}
            disabled={Boolean(editingModelKey)}
          >
            <Mic aria-hidden="true" size={14} />
            {ui.voice}
          </button>
          <button
            type="button"
            className={`segment-button ${customModelKind === "video" ? "active" : ""}`}
            onClick={() => selectCustomModelKind("video")}
            disabled={Boolean(editingModelKey)}
          >
            <Video aria-hidden="true" size={14} />
            {ui.video}
          </button>
        </div>
        <div className="custom-model-fields">
          <div className="model-provider-picker" ref={customModelProviderPickerRef}>
            <button
              type="button"
              className={`model-provider-trigger ${customModelProviderOpen ? "open" : ""}`}
              onClick={() => setCustomModelProviderOpen((current) => !current)}
              aria-expanded={customModelProviderOpen}
              aria-label={ui.modelProviderPlaceholder}
            >
              <span>{customModelProvider || ui.modelProviderPlaceholder}</span>
              <ChevronDown aria-hidden="true" size={14} />
            </button>
            {customModelProviderOpen ? (
              <div className="model-provider-popover">
                <div className="model-provider-options">
                  {modelProviderOptions.map((provider) => (
                    <button
                      type="button"
                      key={provider}
                      className={provider === customModelProvider ? "active" : ""}
                      onClick={() => commitCustomModelProvider(provider)}
                    >
                      {provider}
                    </button>
                  ))}
                </div>
                <div className="model-provider-add-row">
                  <input
                    value={customModelProviderDraft}
                    onChange={(event) =>
                      setCustomModelProviderDraft(event.target.value)
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        commitCustomModelProvider(customModelProviderDraft);
                      }
                    }}
                    placeholder={ui.modelProviderPlaceholder}
                  />
                  <button
                    type="button"
                    className="primary-small-button"
                    onClick={() => commitCustomModelProvider(customModelProviderDraft)}
                  >
                    {ui.add}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
          <input
            value={customModelId}
            onChange={(event) => setCustomModelId(event.target.value)}
            placeholder={ui.modelIdPlaceholder}
          />
        </div>
        <textarea
          value={customModelMemo}
          onChange={(event) => setCustomModelMemo(event.target.value)}
          placeholder={ui.modelMemoPlaceholder}
          rows={2}
        />
        <div className="custom-model-submit-row">
          {isCustomModelImage ? (
            <div className="custom-model-rate-field image-rate">
              <label className="custom-model-rate-box">
                <span>$</span>
                <input
                  aria-label={ui.usdAmountPlaceholder}
                  type="number"
                  min="0"
                  step="any"
                  value={customModelPrice}
                  onChange={(event) => setCustomModelPrice(event.target.value)}
                  placeholder="0.04"
                />
              </label>
            </div>
          ) : (
            <div className="custom-model-rate-field">
              <label className="custom-model-rate-box">
                <span>$</span>
                <input
                  aria-label={ui.usdAmountPlaceholder}
                  type="number"
                  min="0"
                  step="any"
                  value={customModelPrice}
                  onChange={(event) => setCustomModelPrice(event.target.value)}
                  placeholder="0.20"
                />
              </label>
              <span className="custom-model-rate-divider">/</span>
              <label className="custom-model-rate-box token-unit">
                <input
                  aria-label={ui.tokenUnitTenThousandAria}
                  type="number"
                  min="1"
                  step="any"
                  value={customModelTokenUnitInTenThousands}
                  onChange={(event) =>
                    setCustomModelTokenUnitInTenThousands(event.target.value)
                  }
                  placeholder="100"
                />
                <span>{ui.tokenUnitTenThousandLabel}</span>
              </label>
            </div>
          )}
          <button type="submit" className="primary-small-button">
            {editingModelKey ? ui.saveModelEdit : ui.addCustomModel}
          </button>
        </div>
      </form>

      <div className="model-library-list">
        {modelLibraryGroups.map((group) => (
          <section className="model-library-section" key={group.kind}>
            <div className="model-library-provider">
              <span>{ui.modelUse(group.kind)}</span>
              <small>{group.items.length}</small>
            </div>
            <div className="model-library-rows">
              {group.items.map(({ model, source }) => (
                <article
                  className="model-library-row"
                  key={`${source}-${model.kind}-${model.id}`}
                >
                  <div className="model-library-main">
                    <span className="model-library-meta">
                      <span>{model.provider}</span>
                      {model.memo ? <span>{model.memo}</span> : null}
                      <span className={`model-source-badge ${source}`}>
                        {source === "builtin" ? ui.builtInModel : ui.userModel}
                      </span>
                    </span>
                    <code title={model.id}>
                      {getModelDisplayName(model.id)}
                    </code>
                  </div>
                  <div className="model-library-side">
                    <span>{modelUnitPrice(model)}</span>
                    <button
                      type="button"
                      className="model-library-edit-button"
                      onClick={() => startModelEdit(model)}
                      aria-label={ui.modelEditTitle(model.id)}
                      title={ui.modelEditTitle(model.id)}
                    >
                      <Pencil aria-hidden="true" size={14} />
                    </button>
                    {source === "custom" ? (
                      <button
                        type="button"
                        className="model-library-delete-button"
                        onClick={() => handleCustomModelDelete(model)}
                        aria-label={ui.deleteModelAria(model.id)}
                        title={ui.deleteModelAria(model.id)}
                      >
                        <Trash2 aria-hidden="true" size={14} />
                      </button>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );

  const sidebarTitle =
    sidebarView === "explorer"
      ? ui.explorer
      : sidebarView === "history"
        ? ui.history
        : ui.models;
  const noopTreePreviewAction = () => {};
  const draggedProjectPreview =
    draggedTreeTarget?.kind === "project"
      ? displayProjects.find((project) => project.id === draggedTreeTarget.id) ??
        null
      : null;
  const draggedThemePreview =
    draggedTreeTarget?.kind === "theme"
      ? projectThemes.find((theme) => theme.id === draggedTreeTarget.id) ?? null
      : null;
  const draggedTopicPreview =
    draggedTreeTarget?.kind === "topic"
      ? themeTopics.find((topic) => topic.id === draggedTreeTarget.id) ?? null
      : null;
  const renderProjectDropPreview = (
    targetId: string,
    position: DropPreviewPosition,
  ) =>
    draggedProjectPreview ? (
      <TreeRow
        kind="project"
        active={false}
        count={themeCountByProject[draggedProjectPreview.id] ?? 0}
        deleteLabel=""
        draggable
        icon={<Folder aria-hidden="true" size={15} />}
        name={draggedProjectPreview.name}
        preview
        onClick={noopTreePreviewAction}
        onDelete={noopTreePreviewAction}
        onDoubleClick={noopTreePreviewAction}
        onDragOver={(event) =>
          handleTreeDragOver("project", targetId, event, position)
        }
        onDrop={(event) =>
          void handleTreeDrop("project", targetId, event, position === "after")
        }
      />
    ) : null;
  const renderThemeDropPreview = (
    targetId: string,
    position: DropPreviewPosition,
  ) => {
    if (!draggedThemePreview) {
      return null;
    }

    const ThemeIcon = Folder;

    return (
      <TreeRow
        kind="theme"
        active={false}
        count={topicCountByTheme[draggedThemePreview.id] ?? 0}
        deleteLabel=""
        draggable
        icon={
          <ThemeIcon
            aria-hidden="true"
            className="theme-folder-icon"
            size={15}
            style={{ color: draggedThemePreview.color }}
          />
        }
        name={draggedThemePreview.name}
        preview
        onClick={noopTreePreviewAction}
        onDelete={noopTreePreviewAction}
        onDoubleClick={noopTreePreviewAction}
        onDragOver={(event) =>
          handleTreeDragOver("theme", targetId, event, position)
        }
        onDrop={(event) =>
          void handleTreeDrop("theme", targetId, event, position === "after")
        }
      />
    );
  };
  const renderTopicDropPreview = (
    targetId: string,
    position: DropPreviewPosition,
  ) => {
    if (!draggedTopicPreview) {
      return null;
    }

    const TopicIcon = getTopicIconComponent(getTopicKind(draggedTopicPreview));
    const versionCount = store.versions.filter(
      (version) => version.topicId === draggedTopicPreview.id,
    ).length;

    return (
      <TreeRow
        kind="topic"
        active={false}
        count={versionCount}
        deleteLabel=""
        draggable
        icon={<TopicIcon aria-hidden="true" size={15} />}
        name={draggedTopicPreview.title}
        preview
        onClick={noopTreePreviewAction}
        onDelete={noopTreePreviewAction}
        onDoubleClick={noopTreePreviewAction}
        onDragOver={(event) =>
          handleTreeDragOver("topic", targetId, event, position)
        }
        onDrop={(event) =>
          void handleTreeDrop("topic", targetId, event, position === "after")
        }
      />
    );
  };
  const renderTreeFloatingPreview = () => {
    if (!treeDragOverlay) {
      return null;
    }

    const overlayStyle = {
      left: treeDragOverlay.x - treeDragOverlay.offsetX,
      top: treeDragOverlay.y - treeDragOverlay.offsetY,
      width: treeDragOverlay.width,
    };

    if (treeDragOverlay.kind === "project" && draggedProjectPreview) {
      return (
        <div className="drag-floating-preview" style={overlayStyle}>
          <TreeRow
            kind="project"
            active={draggedProjectPreview.id === selectedProjectId}
            count={themeCountByProject[draggedProjectPreview.id] ?? 0}
            deleteLabel=""
            draggable
            icon={
              draggedProjectPreview.id === selectedProjectId ? (
                <FolderOpen aria-hidden="true" size={15} />
              ) : (
                <Folder aria-hidden="true" size={15} />
              )
            }
            name={draggedProjectPreview.name}
            preview
            previewVariant="floating"
            onClick={noopTreePreviewAction}
            onDelete={noopTreePreviewAction}
            onDoubleClick={noopTreePreviewAction}
          />
        </div>
      );
    }

    if (treeDragOverlay.kind === "theme" && draggedThemePreview) {
      const ThemeIcon =
        draggedThemePreview.id === selectedThemeId ? FolderOpen : Folder;

      return (
        <div className="drag-floating-preview" style={overlayStyle}>
          <TreeRow
            kind="theme"
            active={draggedThemePreview.id === selectedThemeId}
            count={topicCountByTheme[draggedThemePreview.id] ?? 0}
            deleteLabel=""
            draggable
            icon={
              <ThemeIcon
                aria-hidden="true"
                className="theme-folder-icon"
                size={15}
                style={{ color: draggedThemePreview.color }}
              />
            }
            name={draggedThemePreview.name}
            preview
            previewVariant="floating"
            onClick={noopTreePreviewAction}
            onDelete={noopTreePreviewAction}
            onDoubleClick={noopTreePreviewAction}
          />
        </div>
      );
    }

    if (treeDragOverlay.kind === "topic" && draggedTopicPreview) {
      const TopicIcon = getTopicIconComponent(getTopicKind(draggedTopicPreview));
      const versionCount = store.versions.filter(
        (version) => version.topicId === draggedTopicPreview.id,
      ).length;

      return (
        <div className="drag-floating-preview" style={overlayStyle}>
          <TreeRow
            kind="topic"
            active={draggedTopicPreview.id === selectedTopicId}
            count={versionCount}
            deleteLabel=""
            draggable
            icon={<TopicIcon aria-hidden="true" size={15} />}
            name={draggedTopicPreview.title}
            preview
            previewVariant="floating"
            onClick={noopTreePreviewAction}
            onDelete={noopTreePreviewAction}
            onDoubleClick={noopTreePreviewAction}
          />
        </div>
      );
    }

    return null;
  };

  return (
    <div
      className="app-shell"
      data-theme={appearanceTheme}
      data-tree-dragging={draggedTreeTarget ? "true" : undefined}
      onDragOver={updateTreeDragOverlayPosition}
    >
      {renderTreeFloatingPreview()}
      <nav className="activity-bar" aria-label={ui.workViewAria}>
        <button
          type="button"
          className={sidebarView === "explorer" ? "active" : ""}
          onClick={() => setSidebarView("explorer")}
          aria-label={ui.explorer}
          title={ui.explorer}
        >
          <PanelLeft aria-hidden="true" size={19} />
        </button>
        <button
          type="button"
          className={sidebarView === "history" ? "active" : ""}
          onClick={() => setSidebarView("history")}
          aria-label={ui.history}
          title={ui.history}
        >
          <GitBranch aria-hidden="true" size={19} />
        </button>
        <button
          type="button"
          className={sidebarView === "models" ? "active" : ""}
          onClick={() => setSidebarView("models")}
          aria-label={ui.models}
          title={ui.models}
        >
          <Sparkles aria-hidden="true" size={19} />
        </button>
        <button
          type="button"
          className="theme-toggle-button"
          onClick={() => setAppearanceTheme(isDarkTheme ? "light" : "dark")}
          aria-label={isDarkTheme ? ui.switchToLightAria : ui.switchToDarkAria}
          title={isDarkTheme ? ui.switchToLightTitle : ui.switchToDarkTitle}
        >
          {isDarkTheme ? (
            <Sun aria-hidden="true" size={19} />
          ) : (
            <Moon aria-hidden="true" size={19} />
          )}
        </button>
        <button
          type="button"
          className="language-toggle-button"
          onClick={() => setLocale(locale === "ko" ? "en" : "ko")}
          aria-label={ui.languageToggleAria}
          title={ui.languageToggleAria}
        >
          <span>{locale === "ko" ? "KO" : "EN"}</span>
        </button>
      </nav>

      <aside className="sidebar">
        <header className="sidebar-header">
          <div>
            <span className="sidebar-view-title">{sidebarTitle}</span>
            <strong>{ui.appName}</strong>
          </div>
          {sidebarView === "explorer" ? (
            <div className="sidebar-header-actions">
              <button
                type="button"
                className="sidebar-action-button"
                onClick={handleProjectExport}
                disabled={!selectedProject}
                aria-label={ui.exportProjectAria}
                title={ui.exportProjectTitle}
              >
                <Download aria-hidden="true" size={15} />
              </button>
              <button
                type="button"
                className="sidebar-action-button"
                onClick={() => projectImportInputRef.current?.click()}
                aria-label={ui.importProjectAria}
                title={ui.importProjectTitle}
              >
                <Upload aria-hidden="true" size={15} />
              </button>
              <input
                ref={projectImportInputRef}
                className="visually-hidden"
                type="file"
                accept=".zip,application/zip,application/x-zip-compressed"
                onChange={handleProjectImport}
              />
            </div>
          ) : null}
        </header>

        {sidebarView === "explorer" ? (
          <div className="explorer-pane">
            <section className="sidebar-section">
              <div className="section-title">
                <span className="section-title-label">
                  <ChevronDown aria-hidden="true" size={13} />
                  {ui.projectsSection}
                  <small>{displayProjects.length}</small>
                </span>
                <button
                  type="button"
                  className="mini-icon-button"
                  onClick={() =>
                    setCreatePanel(createPanel === "project" ? null : "project")
                  }
                  aria-label={ui.addProject}
                >
                  <FolderPlus aria-hidden="true" size={15} />
                </button>
              </div>
              <div
                className="project-list"
                onDragOver={(event) =>
                  handleTreeListDragOver(
                    "project",
                    displayProjects[displayProjects.length - 1]?.id,
                    event,
                  )
                }
                onDrop={(event) =>
                  void handleTreeListDrop(
                    "project",
                    displayProjects[displayProjects.length - 1]?.id,
                    event,
                  )
                }
              >
                {displayProjects.map((project) => {
                  const isRenaming =
                    renameTarget?.kind === "project" &&
                    renameTarget.id === project.id;
                  const canReorderProjects = displayProjects.length > 1;
                  const showDropPreviewBefore =
                    treeDropPreview?.kind === "project" &&
                    treeDropPreview.id === project.id &&
                    treeDropPreview.position === "before";
                  const showDropPreviewAfter =
                    treeDropPreview?.kind === "project" &&
                    treeDropPreview.id === project.id &&
                    treeDropPreview.position === "after";
                  const isDraggingProject =
                    draggedTreeTarget?.kind === "project" &&
                    draggedTreeTarget.id === project.id;

                  return (
                    <Fragment key={project.id}>
                      {showDropPreviewBefore
                        ? renderProjectDropPreview(project.id, "before")
                        : null}
                      <TreeRow
                        kind="project"
                        active={project.id === selectedProjectId}
                        count={themeCountByProject[project.id] ?? 0}
                        deleteLabel={ui.deleteProjectAria(project.name)}
                        icon={
                          project.id === selectedProjectId ? (
                            <FolderOpen aria-hidden="true" size={15} />
                          ) : (
                            <Folder aria-hidden="true" size={15} />
                          )
                        }
                        name={project.name}
                        hideDelete={Boolean(draggedTreeTarget)}
                        renaming={isRenaming}
                        renameValue={renameTarget?.value}
                        onClick={() => openProjectPath(project.id)}
                        onDelete={() => handleProjectDelete(project)}
                        onDoubleClick={() =>
                          startRename({
                            kind: "project",
                            id: project.id,
                            value: project.name,
                          })
                        }
                        onRenameCancel={cancelRename}
                        onRenameChange={updateRenameValue}
                        onRenameCommit={() => void commitRename()}
                        draggable={!isRenaming && canReorderProjects}
                        layoutHidden={isDraggingProject && treeDragSourceHidden}
                        onDragStart={(event) =>
                          handleTreeDragStart("project", project.id, event)
                        }
                        onDrag={(event) =>
                          handleTreeDrag("project", project.id, event)
                        }
                        onDragOver={(event) =>
                          handleTreeDragOver("project", project.id, event)
                        }
                        onDrop={(event) =>
                          void handleTreeDrop("project", project.id, event)
                        }
                        onDragEnd={handleTreeDragEnd}
                      />
                      {showDropPreviewAfter
                        ? renderProjectDropPreview(project.id, "after")
                        : null}
                    </Fragment>
                  );
                })}
              </div>
              {createPanel === "project" ? (
                <form
                  className="create-form create-panel"
                  onSubmit={handleProjectCreate}
                >
                  <div className="create-panel-header">
                    <span>{ui.newProject}</span>
                    <button
                      type="button"
                      className="mini-icon-button"
                      onClick={() => setCreatePanel(null)}
                      aria-label={ui.close}
                    >
                      <X aria-hidden="true" size={14} />
                    </button>
                  </div>
                  <label className="create-field">
                    <span>{ui.name}</span>
                    <input
                      value={newProjectName}
                      onChange={(event) =>
                        setNewProjectName(event.target.value)
                      }
                      placeholder={ui.projectNamePlaceholder}
                    />
                  </label>
                  <div className="create-actions">
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => setCreatePanel(null)}
                    >
                      {ui.cancel}
                    </button>
                    <button type="submit" className="primary-small-button">
                      {ui.add}
                    </button>
                  </div>
                </form>
              ) : null}
            </section>

            {selectedProject ? (
              <section className="sidebar-section">
                <div className="section-title">
                  <span className="section-title-label">
                    <ChevronDown aria-hidden="true" size={13} />
                    {ui.themesSection}
                    <small>{projectThemes.length}</small>
                  </span>
                  <button
                    type="button"
                    className="mini-icon-button"
                    onClick={() =>
                      setCreatePanel(createPanel === "theme" ? null : "theme")
                    }
                    aria-label={ui.addTheme}
                  >
                    <Plus aria-hidden="true" size={15} />
                  </button>
                </div>
                <div
                  className="theme-list"
                  onDragOver={(event) =>
                    handleTreeListDragOver(
                      "theme",
                      projectThemes[projectThemes.length - 1]?.id,
                      event,
                    )
                  }
                  onDrop={(event) =>
                    void handleTreeListDrop(
                      "theme",
                      projectThemes[projectThemes.length - 1]?.id,
                      event,
                    )
                  }
                >
                  {projectThemes.map((theme) => {
                    const isRenaming =
                      renameTarget?.kind === "theme" &&
                      renameTarget.id === theme.id;
                    const ThemeIcon =
                      theme.id === selectedThemeId ? FolderOpen : Folder;
                    const canReorderThemes = projectThemes.length > 1;
                    const showDropPreviewBefore =
                      treeDropPreview?.kind === "theme" &&
                      treeDropPreview.id === theme.id &&
                      treeDropPreview.position === "before";
                    const showDropPreviewAfter =
                      treeDropPreview?.kind === "theme" &&
                      treeDropPreview.id === theme.id &&
                      treeDropPreview.position === "after";
                    const isDraggingTheme =
                      draggedTreeTarget?.kind === "theme" &&
                      draggedTreeTarget.id === theme.id;

                    return (
                      <Fragment key={theme.id}>
                        {showDropPreviewBefore
                          ? renderThemeDropPreview(theme.id, "before")
                          : null}
                        <TreeRow
                          kind="theme"
                          active={theme.id === selectedThemeId}
                          count={topicCountByTheme[theme.id] ?? 0}
                          deleteLabel={ui.deleteThemeAria(theme.name)}
                          icon={
                            <ThemeIcon
                              aria-hidden="true"
                              className="theme-folder-icon"
                              size={15}
                              style={{ color: theme.color }}
                            />
                          }
                          name={theme.name}
                          hideDelete={Boolean(draggedTreeTarget)}
                          renaming={isRenaming}
                          renameValue={renameTarget?.value}
                          onClick={() => openThemePath(theme.id)}
                          onDelete={() => handleThemeDelete(theme)}
                          onDoubleClick={() =>
                            startRename({
                              kind: "theme",
                              id: theme.id,
                              value: theme.name,
                            })
                          }
                          onRenameCancel={cancelRename}
                          onRenameChange={updateRenameValue}
                          onRenameCommit={() => void commitRename()}
                          draggable={!isRenaming && canReorderThemes}
                          layoutHidden={isDraggingTheme && treeDragSourceHidden}
                          onDragStart={(event) =>
                            handleTreeDragStart("theme", theme.id, event)
                          }
                          onDrag={(event) =>
                            handleTreeDrag("theme", theme.id, event)
                          }
                          onDragOver={(event) =>
                            handleTreeDragOver("theme", theme.id, event)
                          }
                          onDrop={(event) =>
                            void handleTreeDrop("theme", theme.id, event)
                          }
                          onDragEnd={handleTreeDragEnd}
                        />
                        {showDropPreviewAfter
                          ? renderThemeDropPreview(theme.id, "after")
                          : null}
                      </Fragment>
                    );
                  })}
                </div>
                {createPanel === "theme" ? (
                  <form
                    className="create-form create-panel"
                    onSubmit={handleThemeCreate}
                  >
                    <div className="create-panel-header">
                      <span>{ui.newTheme}</span>
                      <button
                        type="button"
                        className="mini-icon-button"
                        onClick={() => setCreatePanel(null)}
                        aria-label={ui.close}
                      >
                        <X aria-hidden="true" size={14} />
                      </button>
                    </div>
                    <label className="create-field">
                      <span>{ui.name}</span>
                      <input
                        value={newThemeName}
                        onChange={(event) =>
                          setNewThemeName(event.target.value)
                        }
                        placeholder={ui.themeNamePlaceholder}
                      />
                    </label>
                    <div className="create-field">
                      <span>{ui.color}</span>
                      <div className="color-row">
                        {themeColors.map((color) => (
                          <button
                            key={color}
                            type="button"
                            className={`color-dot ${newThemeColor === color ? "selected" : ""}`}
                            style={{ backgroundColor: color }}
                            onClick={() => setNewThemeColor(color)}
                            aria-label={ui.colorAria(color)}
                          />
                        ))}
                      </div>
                    </div>
                    <div className="create-actions">
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => setCreatePanel(null)}
                      >
                        {ui.cancel}
                      </button>
                      <button type="submit" className="primary-small-button">
                        {ui.add}
                      </button>
                    </div>
                  </form>
                ) : null}
              </section>
            ) : null}

            {selectedTheme ? (
              <section className="sidebar-section topic-section">
                <div className="section-title">
                  <span className="section-title-label">
                    <ChevronDown aria-hidden="true" size={13} />
                    {ui.topicsSection}
                    <small>{themeTopics.length}</small>
                  </span>
                  <button
                    type="button"
                    className="mini-icon-button"
                    onClick={() =>
                      setCreatePanel(createPanel === "topic" ? null : "topic")
                    }
                    aria-label={ui.addTopic}
                  >
                    <Plus aria-hidden="true" size={15} />
                  </button>
                </div>
                <div
                  className="topic-list"
                  onDragOver={(event) =>
                    handleTreeListDragOver(
                      "topic",
                      themeTopics[themeTopics.length - 1]?.id,
                      event,
                    )
                  }
                  onDrop={(event) =>
                    void handleTreeListDrop(
                      "topic",
                      themeTopics[themeTopics.length - 1]?.id,
                      event,
                    )
                  }
                >
                  {themeTopics.map((topic) => {
                    const count = store.versions.filter(
                      (version) => version.topicId === topic.id,
                    ).length;
                    const isRenaming =
                      renameTarget?.kind === "topic" &&
                      renameTarget.id === topic.id;
                    const TopicIcon = getTopicIconComponent(getTopicKind(topic));
                    const canReorderTopics = themeTopics.length > 1;
                    const showDropPreviewBefore =
                      treeDropPreview?.kind === "topic" &&
                      treeDropPreview.id === topic.id &&
                      treeDropPreview.position === "before";
                    const showDropPreviewAfter =
                      treeDropPreview?.kind === "topic" &&
                      treeDropPreview.id === topic.id &&
                      treeDropPreview.position === "after";
                    const isDraggingTopic =
                      draggedTreeTarget?.kind === "topic" &&
                      draggedTreeTarget.id === topic.id;
                    return (
                      <Fragment key={topic.id}>
                        {showDropPreviewBefore
                          ? renderTopicDropPreview(topic.id, "before")
                          : null}
                          <TreeRow
                            kind="topic"
                            active={topic.id === selectedTopicId}
                          count={count}
                          deleteLabel={ui.deleteTopicAria(topic.title)}
                          icon={<TopicIcon aria-hidden="true" size={15} />}
                          name={topic.title}
                          hideDelete={Boolean(draggedTreeTarget)}
                          renaming={isRenaming}
                          renameValue={renameTarget?.value}
                          onClick={() => openTopicPath(topic.id)}
                          onDelete={() => handleTopicDelete(topic)}
                          onDoubleClick={() =>
                            startRename({
                              kind: "topic",
                              id: topic.id,
                              value: topic.title,
                            })
                          }
                          onRenameCancel={cancelRename}
                          onRenameChange={updateRenameValue}
                          onRenameCommit={() => void commitRename()}
                          draggable={!isRenaming && canReorderTopics}
                          layoutHidden={isDraggingTopic && treeDragSourceHidden}
                          onDragStart={(event) =>
                            handleTreeDragStart("topic", topic.id, event)
                          }
                          onDrag={(event) =>
                            handleTreeDrag("topic", topic.id, event)
                          }
                          onDragOver={(event) =>
                            handleTreeDragOver("topic", topic.id, event)
                          }
                          onDrop={(event) =>
                            void handleTreeDrop("topic", topic.id, event)
                          }
                          onDragEnd={handleTreeDragEnd}
                        />
                        {showDropPreviewAfter
                          ? renderTopicDropPreview(topic.id, "after")
                          : null}
                      </Fragment>
                    );
                  })}
                </div>
                {createPanel === "topic" ? (
                  <form
                    className="create-form create-panel"
                    onSubmit={handleTopicCreate}
                  >
                    <div className="create-panel-header">
                      <span>{ui.newTopic}</span>
                      <button
                        type="button"
                        className="mini-icon-button"
                        onClick={() => setCreatePanel(null)}
                        aria-label={ui.close}
                      >
                        <X aria-hidden="true" size={14} />
                      </button>
                    </div>
                    <div className="create-field">
                      <span>{ui.result}</span>
                      <div
                        className="result-type-control compact-kind-control"
                        aria-label={ui.topicKindAria}
                      >
                        <button
                          type="button"
                          className={`segment-button ${newTopicKind === "text" ? "active" : ""}`}
                          onClick={() => {
                            setNewTopicKind("text");
                            setNewTopicModelIds(defaultModelIdsByKind.text);
                          }}
                        >
                          <FileText aria-hidden="true" size={15} />
                          {ui.text}
                        </button>
                        <button
                          type="button"
                          className={`segment-button ${newTopicKind === "image" ? "active" : ""}`}
                          onClick={() => {
                            setNewTopicKind("image");
                            setNewTopicModelIds(defaultModelIdsByKind.image);
                          }}
                        >
                          <ImageIcon aria-hidden="true" size={15} />
                          {ui.image}
                        </button>
                        <button
                          type="button"
                          className={`segment-button ${newTopicKind === "audio" ? "active" : ""}`}
                          onClick={() => {
                            setNewTopicKind("audio");
                            setNewTopicModelIds(defaultModelIdsByKind.audio);
                          }}
                        >
                          <Mic aria-hidden="true" size={15} />
                          {ui.audio}
                        </button>
                        <button
                          type="button"
                          className={`segment-button ${newTopicKind === "video" ? "active" : ""}`}
                          onClick={() => {
                            setNewTopicKind("video");
                            setNewTopicModelIds(defaultModelIdsByKind.video);
                          }}
                        >
                          <Video aria-hidden="true" size={15} />
                          {ui.video}
                        </button>
                      </div>
                    </div>
                    <TagPopoverSelect
                      addLabel={ui.addModel}
                      emptyLabel={ui.noModelOptions}
                      label={ui.model}
                      options={getModelOptions(newTopicKind, customModels).map(
                        (option) => ({
                          description: [option.provider, option.memo]
                            .filter(Boolean)
                            .join(" · "),
                          displayLabel: getModelDisplayName(option.id),
                          group: ui.modelUse(option.kind),
                          id: option.selectionId,
                          label: option.label,
                        }),
                      )}
                      placeholder={ui.modelPickerPlaceholder}
                      removeLabel={ui.removeModelAria}
                      value={newTopicModelIds}
                      onChange={(value) =>
                        setNewTopicModelIds(value as TopicModelId[])
                      }
                    />
                    <label className="create-field">
                      <span>{ui.name}</span>
                      <input
                        value={newTopicTitle}
                        onChange={(event) =>
                          setNewTopicTitle(event.target.value)
                        }
                        placeholder={ui.topicNamePlaceholder}
                      />
                    </label>
                    <label className="create-field">
                      <span>{ui.memo}</span>
                      <textarea
                        value={newTopicBrief}
                        onChange={(event) =>
                          setNewTopicBrief(event.target.value)
                        }
                        placeholder={ui.topicMemoPlaceholder}
                        rows={3}
                      />
                    </label>
                    <div className="create-actions">
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => setCreatePanel(null)}
                      >
                        {ui.cancel}
                      </button>
                      <button type="submit" className="primary-small-button">
                        {ui.add}
                      </button>
                    </div>
                  </form>
                ) : null}
              </section>
            ) : null}
          </div>
        ) : sidebarView === "history" ? (
          historySidebar
        ) : (
          modelsSidebar
        )}
      </aside>

      <main className="workspace">
        {selectedTopic ? (
          <>
            <header className="workspace-header">
              <div>
                <div className="eyebrow">
                  <span
                    className="theme-folder-mark"
                    style={{ color: selectedTheme?.color }}
                  >
                    <Folder aria-hidden="true" size={14} />
                  </span>
                  {selectedProject?.name} / {selectedTheme?.name}
                </div>
                <h2>{selectedTopic.title}</h2>
                {selectedTopic.brief ? <p>{selectedTopic.brief}</p> : null}
              </div>
              <div className="workspace-actions">
                {isVersionView ? (
                  <button
                    type="button"
                    className="primary-button"
                    onClick={openCurrentDraft}
                  >
                    <FileText aria-hidden="true" size={15} />
                    {ui.currentDraft}
                  </button>
                ) : null}
                {editingVersion ? (
                  <button
                    type="button"
                    className="icon-button"
                    onClick={cancelVersionEdit}
                    aria-label={ui.cancelVersionEdit}
                    title={ui.cancelVersionEdit}
                  >
                    <X aria-hidden="true" size={18} strokeWidth={2.6} />
                  </button>
                ) : null}
                {isVersionView ? null : (
                  <button
                    type="button"
                    className="primary-button"
                    onClick={
                      editingVersion ? handleVersionEditSave : handleVersionSave
                    }
                    disabled={!canSaveCurrentVersion}
                  >
                    <Save aria-hidden="true" size={17} />
                    {editingVersion ? ui.saveVersionEdit : ui.saveVersion}
                  </button>
                )}
              </div>
            </header>

            <nav className="workspace-tabs" aria-label={ui.workspaceTabsAria}>
              <button
                type="button"
                className={mainView === "write" ? "active" : ""}
                onClick={() => setMainView("write")}
              >
                <FileText aria-hidden="true" size={15} />
                {ui.write}
              </button>
              <button
                type="button"
                className={mainView === "diff" ? "active" : ""}
                onClick={() => setMainView("diff")}
              >
                <Diff aria-hidden="true" size={15} />
                {ui.diff}
                <span className="tab-diff-summary">
                  <span className="added">+{addedCount}</span>
                  <span className="removed">-{removedCount}</span>
                </span>
              </button>
              <button
                type="button"
                className={mainView === "cost" ? "active" : ""}
                onClick={() => setMainView("cost")}
              >
                <ChartNoAxesColumnIncreasing aria-hidden="true" size={15} />
                {ui.costTab}
              </button>
            </nav>

            <div
              className={`main-view ${
                mainView === "diff"
                  ? "diff-view"
                  : mainView === "cost"
                    ? "cost-view"
                    : "write-view"
              }`}
            >
              {mainView === "write" ? (
                <WritePanel
                  audioGroupId={`write:${editingVersion?.id ?? selectedStoredVersion?.id ?? "draft"}`}
                  draftImages={writePanelImages}
                  draftLabel={writePanelLabel}
                  draftNotes={writePanelNotes}
                  draftResultTexts={writePanelResultTexts}
                  draftSystemPrompts={writePanelSystemPrompts}
                  draftUserPrompt={writePanelUserPrompt}
                  isVersionEdit={Boolean(editingVersion)}
                  isVersionView={isVersionView}
                  modelOptions={selectedTopicModelOptions}
                  pasteTargetActive={pasteTargetActive}
                  previousUserPrompt={getVersionUserPrompt(
                    editingVersion ?? latestVersion,
                  )}
                  selectedModelIds={editorModelIds}
                  selectedTopicKind={editorTopicKind}
                  ui={ui}
                  onAddDraftSystemPrompt={handleAddDraftSystemPrompt}
                  onDraftLabelChange={(value) => {
                    recordDraftHistorySnapshot();
                    setDraftLabel(value);
                    markEditorChanged();
                  }}
                  onDraftNotesChange={(value) => {
                    recordDraftHistorySnapshot();
                    setDraftNotes(value);
                    markEditorChanged();
                  }}
                  onAddDraftResultText={handleAddDraftResultText}
                  onDraftResultTextChange={handleDraftResultTextChange}
                  onDraftSystemPromptBodyChange={
                    handleDraftSystemPromptBodyChange
                  }
                  onDraftSystemPromptNameChange={
                    handleDraftSystemPromptNameChange
                  }
                  onDraftUserPromptChange={(value) => {
                    recordDraftHistorySnapshot();
                    setDraftUserPrompt(value);
                    markEditorChanged();
                  }}
                  onImageUpload={handleImageUpload}
                  onModelChange={(value) =>
                    void updateSelectedTopicModels(value)
                  }
                  onPasteTargetActiveChange={setPasteTargetActive}
                  onRemoveDraftImage={handleDraftImageDelete}
                  onRemoveDraftResultText={handleDraftResultTextDelete}
                  onRemoveDraftSystemPrompt={handleDraftSystemPromptDelete}
                  onReorderDraftImage={handleDraftImageReorder}
                  onReorderDraftResultText={handleDraftResultTextReorder}
                  onResetDraftResultTexts={resetDraftResultTexts}
                  onResetDraftSystemPrompts={resetDraftSystemPrompts}
                />
              ) : mainView === "diff" ? (
                <DiffPanel
                  addedCount={addedCount}
                  canCompareNext={canCompareStoredNext}
                  canComparePrevious={canCompareStoredPrevious}
                  canNavigateNextVersion={Boolean(nextNavigableVersionId)}
                  canNavigatePreviousVersion={Boolean(previousNavigableVersionId)}
                  compareBase={compareBase}
                  compareBaseImages={compareBaseImages}
                  compareDirection={effectiveCompareDirection}
                  compareTargetImages={compareTargetImages}
                  compareTargetKind={compareTargetKind}
                  compareTargetLabel={compareTargetLabel}
                  compareTargetVersion={compareTargetVersion}
                  removedCount={removedCount}
                  baseResultDiffCount={baseResultDiffCount}
                  baseResultDiffIndex={effectiveBaseResultDiffIndex}
                  resultTextDiffRows={resultTextDiffRows}
                  showCompareControls={Boolean(
                    selectedStoredVersion &&
                      (canCompareStoredPrevious || canCompareStoredNext),
                  )}
                  targetResultDiffCount={targetResultDiffCount}
                  targetResultDiffIndex={effectiveTargetResultDiffIndex}
                  systemPromptDiffBlocks={systemPromptDiffBlocks}
                  ui={ui}
                  userPromptDiffRows={userPromptDiffRows}
                  onBaseResultDiffIndexChange={setBaseResultDiffIndex}
                  onCompareDirectionChange={setCompareDirection}
                  onNavigateNextVersion={() =>
                    navigateDiffVersion(nextNavigableVersionId)
                  }
                  onNavigatePreviousVersion={() =>
                    navigateDiffVersion(previousNavigableVersionId)
                  }
                  onTargetResultDiffIndexChange={setTargetResultDiffIndex}
                  onToggleGoodResult={(version) => void toggleGoodResult(version)}
                />
              ) : (
                <CostTrendPanel
                  activeCostLabel={activeCostLabel}
                  currentMetrics={activeCostMetrics}
                  exchangeRate={usdKrwExchangeRate}
                  includeDraftInTopicUsage={canSaveDraft && !isVersionView}
                  locale={locale}
                  metricsByVersion={metricsByVersion}
                  themeCostSummary={themeCostSummary}
                  topicVersions={topicVersions}
                  ui={ui}
                />
              )}
            </div>
          </>
        ) : (
          <section className="empty-state">
            <Sparkles aria-hidden="true" size={24} />
            <h2>{emptyStateTitle}</h2>
          </section>
        )}
      </main>
      <Toast
        toast={toast}
        closeLabel={ui.closeToast}
        onClose={() => setToast(null)}
      />
      <ConfirmModal
        dialog={confirmDialog}
        busy={confirmBusy}
        busyLabel={ui.processing}
        closeLabel={ui.close}
        defaultCancelLabel={ui.cancel}
        defaultConfirmLabel={ui.confirm}
        onCancel={closeConfirm}
        onConfirm={confirmCurrentAction}
      />
    </div>
  );
}
