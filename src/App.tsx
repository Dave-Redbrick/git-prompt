import {
  ChangeEvent,
  ClipboardEvent as ReactClipboardEvent,
  FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
import { CostTrendPanel } from "./components/CostTrendPanel";
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
  resolveTopicModelIds,
} from "./lib/costEstimator";
import { diffLines } from "./lib/diff";
import { useUsdKrwExchangeRate } from "./lib/exchangeRate";
import {
  copyImagesToDraft,
  draftImagesMatchStoredImages,
  getTopicKind,
  getVersionKind,
  getVersionResultText,
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
  PromptVersion,
  PromptVersionKind,
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
type SidebarView = "explorer" | "history" | "models";
type RenameTarget = {
  kind: "project" | "theme" | "topic";
  id: string;
  value: string;
};

type StoreState = {
  projects: Project[];
  themes: Theme[];
  topics: Topic[];
  versions: PromptVersion[];
  images: ImageAsset[];
};

const emptyStoreState: StoreState = {
  projects: [],
  themes: [],
  topics: [],
  versions: [],
  images: [],
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
  value === "text" || value === "image";

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

const fileToDraftImage = (
  file: File,
  fallbackName = "clipboard-image.png",
): Promise<DraftImage> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      resolve({
        id: createId(),
        name: file.name || fallbackName,
        type: file.type,
        dataUrl: String(reader.result),
      });
    };
    reader.readAsDataURL(file);
  });

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

