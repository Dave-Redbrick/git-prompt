import {
  ChangeEvent,
  ClipboardEvent as ReactClipboardEvent,
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  ChevronDown,
  CircleDot,
  ClipboardPaste,
  Diff,
  FileImage,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  GitBranch,
  ImageIcon,
  ImagePlus,
  Moon,
  PanelLeft,
  Plus,
  Save,
  Sparkles,
  Sun,
  Trash2,
  X,
} from "lucide-react";
import {
  ConfirmModal,
  type ConfirmDialogState,
} from "./components/ConfirmModal";
import { Toast, type ToastState, type ToastVariant } from "./components/Toast";
import {
  createId,
  deleteItem,
  getAll,
  nowIso,
  putItem,
  seedIfEmpty,
} from "./lib/db";
import { diffLines, type LineDiffRow } from "./lib/diff";
import { localeKey, messages, readLocale, type Locale } from "./i18n";
import type {
  DraftImage,
  ImageAsset,
  Project,
  PromptVersion,
  PromptVersionKind,
  Theme,
  Topic,
} from "./types";

const selectionKey = "prompt-reinforcer-selection";
const appearanceKey = "prompt-reinforcer-appearance";
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

type AppearanceTheme = "light" | "dark";
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

const readAppearanceTheme = (): AppearanceTheme => {
  try {
    return localStorage.getItem(appearanceKey) === "dark" ? "dark" : "light";
  } catch {
    return "light";
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

const getVersionKind = (version?: PromptVersion | null): PromptVersionKind =>
  version?.kind ?? "text";

const getTopicKind = (
  topic?: Topic | null,
  latestVersion?: PromptVersion | null,
): PromptVersionKind => topic?.kind ?? getVersionKind(latestVersion);

const getVersionResultText = (version?: PromptVersion | null) => {
  if (!version || getVersionKind(version) !== "text") {
    return "";
  }

  return version.resultText ?? version.body;
};

const getCommitMemo = (notes: string | undefined, fallback: string) =>
  notes?.trim() || fallback;

const copyImagesToDraft = (images: ImageAsset[]): DraftImage[] =>
  images.map((image) => ({
    id: createId(),
    sourceId: image.id,
    name: image.name,
    type: image.type,
    dataUrl: image.dataUrl,
  }));

const draftImagesMatchStoredImages = (
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

export function App() {
  const savedSelection = useMemo(readSelection, []);
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
  const [sidebarView, setSidebarView] = useState<"explorer" | "history">(
    "explorer",
  );
  const [mainView, setMainView] = useState<"write" | "diff">("write");
  const [createPanel, setCreatePanel] = useState<
    "project" | "theme" | "topic" | null
  >(null);
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null);

  const [newProjectName, setNewProjectName] = useState("");
  const [newThemeName, setNewThemeName] = useState("");
  const [newThemeColor, setNewThemeColor] = useState(themeColors[0]);
  const [newTopicTitle, setNewTopicTitle] = useState("");
  const [newTopicBrief, setNewTopicBrief] = useState("");
  const [newTopicKind, setNewTopicKind] = useState<PromptVersionKind>("text");

  const [draftKind, setDraftKind] = useState<PromptVersionKind>("text");
  const [draftLabel, setDraftLabel] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [draftResultText, setDraftResultText] = useState("");
  const [draftNotes, setDraftNotes] = useState("");
  const [draftImages, setDraftImages] = useState<DraftImage[]>([]);
  const [pasteTargetActive, setPasteTargetActive] = useState(false);
  const ui = messages[locale];

  const showToast = (message: string, variant: ToastVariant = "success") => {
    setToast({ id: Date.now(), message, variant });
  };

  const requestConfirm = (dialog: ConfirmDialogState) => {
    setConfirmDialog(dialog);
  };

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

    if (selectedThemeId && !selectedTheme) {
      setSelectedThemeId("");
      setSelectedTopicId("");
    }
  }, [loading, selectedProjectId, selectedTheme, selectedThemeId]);

  useEffect(() => {
    if (loading) {
      return;
    }

    if (!selectedThemeId) {
      setSelectedTopicId("");
      return;
    }

    if (selectedTopicId && !selectedTopic) {
      setSelectedTopicId("");
    }
  }, [loading, selectedThemeId, selectedTopic, selectedTopicId]);

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
  const compareBaseKind = selectedTopicKind;
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
  const hasDraftChanges =
    (latestVersion?.body ?? "") !== draftBody ||
    latestComparableResultText !== draftComparableResultText ||
    !draftImagesMatchStoredImages(
      comparableDraftImages,
      comparableLatestImages,
    );
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

  const handleRenameKeyDown = (
    event: ReactKeyboardEvent<HTMLInputElement>,
  ) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void commitRename();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      cancelRename();
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
      title,
      brief: newTopicBrief.trim(),
      createdAt,
      updatedAt: createdAt,
    });
    setNewTopicTitle("");
    setNewTopicBrief("");
    setNewTopicKind("text");
    setSelectedTopicId(id);
    setCreatePanel(null);
    showToast(ui.topicSaved);
    await refresh();
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

    const createdAt = nowIso();
    const versionId = createId();
    await putItem("versions", {
      id: versionId,
      topicId: selectedTopic.id,
      kind: selectedTopicKind,
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

  const historySidebar = selectedTopic ? (
    <section className="sidebar-history">
      <div className="graph-header">
        <div className="graph-title">
          <ChevronDown aria-hidden="true" size={13} />
          <span>GRAPH</span>
        </div>
      </div>
      <div className="git-graph" aria-label="Graph">
        {activeVersionId === "draft" && hasDraftChanges ? (
          <article className="graph-row draft active">
            <div className="graph-rail">
              <span className="graph-node open" />
              <span className="graph-line" />
            </div>
            <div className="graph-content">
              <div className="graph-line-row">
                <button
                  type="button"
                  className="graph-message"
                  onClick={() => {
                    setActiveVersionId("draft");
                    setMainView("diff");
                  }}
                >
                  {ui.draftMessage}
                </button>
                <span className="branch-pill">
                  <CircleDot aria-hidden="true" size={14} />
                  {ui.currentVersion}
                </span>
              </div>
              <div className="graph-subline">
                {draftNotes.trim() || ui.draftUnsavedChanges}
              </div>
            </div>
          </article>
        ) : null}
        {[...topicVersions]
          .reverse()
          .map((version, index, reversedVersions) => {
            const isActive = version.id === activeVersionId;
            const isLatest =
              index === 0 && !(activeVersionId === "draft" && hasDraftChanges);

            return (
              <article
                key={version.id}
                className={`graph-row ${isActive ? "active" : ""}`}
              >
                <div className="graph-rail">
                  <span
                    className={`graph-line top ${isLatest ? "hidden" : ""}`}
                  />
                  <span className="graph-node filled" />
                  <span
                    className={`graph-line bottom ${
                      index === reversedVersions.length - 1 ? "hidden" : ""
                    }`}
                  />
                </div>
                <div className="graph-content">
                  <div className="graph-line-row">
                    <button
                      type="button"
                      className="graph-message"
                      onClick={() => {
                        setActiveVersionId(version.id);
                        setMainView("diff");
                      }}
                    >
                      {version.label}
                    </button>
                    {isLatest ? (
                      <span className="branch-pill">
                        <CircleDot aria-hidden="true" size={14} />
                        {ui.currentVersion}
                      </span>
                    ) : null}
                  </div>
                  <div className="graph-subline">
                    <span>
                      {getCommitMemo(version.notes, ui.commitMemoFallback)}
                    </span>
                  </div>
                  <div className="graph-actions">
                    <button
                      type="button"
                      onClick={() => continueFromVersion(version)}
                    >
                      checkout
                    </button>
                    <button
                      type="button"
                      onClick={() => cherryPickVersion(version)}
                    >
                      cherry-pick
                    </button>
                    <button
                      type="button"
                      onClick={() => handleVersionDelete(version.id)}
                    >
                      delete
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        {topicVersions.length === 0 ? (
          <div className="empty-commit-log">{ui.emptyCommitLog}</div>
        ) : null}
      </div>
    </section>
  ) : (
    <section className="sidebar-history empty-sidebar-history">
      <GitBranch aria-hidden="true" size={18} />
      <span>{ui.selectTopic}</span>
    </section>
  );

  return (
    <div className="app-shell" data-theme={appearanceTheme}>
      <nav className="activity-bar" aria-label={ui.workViewAria}>
        <button
          type="button"
          className={sidebarView === "explorer" ? "active" : ""}
          onClick={() => setSidebarView("explorer")}
          aria-label="Explorer"
          title="Explorer"
        >
          <PanelLeft aria-hidden="true" size={19} />
        </button>
        <button
          type="button"
          className={sidebarView === "history" ? "active" : ""}
          onClick={() => setSidebarView("history")}
          aria-label="History"
          title="History"
        >
          <GitBranch aria-hidden="true" size={19} />
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
            <span className="sidebar-view-title">
              {sidebarView === "explorer" ? ui.explorer : "History"}
            </span>
            <strong>{ui.appName}</strong>
          </div>
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
                    <div
                      key={project.id}
                      className={`project-row ${project.id === selectedProjectId ? "active" : ""} ${isRenaming ? "renaming" : ""}`}
                    >
                      {isRenaming ? (
                        <div className="project-row-main row-main-editing">
                          {project.id === selectedProjectId ? (
                            <FolderOpen aria-hidden="true" size={15} />
                          ) : (
                            <Folder aria-hidden="true" size={15} />
                          )}
                          <input
                            className="rename-input"
                            value={renameTarget.value}
                            autoFocus
                            onChange={(event) =>
                              updateRenameValue(event.target.value)
                            }
                            onBlur={() => void commitRename()}
                            onKeyDown={handleRenameKeyDown}
                          />
                          <small className="tree-count">
                            {themeCountByProject[project.id] ?? 0}
                          </small>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="project-row-main"
                          onClick={() => {
                            setSelectedProjectId(project.id);
                            setSelectedThemeId("");
                            setSelectedTopicId("");
                            setCreatePanel(null);
                          }}
                          onDoubleClick={() =>
                            startRename({
                              kind: "project",
                              id: project.id,
                              value: project.name,
                            })
                          }
                        >
                          {project.id === selectedProjectId ? (
                            <FolderOpen aria-hidden="true" size={15} />
                          ) : (
                            <Folder aria-hidden="true" size={15} />
                          )}
                          <span>{project.name}</span>
                          <small className="tree-count">
                            {themeCountByProject[project.id] ?? 0}
                          </small>
                        </button>
                      )}
                      <button
                        type="button"
                        className="row-delete-button"
                        onClick={() => handleProjectDelete(project)}
                        aria-label={ui.deleteProjectAria(project.name)}
                      >
                        <Trash2 aria-hidden="true" size={14} />
                      </button>
                    </div>
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
                    <div
                      key={theme.id}
                      className={`theme-row ${theme.id === selectedThemeId ? "active" : ""} ${isRenaming ? "renaming" : ""}`}
                    >
                      {isRenaming ? (
                        <div className="theme-row-main row-main-editing">
                          <ThemeIcon
                            aria-hidden="true"
                            className="theme-folder-icon"
                            size={15}
                            style={{ color: theme.color }}
                          />
                          <input
                            className="rename-input"
                            value={renameTarget.value}
                            autoFocus
                            onChange={(event) =>
                              updateRenameValue(event.target.value)
                            }
                            onBlur={() => void commitRename()}
                            onKeyDown={handleRenameKeyDown}
                          />
                          <small className="tree-count">
                            {topicCountByTheme[theme.id] ?? 0}
                          </small>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="theme-row-main"
                          onClick={() => {
                            setSelectedThemeId(theme.id);
                            setSelectedTopicId("");
                            setCreatePanel(null);
                          }}
                          onDoubleClick={() =>
                            startRename({
                              kind: "theme",
                              id: theme.id,
                              value: theme.name,
                            })
                          }
                        >
                          <ThemeIcon
                            aria-hidden="true"
                            className="theme-folder-icon"
                            size={15}
                            style={{ color: theme.color }}
                          />
                          <span>{theme.name}</span>
                          <small className="tree-count">
                            {topicCountByTheme[theme.id] ?? 0}
                          </small>
                        </button>
                      )}
                      <button
                        type="button"
                        className="row-delete-button"
                        onClick={() => handleThemeDelete(theme)}
                        aria-label={ui.deleteThemeAria(theme.name)}
                      >
                        <Trash2 aria-hidden="true" size={14} />
                      </button>
                    </div>
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
                      onChange={(event) => setNewThemeName(event.target.value)}
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
                    <div
                      key={topic.id}
                      className={`topic-row ${topic.id === selectedTopicId ? "active" : ""} ${isRenaming ? "renaming" : ""}`}
                    >
                      {isRenaming ? (
                        <div className="topic-row-main row-main-editing">
                          <TopicIcon aria-hidden="true" size={15} />
                          <input
                            className="rename-input"
                            value={renameTarget.value}
                            autoFocus
                            onChange={(event) =>
                              updateRenameValue(event.target.value)
                            }
                            onBlur={() => void commitRename()}
                            onKeyDown={handleRenameKeyDown}
                          />
                          <small className="tree-count">{count}</small>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="topic-row-main"
                          onClick={() => {
                            setSelectedTopicId(topic.id);
                            setCreatePanel(null);
                          }}
                          onDoubleClick={() =>
                            startRename({
                              kind: "topic",
                              id: topic.id,
                              value: topic.title,
                            })
                          }
                        >
                          <TopicIcon aria-hidden="true" size={15} />
                          <span>{topic.title}</span>
                          <small className="tree-count">{count}</small>
                        </button>
                      )}
                      <button
                        type="button"
                        className="row-delete-button"
                        onClick={() => handleTopicDelete(topic)}
                        aria-label={ui.deleteTopicAria(topic.title)}
                      >
                        <Trash2 aria-hidden="true" size={14} />
                      </button>
                    </div>
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
                        onClick={() => setNewTopicKind("text")}
                      >
                        <FileText aria-hidden="true" size={15} />
                        {ui.text}
                      </button>
                      <button
                        type="button"
                        className={`segment-button ${newTopicKind === "image" ? "active" : ""}`}
                        onClick={() => setNewTopicKind("image")}
                      >
                        <ImageIcon aria-hidden="true" size={15} />
                        {ui.image}
                      </button>
                    </div>
                  </div>
                  <label className="create-field">
                    <span>{ui.name}</span>
                    <input
                      value={newTopicTitle}
                      onChange={(event) => setNewTopicTitle(event.target.value)}
                      placeholder={ui.topicNamePlaceholder}
                    />
                  </label>
                  <label className="create-field">
                    <span>{ui.memo}</span>
                    <textarea
                      value={newTopicBrief}
                      onChange={(event) => setNewTopicBrief(event.target.value)}
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
        ) : (
          historySidebar
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
                Diff
                <span className="tab-diff-summary">
                  +{addedCount} -{removedCount}
                </span>
              </button>
            </nav>

            <div className="main-view">
              {mainView === "write" ? (
                <section className="panel editor-panel">
                  <div className="panel-heading">
                    <h3>{ui.write}</h3>
                    <span>
                      {ui.promptChars(
                        draftBody.length.toLocaleString(),
                        selectedTopicKind === "text"
                          ? draftResultText.length.toLocaleString()
                          : undefined,
                      )}
                    </span>
                  </div>
                  <label>
                    {ui.versionName}
                    <input
                      value={draftLabel}
                      onChange={(event) => {
                        setDraftLabel(event.target.value);
                        setActiveVersionId("draft");
                      }}
                      placeholder={ui.versionNamePlaceholder}
                    />
                  </label>
                  <label className="editor-field">
                    {ui.prompt}
                    <textarea
                      value={draftBody}
                      onChange={(event) => {
                        setDraftBody(event.target.value);
                        setActiveVersionId("draft");
                      }}
                      placeholder={ui.promptPlaceholder}
                    />
                  </label>
                  {selectedTopicKind === "text" ? (
                    <label className="editor-field result-text-field">
                      {ui.resultText}
                      <textarea
                        value={draftResultText}
                        onChange={(event) => {
                          setDraftResultText(event.target.value);
                          setActiveVersionId("draft");
                        }}
                        placeholder={ui.resultTextPlaceholder}
                      />
                    </label>
                  ) : null}
                  <label>
                    {ui.notes}
                    <textarea
                      value={draftNotes}
                      onChange={(event) => {
                        setDraftNotes(event.target.value);
                        setActiveVersionId("draft");
                      }}
                      placeholder={ui.notesPlaceholder}
                      rows={3}
                    />
                  </label>

                  {selectedTopicKind === "image" ? (
                    <div className="image-result-section">
                      <div className="image-input-panel">
                        <div className="upload-row">
                          <label className="file-button">
                            <ImagePlus aria-hidden="true" size={17} />
                            {ui.resultImageUpload}
                            <input
                              type="file"
                              accept="image/*"
                              multiple
                              onChange={handleImageUpload}
                            />
                          </label>
                          <span>{ui.resultImageCount(draftImages.length)}</span>
                        </div>
                        <button
                          type="button"
                          className={`paste-target ${pasteTargetActive ? "active" : ""}`}
                          onClick={(event) => event.currentTarget.focus()}
                          onFocus={() => setPasteTargetActive(true)}
                          onBlur={() => setPasteTargetActive(false)}
                          onPaste={handleImagePaste}
                        >
                          <ClipboardPaste aria-hidden="true" size={18} />
                          <span>
                            <strong>{ui.pasteImage}</strong>
                            <small>{ui.pasteImageHint}</small>
                          </span>
                        </button>
                      </div>

                      {draftImages.length > 0 ? (
                        <div className="image-grid compact">
                          {draftImages.map((image) => (
                            <figure key={image.id} className="image-tile">
                              <img src={image.dataUrl} alt={image.name} />
                              <figcaption>
                                <span>{image.name}</span>
                                <button
                                  type="button"
                                  className="ghost-icon"
                                  onClick={() =>
                                    setDraftImages((current) =>
                                      current.filter(
                                        (item) => item.id !== image.id,
                                      ),
                                    )
                                  }
                                  aria-label={ui.deleteImageAria(image.name)}
                                >
                                  <Trash2 aria-hidden="true" size={14} />
                                </button>
                              </figcaption>
                            </figure>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </section>
              ) : (
                <section className="panel diff-panel">
                  <div className="diff-titlebar">
                    <div className="editor-tab active">
                      <Diff aria-hidden="true" size={15} />
                      {"prompt.diff"}
                    </div>
                    <div className="diff-summary">
                      <span className="added">+{addedCount}</span>
                      <span className="removed">-{removedCount}</span>
                    </div>
                  </div>
                  <div
                    className="split-diff"
                    aria-label={
                      compareTargetKind === "text"
                        ? ui.promptDiffAria
                        : ui.imageDiffAria
                    }
                  >
                    <DiffFile
                      side="left"
                      title={compareBase?.label ?? ui.noPreviousVersion}
                      kind={compareBase ? compareBaseKind : null}
                      rows={lineDiffRows}
                      emptyLabel={ui.emptyContent}
                      imageLabel={ui.imageKind}
                      textLabel={ui.textKind}
                    />
                    <DiffFile
                      side="right"
                      title={compareTargetLabel}
                      kind={compareTargetKind}
                      rows={lineDiffRows}
                      emptyLabel={ui.emptyContent}
                      imageLabel={ui.imageKind}
                      textLabel={ui.textKind}
                    />
                  </div>

                  {compareTargetKind === "image" ? (
                    <div className="asset-diff-panel">
                      <div className="asset-diff-title">
                        <FileImage aria-hidden="true" size={15} />
                        {ui.resultImage}
                      </div>
                      <div className="image-compare">
                        <ImageColumn
                          title={ui.resultImagePrevious}
                          images={compareBaseImages}
                          emptyLabel={ui.emptyImage}
                        />
                        <ImageColumn
                          title={ui.resultImageCurrent}
                          images={compareTargetImages}
                          emptyLabel={ui.emptyImage}
                        />
                      </div>
                    </div>
                  ) : null}
                </section>
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

type ImageColumnProps = {
  title: string;
  images: Array<ImageAsset | DraftImage>;
  emptyLabel: string;
};

function KindBadge({
  kind,
  imageLabel,
  textLabel,
}: {
  kind: PromptVersionKind;
  imageLabel: string;
  textLabel: string;
}) {
  return (
    <span className={`kind-badge ${kind}`}>
      {kind === "image" ? imageLabel : textLabel}
    </span>
  );
}

type DiffFileProps = {
  side: "left" | "right";
  title: string;
  kind: PromptVersionKind | null;
  rows: LineDiffRow[];
  emptyLabel: string;
  imageLabel: string;
  textLabel: string;
};

function DiffFile({
  side,
  title,
  kind,
  rows,
  emptyLabel,
  imageLabel,
  textLabel,
}: DiffFileProps) {
  const isLeft = side === "left";

  return (
    <div className="diff-file">
      <div className="diff-file-header">
        <span>{title}</span>
        {kind ? (
          <KindBadge
            kind={kind}
            imageLabel={imageLabel}
            textLabel={textLabel}
          />
        ) : null}
      </div>
      <div className="code-lines">
        {rows.length > 0 ? (
          rows.map((row) => {
            const visible =
              row.type === "same" ||
              (isLeft && row.type === "removed") ||
              (!isLeft && row.type === "added");
            const lineNumber = isLeft
              ? row.leftLineNumber
              : row.rightLineNumber;
            const text = isLeft ? row.leftText : row.rightText;
            const marker =
              row.type === "same" || !visible ? "" : isLeft ? "-" : "+";

            return (
              <div
                key={`${side}-${row.id}`}
                className={`code-line ${visible ? row.type : "empty"}`}
              >
                <span className="line-number">{lineNumber ?? ""}</span>
                <span className="change-marker">{marker}</span>
                <code>{visible ? text || " " : ""}</code>
              </div>
            );
          })
        ) : (
          <div className="code-line empty-message">
            <span className="line-number" />
            <span className="change-marker" />
            <code>{emptyLabel}</code>
          </div>
        )}
      </div>
    </div>
  );
}

function ImageColumn({ title, images, emptyLabel }: ImageColumnProps) {
  return (
    <div className="image-column">
      <div className="image-column-title">
        <FileImage aria-hidden="true" size={15} />
        <span>{title}</span>
      </div>
      {images.length > 0 ? (
        <div className="image-grid">
          {images.map((image) => (
            <figure key={image.id} className="image-tile">
              <img src={image.dataUrl} alt={image.name} />
              <figcaption>{image.name}</figcaption>
            </figure>
          ))}
        </div>
      ) : (
        <div className="empty-image">{emptyLabel}</div>
      )}
    </div>
  );
}