export function App() {
  const savedSelection = useMemo(readSelection, []);
  const projectImportInputRef = useRef<HTMLInputElement>(null);
  const customModelImportInputRef = useRef<HTMLInputElement>(null);
  const customModelProviderPickerRef = useRef<HTMLDivElement>(null);
  const [folderState, setFolderState] = useState<FolderState>(readFolderState);
  const [appearanceTheme, setAppearanceTheme] =
    useState<AppearanceTheme>(readAppearanceTheme);
  const [locale, setLocale] = useState<Locale>(readLocale);
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
  const [createPanel, setCreatePanel] = useState<
    "project" | "theme" | "topic" | null
  >(null);
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null);
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
  const [draftResultText, setDraftResultText] = useState("");
  const [draftNotes, setDraftNotes] = useState("");
  const [draftImages, setDraftImages] = useState<DraftImage[]>([]);
  const [pasteTargetActive, setPasteTargetActive] = useState(false);
  const ui = messages[locale];
  const usdKrwExchangeRate = useUsdKrwExchangeRate(locale === "ko");

  const showToast = (message: string, variant: ToastVariant = "success") => {
    setToast({ id: Date.now(), message, variant });
  };

  const requestConfirm = (dialog: ConfirmDialogState) => {
    setConfirmDialog(dialog);
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
    const [projects, themes, topics, versions, images] = await Promise.all([
      getAll("projects"),
      getAll("themes"),
      getAll("topics"),
      getAll("versions"),
      getAll("images"),
    ]);

    setStore({
      projects: projects.sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      themes: themes.sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      topics: topics.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      versions: versions.sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      images,
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

  const selectedProject = store.projects.find(
    (project) => project.id === selectedProjectId,
  );
  const projectThemes = store.themes.filter(
    (theme) => theme.projectId === selectedProjectId,
  );
  const selectedTheme = projectThemes.find(
    (theme) => theme.id === selectedThemeId,
  );
  const themeTopics = store.topics.filter(
    (topic) =>
      topic.projectId === selectedProjectId &&
      topic.themeId === selectedThemeId,
  );
  const selectedTopic = themeTopics.find(
    (topic) => topic.id === selectedTopicId,
  );
  const topicVersions = store.versions.filter(
    (version) => version.topicId === selectedTopicId,
  );
  const latestVersion = topicVersions[topicVersions.length - 1] ?? null;
  const selectedTopicKind = getTopicKind(selectedTopic, latestVersion);

  const imagesByVersion = useMemo(() => {
    return store.images.reduce<Record<string, ImageAsset[]>>((acc, image) => {
      acc[image.versionId] = [...(acc[image.versionId] ?? []), image];
      return acc;
    }, {});
  }, [store.images]);

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
        imageCount: selectedTopicKind === "image" ? draftImages.length : 0,
        imagesByVersion,
        kind: selectedTopicKind,
        modelConfigs: customModels,
        modelIds: selectedTopicModelIds,
        previousVersion: latestVersion,
        resultText: draftResultText,
      }),
    [
      draftBody,
      draftImages.length,
      draftResultText,
      imagesByVersion,
      latestVersion,
      customModels,
      selectedTopicKind,
      selectedTopicModelIds,
    ],
  );

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
    const topics = source.topics.filter(
      (topic) => topic.projectId === projectId && topic.themeId === themeId,
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
    const themes = source.themes.filter(
      (theme) => theme.projectId === projectId,
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

  const openProjectPath = (projectId: string) => {
    const { themeId, topicId } = getOpenPathForProject(projectId);
    setSelectedProjectId(projectId);
    setSelectedThemeId(themeId);
    setSelectedTopicId(topicId);
    setCreatePanel(null);
  };

  const openThemePath = (themeId: string) => {
    setSelectedThemeId(themeId);
    setSelectedTopicId(getOpenTopicIdForTheme(selectedProjectId, themeId));
    setCreatePanel(null);
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
      setDraftResultText("");
      setDraftNotes("");
      setDraftImages([]);
      setActiveVersionId("draft");
      setMainView("write");
      return;
    }

    setDraftLabel(
      latestVersion ? `v${topicVersions.length + 1}` : ui.draftLabel,
    );
    setDraftKind(selectedTopicKind);
    setDraftBody(latestVersion?.body ?? "");
    setDraftResultText(getVersionResultText(latestVersion));
    setDraftNotes("");
    setDraftImages(
      latestVersion && getVersionKind(latestVersion) === "image"
        ? copyImagesToDraft(imagesByVersion[latestVersion.id] ?? [])
        : [],
    );
    setActiveVersionId("draft");
    setMainView("write");
  }, [loading, selectedTopicId, selectedTopicKind]);

  const selectedStoredVersion =
    activeVersionId === "draft"
      ? null
      : (topicVersions.find((version) => version.id === activeVersionId) ??
        null);
  const selectedStoredIndex = selectedStoredVersion
    ? topicVersions.findIndex(
        (version) => version.id === selectedStoredVersion.id,
      )
    : -1;
  const compareBase =
    selectedStoredVersion && selectedStoredIndex > 0
      ? topicVersions[selectedStoredIndex - 1]
      : activeVersionId === "draft"
        ? latestVersion
        : null;
  const compareTargetKind = selectedTopicKind;
  const compareBaseText =
    compareTargetKind === "text"
      ? getVersionResultText(compareBase)
      : (compareBase?.body ?? "");
  const compareTargetText =
    compareTargetKind === "text"
      ? selectedStoredVersion
        ? getVersionResultText(selectedStoredVersion)
        : draftResultText
      : (selectedStoredVersion?.body ?? draftBody);
  const compareTargetLabel = selectedStoredVersion?.label ?? ui.draftMessage;
  const compareBaseImages = compareBase
    ? (imagesByVersion[compareBase.id] ?? [])
    : [];
  const compareTargetImages = selectedStoredVersion
    ? (imagesByVersion[selectedStoredVersion.id] ?? [])
    : draftImages;
  const latestImages = latestVersion
    ? (imagesByVersion[latestVersion.id] ?? [])
    : [];
  const comparableLatestImages =
    getVersionKind(latestVersion) === "image" ? latestImages : [];
  const comparableDraftImages =
    selectedTopicKind === "image" ? draftImages : [];
  const lineDiffRows = useMemo(
    () => diffLines(compareBaseText, compareTargetText),
    [compareBaseText, compareTargetText],
  );
  const addedCount = lineDiffRows.filter((row) => row.type === "added").length;
  const removedCount = lineDiffRows.filter(
    (row) => row.type === "removed",
  ).length;
  const latestComparableResultText =
    selectedTopicKind === "text" ? getVersionResultText(latestVersion) : "";
  const draftComparableResultText =
    selectedTopicKind === "text" ? draftResultText : "";
  const hasDraftModelChanges =
    currentDraftCostMetrics.modelAddedIds.length > 0 ||
    currentDraftCostMetrics.modelRemovedIds.length > 0;
  const hasDraftChanges =
    (latestVersion?.body ?? "") !== draftBody ||
    latestComparableResultText !== draftComparableResultText ||
    !draftImagesMatchStoredImages(
      comparableDraftImages,
      comparableLatestImages,
    ) ||
    hasDraftModelChanges;
  const canSaveDraft =
    hasDraftChanges &&
    draftBody.trim().length > 0 &&
    (selectedTopicKind === "image" || draftResultText.trim().length > 0);

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
        store,
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
      deleteItem("topics", topic.id),
    ]);

    if (topic.id === selectedTopicId) {
      setSelectedTopicId("");
    }
    setCreatePanel(null);
    showToast(ui.topicDeleted);
    await refresh();
  };

  const handleImageUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (!files.length) {
      return;
    }

    const loadedImages = await Promise.all(
      files.map((file) => fileToDraftImage(file)),
    );
    setDraftImages((current) => [...current, ...loadedImages]);
    setActiveVersionId("draft");
    event.target.value = "";
  };

  const handleImagePaste = async (
    event: ReactClipboardEvent<HTMLButtonElement>,
  ) => {
    if (!selectedTopicId) {
      return;
    }

    const files = getCurrentClipboardImageFiles(event.clipboardData);
    if (files.length === 0) {
      showToast(ui.noClipboardImage, "error");
      return;
    }

    event.preventDefault();
    const pastedAt = new Date();
    const timeLabel = `${pastedAt.getHours()}${pastedAt.getMinutes()}${pastedAt.getSeconds()}`;
    const images = await Promise.all(
      files.map((file, index) =>
        fileToDraftImage(file, `clipboard-${timeLabel}-${index + 1}.png`),
      ),
    );

    setDraftImages((current) => [...current, ...images]);
    setActiveVersionId("draft");
    showToast(ui.imagesPasted);
  };

  const handleVersionSave = async () => {
    if (!selectedTopic) {
      return;
    }

    const body = draftBody.trim();
    if (!body) {
      showToast(ui.promptEmpty, "error");
      return;
    }

    const resultText = draftResultText.trim();
    if (selectedTopicKind === "text" && !resultText) {
      showToast(ui.enterPromptResult, "error");
      return;
    }

    const snapshotMetrics = estimateDraftCostMetrics({
      body,
      imageCount: selectedTopicKind === "image" ? draftImages.length : 0,
      imagesByVersion,
      kind: selectedTopicKind,
      modelConfigs: customModels,
      modelIds: selectedTopicModelIds,
      previousVersion: latestVersion,
      resultText,
    });
    const createdAt = nowIso();
    const versionId = createId();
    await putItem("versions", {
      id: versionId,
      topicId: selectedTopic.id,
      kind: selectedTopicKind,
      modelIds: selectedTopicModelIds,
      costSnapshot: createCostSnapshot(snapshotMetrics),
      label: draftLabel.trim() || `v${topicVersions.length + 1}`,
      body,
      resultText: selectedTopicKind === "text" ? resultText : "",
      notes: draftNotes.trim(),
      createdAt,
    });

    const imagesToSave = selectedTopicKind === "image" ? draftImages : [];
    await Promise.all(
      imagesToSave.map((image) => {
        const { id, name, type, dataUrl } = image;
        return putItem("images", {
          id,
          name,
          type,
          dataUrl,
          topicId: selectedTopic.id,
          versionId,
          createdAt,
        });
      }),
    );

    await putItem("topics", {
      ...selectedTopic,
      kind: selectedTopicKind,
      modelIds: selectedTopicModelIds,
      updatedAt: createdAt,
    });

    await refresh();
    setDraftLabel(`v${topicVersions.length + 2}`);
    setDraftKind(selectedTopicKind);
    setDraftBody(body);
    setDraftResultText(selectedTopicKind === "text" ? resultText : "");
    setDraftNotes("");
    setDraftImages(
      imagesToSave.map((image) => ({
        ...image,
        sourceId: image.id,
        id: createId(),
      })),
    );
    setActiveVersionId(versionId);
    showToast(ui.versionSaved);
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
    setDraftLabel(
      remainingLatest ? `v${remainingVersions.length + 1}` : ui.draftLabel,
    );
    setDraftKind(getTopicKind(selectedTopic, remainingLatest));
    setDraftBody(remainingLatest?.body ?? "");
    setDraftResultText(getVersionResultText(remainingLatest));
    setDraftNotes("");
    setDraftImages(
      remainingLatest && getVersionKind(remainingLatest) === "image"
        ? copyImagesToDraft(imagesByVersion[remainingLatest.id] ?? [])
        : [],
    );
    await refresh();
    setActiveVersionId("draft");
    showToast(ui.versionDeleted);
  };

  const continueFromVersion = (version: PromptVersion) => {
    setDraftLabel(`v${topicVersions.length + 1}`);
    setDraftKind(selectedTopicKind);
    setDraftBody(version.body);
    setDraftResultText(getVersionResultText(version));
    setDraftNotes("");
    setDraftImages(
      getVersionKind(version) === "image"
        ? copyImagesToDraft(imagesByVersion[version.id] ?? [])
        : [],
    );
    if (version.modelIds?.length) {
      void updateSelectedTopicModels(version.modelIds);
    }
    setActiveVersionId("draft");
    setMainView("write");
  };

  const cherryPickVersion = (version: PromptVersion) => {
    setDraftKind(selectedTopicKind);
    setDraftBody(version.body);
    setDraftResultText(getVersionResultText(version));
    setDraftNotes(`cherry-pick: ${version.label}`);
    setDraftImages(
      getVersionKind(version) === "image"
        ? copyImagesToDraft(imagesByVersion[version.id] ?? [])
        : [],
    );
    if (version.modelIds?.length) {
      void updateSelectedTopicModels(version.modelIds);
    }
    setActiveVersionId("draft");
    setMainView("write");
    showToast(ui.cherryPickApplied(version.label));
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
    ? getModelOptions(selectedTopicKind, customModels).map((option) => ({
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
        hasDraftChanges={hasDraftChanges}
        selectedTopic={selectedTopic ?? null}
        topicVersions={topicVersions}
        locale={locale}
        metricsByVersion={metricsByVersion}
        ui={ui}
        usdKrwRate={usdKrwExchangeRate?.rate ?? null}
        onCheckout={continueFromVersion}
        onCherryPick={cherryPickVersion}
        onDelete={handleVersionDelete}
        onOpenDraftDiff={() => {
          setActiveVersionId("draft");
          setMainView("diff");
        }}
        onOpenVersionDiff={(versionId) => {
          setActiveVersionId(versionId);
          setMainView("diff");
        }}
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

  return (
    <div className="app-shell" data-theme={appearanceTheme}>
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
                  <small>{store.projects.length}</small>
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
              <div className="project-list">
                {store.projects.map((project) => {
                  const isRenaming =
                    renameTarget?.kind === "project" &&
                    renameTarget.id === project.id;

                  return (
                    <TreeRow
                      key={project.id}
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
                    />
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
                <div className="theme-list">
                  {projectThemes.map((theme) => {
                    const isRenaming =
                      renameTarget?.kind === "theme" &&
                      renameTarget.id === theme.id;
                    const ThemeIcon =
                      theme.id === selectedThemeId ? FolderOpen : Folder;

                    return (
                      <TreeRow
                        key={theme.id}
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
                      />
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
                <div className="topic-list">
                  {themeTopics.map((topic) => {
                    const count = store.versions.filter(
                      (version) => version.topicId === topic.id,
                    ).length;
                    const isRenaming =
                      renameTarget?.kind === "topic" &&
                      renameTarget.id === topic.id;
                    const TopicIcon =
                      getTopicKind(topic) === "image" ? FileImage : FileText;
                    return (
                      <TreeRow
                        key={topic.id}
                        kind="topic"
                        active={topic.id === selectedTopicId}
                        count={count}
                        deleteLabel={ui.deleteTopicAria(topic.title)}
                        icon={<TopicIcon aria-hidden="true" size={15} />}
                        name={topic.title}
                        renaming={isRenaming}
                        renameValue={renameTarget?.value}
                        onClick={() => {
                          setSelectedTopicId(topic.id);
                          setCreatePanel(null);
                        }}
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
                      />
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
              <button
                type="button"
                className="primary-button"
                onClick={handleVersionSave}
                disabled={!canSaveDraft}
              >
                <Save aria-hidden="true" size={17} />
                {ui.saveVersion}
              </button>
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
                  draftBody={draftBody}
                  draftImages={draftImages}
                  draftLabel={draftLabel}
                  draftNotes={draftNotes}
                  draftResultText={draftResultText}
                  modelOptions={selectedTopicModelOptions}
                  pasteTargetActive={pasteTargetActive}
                  previousBody={latestVersion?.body ?? ""}
                  previousResultText={getVersionResultText(latestVersion)}
                  selectedModelIds={selectedTopicModelIds}
                  selectedTopicKind={selectedTopicKind}
                  ui={ui}
                  onDraftBodyChange={(value) => {
                    setDraftBody(value);
                    setActiveVersionId("draft");
                  }}
                  onDraftLabelChange={(value) => {
                    setDraftLabel(value);
                    setActiveVersionId("draft");
                  }}
                  onDraftNotesChange={(value) => {
                    setDraftNotes(value);
                    setActiveVersionId("draft");
                  }}
                  onDraftResultTextChange={(value) => {
                    setDraftResultText(value);
                    setActiveVersionId("draft");
                  }}
                  onImagePaste={handleImagePaste}
                  onImageUpload={handleImageUpload}
                  onModelChange={(value) =>
                    void updateSelectedTopicModels(value)
                  }
                  onPasteTargetActiveChange={setPasteTargetActive}
                  onRemoveDraftImage={(imageId) =>
                    setDraftImages((current) =>
                      current.filter((item) => item.id !== imageId),
                    )
                  }
                />
              ) : mainView === "diff" ? (
                <DiffPanel
                  addedCount={addedCount}
                  compareBase={compareBase}
                  compareBaseImages={compareBaseImages}
                  compareTargetImages={compareTargetImages}
                  compareTargetKind={compareTargetKind}
                  compareTargetLabel={compareTargetLabel}
                  lineDiffRows={lineDiffRows}
                  removedCount={removedCount}
                  ui={ui}
                />
              ) : (
                <CostTrendPanel
                  currentMetrics={currentDraftCostMetrics}
                  exchangeRate={usdKrwExchangeRate}
                  locale={locale}
                  metricsByVersion={metricsByVersion}
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
