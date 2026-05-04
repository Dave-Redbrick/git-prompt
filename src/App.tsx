import {
  ChangeEvent,
  ClipboardEvent as ReactClipboardEvent,
  FormEvent,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  ClipboardPaste,
  Clock3,
  Diff,
  FileImage,
  FileText,
  FolderPlus,
  ImageIcon,
  ImagePlus,
  Layers3,
  PanelLeft,
  Plus,
  Save,
  Sparkles,
  Trash2,
} from "lucide-react";
import { createId, deleteItem, getAll, nowIso, putItem, seedIfEmpty } from "./lib/db";
import { diffLines, type LineDiffRow } from "./lib/diff";
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
const themeColors = ["#2563eb", "#0f766e", "#ca8a04", "#dc2626", "#7c3aed", "#475569"];

type Selection = {
  projectId: string;
  themeId: string;
  topicId: string;
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

const formatDateTime = (value: string) =>
  new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

const readSelection = (): Selection => {
  try {
    return JSON.parse(localStorage.getItem(selectionKey) ?? "{}") as Selection;
  } catch {
    return { projectId: "", themeId: "", topicId: "" };
  }
};

const fileToDraftImage = (file: File, fallbackName = "clipboard-image.png"): Promise<DraftImage> =>
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

const getTopicKind = (topic?: Topic | null, latestVersion?: PromptVersion | null): PromptVersionKind =>
  topic?.kind ?? getVersionKind(latestVersion);

const getVersionResultText = (version?: PromptVersion | null) => {
  if (!version || getVersionKind(version) !== "text") {
    return "";
  }

  return version.resultText ?? version.body;
};

const copyImagesToDraft = (images: ImageAsset[]): DraftImage[] =>
  images.map((image) => ({
    id: createId(),
    sourceId: image.id,
    name: image.name,
    type: image.type,
    dataUrl: image.dataUrl,
  }));

const draftImagesMatchStoredImages = (draftImages: DraftImage[], storedImages: ImageAsset[]) => {
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
  const [store, setStore] = useState<StoreState>(emptyStoreState);
  const [selectedProjectId, setSelectedProjectId] = useState(savedSelection.projectId);
  const [selectedThemeId, setSelectedThemeId] = useState(savedSelection.themeId);
  const [selectedTopicId, setSelectedTopicId] = useState(savedSelection.topicId);
  const [activeVersionId, setActiveVersionId] = useState("draft");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [createPanel, setCreatePanel] = useState<"project" | "theme" | "topic" | null>(null);

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

  const loadData = async (seedInitialData = false) => {
    setError("");
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
          setError(loadError instanceof Error ? loadError.message : "IndexedDB를 열 수 없습니다.");
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

  const selectedProject = store.projects.find((project) => project.id === selectedProjectId);
  const projectThemes = store.themes.filter((theme) => theme.projectId === selectedProjectId);
  const selectedTheme = projectThemes.find((theme) => theme.id === selectedThemeId);
  const themeTopics = store.topics.filter(
    (topic) => topic.projectId === selectedProjectId && topic.themeId === selectedThemeId,
  );
  const selectedTopic = themeTopics.find((topic) => topic.id === selectedTopicId);
  const topicVersions = store.versions.filter((version) => version.topicId === selectedTopicId);
  const latestVersion = topicVersions[topicVersions.length - 1] ?? null;
  const selectedTopicKind = getTopicKind(selectedTopic, latestVersion);

  const imagesByVersion = useMemo(() => {
    return store.images.reduce<Record<string, ImageAsset[]>>((acc, image) => {
      acc[image.versionId] = [...(acc[image.versionId] ?? []), image];
      return acc;
    }, {});
  }, [store.images]);

  useEffect(() => {
    if (!store.projects.length) {
      setSelectedProjectId("");
      return;
    }

    if (!selectedProject) {
      setSelectedProjectId(store.projects[0].id);
    }
  }, [selectedProject, store.projects]);

  useEffect(() => {
    if (!selectedProjectId) {
      setSelectedThemeId("");
      setSelectedTopicId("");
      return;
    }

    if (!selectedTheme && projectThemes.length > 0) {
      setSelectedThemeId(projectThemes[0].id);
      return;
    }

    if (projectThemes.length === 0) {
      setSelectedThemeId("");
      setSelectedTopicId("");
    }
  }, [projectThemes, selectedProjectId, selectedTheme]);

  useEffect(() => {
    if (!selectedThemeId) {
      setSelectedTopicId("");
      return;
    }

    if (!selectedTopic && themeTopics.length > 0) {
      setSelectedTopicId(themeTopics[0].id);
      return;
    }

    if (themeTopics.length === 0) {
      setSelectedTopicId("");
    }
  }, [selectedThemeId, selectedTopic, themeTopics]);

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
      return;
    }

    setDraftLabel(latestVersion ? `v${topicVersions.length + 1}` : "초안");
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
  }, [loading, selectedTopicId, selectedTopicKind]);

  const selectedStoredVersion =
    activeVersionId === "draft"
      ? null
      : topicVersions.find((version) => version.id === activeVersionId) ?? null;
  const selectedStoredIndex = selectedStoredVersion
    ? topicVersions.findIndex((version) => version.id === selectedStoredVersion.id)
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
      : compareBase?.body ?? "";
  const compareTargetText =
    compareTargetKind === "text"
      ? selectedStoredVersion
        ? getVersionResultText(selectedStoredVersion)
        : draftResultText
      : selectedStoredVersion?.body ?? draftBody;
  const compareTargetLabel = selectedStoredVersion?.label ?? "작성 중";
  const compareBaseImages = compareBase ? imagesByVersion[compareBase.id] ?? [] : [];
  const compareTargetImages = selectedStoredVersion
    ? imagesByVersion[selectedStoredVersion.id] ?? []
    : draftImages;
  const latestImages = latestVersion ? imagesByVersion[latestVersion.id] ?? [] : [];
  const comparableLatestImages = getVersionKind(latestVersion) === "image" ? latestImages : [];
  const comparableDraftImages = selectedTopicKind === "image" ? draftImages : [];
  const lineDiffRows = useMemo(
    () => diffLines(compareBaseText, compareTargetText),
    [compareBaseText, compareTargetText],
  );
  const addedCount = lineDiffRows.filter((row) => row.type === "added").length;
  const removedCount = lineDiffRows.filter((row) => row.type === "removed").length;
  const latestComparableResultText =
    selectedTopicKind === "text" ? getVersionResultText(latestVersion) : "";
  const draftComparableResultText = selectedTopicKind === "text" ? draftResultText : "";
  const hasDraftChanges =
    (latestVersion?.body ?? "") !== draftBody ||
    latestComparableResultText !== draftComparableResultText ||
    !draftImagesMatchStoredImages(comparableDraftImages, comparableLatestImages);
  const canSaveDraft =
    hasDraftChanges &&
    draftBody.trim().length > 0 &&
    (selectedTopicKind === "image" || draftResultText.trim().length > 0);

  const refresh = async () => {
    try {
      await loadData();
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "데이터를 다시 읽을 수 없습니다.");
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
    setNotice("프로젝트를 저장했습니다.");
    await refresh();
  };

  const handleProjectDelete = async (projectToDelete = selectedProject) => {
    if (!projectToDelete) {
      return;
    }

    const ok = window.confirm(
      `"${projectToDelete.name}" 프로젝트와 포함된 테마, 주제, 버전, 이미지를 모두 삭제할까요?`,
    );
    if (!ok) {
      return;
    }

    const topicIds = store.topics
      .filter((topic) => topic.projectId === projectToDelete.id)
      .map((topic) => topic.id);
    const versionIds = store.versions
      .filter((version) => topicIds.includes(version.topicId))
      .map((version) => version.id);
    const imageIds = store.images
      .filter((image) => topicIds.includes(image.topicId) || versionIds.includes(image.versionId))
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

    const nextProject = store.projects.find((project) => project.id !== projectToDelete.id);
    setSelectedProjectId(nextProject?.id ?? "");
    setSelectedTopicId("");
    setCreatePanel(null);
    setNotice("프로젝트를 삭제했습니다.");
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
    setNotice("테마 폴더를 저장했습니다.");
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
    setNotice("주제를 저장했습니다.");
    await refresh();
  };

  const handleTopicDelete = async (topic: Topic) => {
    const ok = window.confirm(`"${topic.title}" 주제와 저장된 버전, 이미지를 모두 삭제할까요?`);
    if (!ok) {
      return;
    }

    const versionIds = store.versions
      .filter((version) => version.topicId === topic.id)
      .map((version) => version.id);
    const imageIds = store.images
      .filter((image) => image.topicId === topic.id || versionIds.includes(image.versionId))
      .map((image) => image.id);

    await Promise.all([
      ...imageIds.map((id) => deleteItem("images", id)),
      ...versionIds.map((id) => deleteItem("versions", id)),
      deleteItem("topics", topic.id),
    ]);

    const nextTopic = themeTopics.find((themeTopic) => themeTopic.id !== topic.id);
    setSelectedTopicId(nextTopic?.id ?? "");
    setCreatePanel(null);
    setNotice("주제를 삭제했습니다.");
    await refresh();
  };

  const handleImageUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (!files.length) {
      return;
    }

    const loadedImages = await Promise.all(files.map((file) => fileToDraftImage(file)));
    setDraftImages((current) => [...current, ...loadedImages]);
    setActiveVersionId("draft");
    event.target.value = "";
  };

  const handleImagePaste = async (event: ReactClipboardEvent<HTMLButtonElement>) => {
    if (!selectedTopicId) {
      return;
    }

    const files = getCurrentClipboardImageFiles(event.clipboardData);
    if (files.length === 0) {
      setNotice("현재 클립보드에 붙여넣을 이미지가 없습니다.");
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
    setNotice("현재 클립보드의 이미지를 추가했습니다.");
  };


  const handleVersionSave = async () => {
    if (!selectedTopic) {
      return;
    }

    const body = draftBody.trim();
    if (!body) {
      setError("저장할 프롬프트가 비어 있습니다.");
      return;
    }

    const resultText = draftResultText.trim();
    if (selectedTopicKind === "text" && !resultText) {
      setError("텍스트 결과를 입력해야 합니다.");
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
    setNotice("강화본을 저장했습니다.");
  };

  const handleVersionDelete = async (versionId: string) => {
    const imageIds = store.images
      .filter((image) => image.versionId === versionId)
      .map((image) => image.id);

    await Promise.all([deleteItem("versions", versionId), ...imageIds.map((id) => deleteItem("images", id))]);
    const remainingVersions = topicVersions.filter((version) => version.id !== versionId);
    const remainingLatest = remainingVersions[remainingVersions.length - 1] ?? null;
    setDraftLabel(remainingLatest ? `v${remainingVersions.length + 1}` : "초안");
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
    setNotice("버전을 삭제했습니다.");
  };

  const continueFromVersion = (version: PromptVersion) => {
    setDraftLabel(`v${topicVersions.length + 1}`);
    setDraftKind(selectedTopicKind);
    setDraftBody(version.body);
    setDraftResultText(getVersionResultText(version));
    setDraftNotes("");
    setDraftImages(
      getVersionKind(version) === "image" ? copyImagesToDraft(imagesByVersion[version.id] ?? []) : [],
    );
    setActiveVersionId("draft");
  };

  if (loading) {
    return (
      <main className="loading-screen">
        <Sparkles aria-hidden="true" />
        <span>불러오는 중</span>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <header className="brand">
          <div className="brand-mark">
            <Sparkles aria-hidden="true" size={19} />
          </div>
          <div>
            <h1>Prompt Reinforcer</h1>
            <p>IndexedDB</p>
          </div>
        </header>

        <section className="sidebar-section">
          <div className="section-title">
            <span className="section-title-label">
              <PanelLeft aria-hidden="true" size={16} />
              프로젝트
            </span>
            <button
              type="button"
              className="mini-icon-button"
              onClick={() => setCreatePanel(createPanel === "project" ? null : "project")}
              aria-label="프로젝트 추가"
            >
              <FolderPlus aria-hidden="true" size={15} />
            </button>
          </div>
          <div className="project-list">
            {store.projects.map((project) => (
              <div
                key={project.id}
                className={`project-row ${project.id === selectedProjectId ? "active" : ""}`}
              >
                <button
                  type="button"
                  className="project-row-main"
                  onClick={() => {
                    setSelectedProjectId(project.id);
                    setSelectedThemeId("");
                    setSelectedTopicId("");
                  }}
                >
                  <span>{project.name}</span>
                </button>
                <button
                  type="button"
                  className="row-delete-button"
                  onClick={() => handleProjectDelete(project)}
                  aria-label={`${project.name} 삭제`}
                >
                  <Trash2 aria-hidden="true" size={14} />
                </button>
              </div>
            ))}
          </div>
          {createPanel === "project" ? (
            <form className="create-form compact-form" onSubmit={handleProjectCreate}>
              <input
                value={newProjectName}
                onChange={(event) => setNewProjectName(event.target.value)}
                placeholder="새 프로젝트"
              />
              <button type="submit" className="icon-button" aria-label="프로젝트 추가">
                <Plus aria-hidden="true" size={17} />
              </button>
            </form>
          ) : null}
        </section>

        <section className="sidebar-section">
          <div className="section-title">
            <span className="section-title-label">
              <Layers3 aria-hidden="true" size={16} />
              테마
            </span>
            <button
              type="button"
              className="mini-icon-button"
              onClick={() => setCreatePanel(createPanel === "theme" ? null : "theme")}
              aria-label="테마 추가"
            >
              <Plus aria-hidden="true" size={15} />
            </button>
          </div>
          <div className="theme-list">
            {projectThemes.map((theme) => (
              <button
                key={theme.id}
                type="button"
                className={`theme-row ${theme.id === selectedThemeId ? "active" : ""}`}
                onClick={() => {
                  setSelectedThemeId(theme.id);
                  setSelectedTopicId("");
                }}
              >
                <span className="swatch" style={{ backgroundColor: theme.color }} />
                <span>{theme.name}</span>
              </button>
            ))}
          </div>
          {createPanel === "theme" ? (
            <form className="create-form stacked-form" onSubmit={handleThemeCreate}>
              <div className="color-row">
                {themeColors.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={`color-dot ${newThemeColor === color ? "selected" : ""}`}
                    style={{ backgroundColor: color }}
                    onClick={() => setNewThemeColor(color)}
                    aria-label={`테마 색상 ${color}`}
                  />
                ))}
              </div>
              <div className="compact-form">
                <input
                  value={newThemeName}
                  onChange={(event) => setNewThemeName(event.target.value)}
                  placeholder="새 테마"
                />
                <button type="submit" className="icon-button" aria-label="테마 추가">
                  <Plus aria-hidden="true" size={17} />
                </button>
              </div>
            </form>
          ) : null}
        </section>

        <section className="sidebar-section topic-section">
          <div className="section-title">
            <span className="section-title-label">
              <Diff aria-hidden="true" size={16} />
              주제
            </span>
            <button
              type="button"
              className="mini-icon-button"
              onClick={() => setCreatePanel(createPanel === "topic" ? null : "topic")}
              aria-label="주제 추가"
            >
              <Plus aria-hidden="true" size={15} />
            </button>
          </div>
          <div className="topic-list">
            {themeTopics.map((topic) => {
              const count = store.versions.filter((version) => version.topicId === topic.id).length;
              return (
                <div
                  key={topic.id}
                  className={`topic-row ${topic.id === selectedTopicId ? "active" : ""}`}
                >
                  <button
                    type="button"
                    className="topic-row-main"
                    onClick={() => setSelectedTopicId(topic.id)}
                  >
                    <span>{topic.title}</span>
                    <small>{count}</small>
                  </button>
                  <button
                    type="button"
                    className="row-delete-button"
                    onClick={() => handleTopicDelete(topic)}
                    aria-label={`${topic.title} 삭제`}
                  >
                    <Trash2 aria-hidden="true" size={14} />
                  </button>
                </div>
              );
            })}
          </div>
          {createPanel === "topic" ? (
            <form className="create-form stacked-form" onSubmit={handleTopicCreate}>
              <div className="result-type-control compact-kind-control" aria-label="주제 결과 타입">
                <button
                  type="button"
                  className={`segment-button ${newTopicKind === "text" ? "active" : ""}`}
                  onClick={() => setNewTopicKind("text")}
                >
                  <FileText aria-hidden="true" size={15} />
                  텍스트
                </button>
                <button
                  type="button"
                  className={`segment-button ${newTopicKind === "image" ? "active" : ""}`}
                  onClick={() => setNewTopicKind("image")}
                >
                  <ImageIcon aria-hidden="true" size={15} />
                  이미지
                </button>
              </div>
              <input
                value={newTopicTitle}
                onChange={(event) => setNewTopicTitle(event.target.value)}
                placeholder="새 주제"
              />
              <textarea
                value={newTopicBrief}
                onChange={(event) => setNewTopicBrief(event.target.value)}
                placeholder="메모"
                rows={3}
              />
              <button type="submit" className="wide-button">
                <Plus aria-hidden="true" size={16} />
                주제 추가
              </button>
            </form>
          ) : null}
        </section>
      </aside>

      <main className="workspace">
        {error ? <div className="status error">{error}</div> : null}
        {notice ? <div className="status">{notice}</div> : null}

        {selectedTopic ? (
          <>
            <header className="workspace-header">
              <div>
                <div className="eyebrow">
                  <span className="swatch" style={{ backgroundColor: selectedTheme?.color }} />
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
                강화본 저장
              </button>
            </header>

            <div className="editor-grid">
              <section className="panel editor-panel">
                <div className="panel-heading">
                  <h3>작성</h3>
                  <span>
                    프롬프트 {draftBody.length.toLocaleString()}자
                    {selectedTopicKind === "text"
                      ? ` / 결과 ${draftResultText.length.toLocaleString()}자`
                      : ""}
                  </span>
                </div>
                <div className="result-type-control" aria-label="결과 타입">
                  <button
                    type="button"
                    className={`segment-button locked ${selectedTopicKind === "text" ? "active" : ""}`}
                    tabIndex={-1}
                  >
                    <FileText aria-hidden="true" size={16} />
                    텍스트 결과
                  </button>
                  <button
                    type="button"
                    className={`segment-button locked ${selectedTopicKind === "image" ? "active" : ""}`}
                    tabIndex={-1}
                  >
                    <ImageIcon aria-hidden="true" size={16} />
                    이미지 결과
                  </button>
                </div>
                <label>
                  버전 이름
                  <input
                    value={draftLabel}
                    onChange={(event) => {
                      setDraftLabel(event.target.value);
                      setActiveVersionId("draft");
                    }}
                    placeholder="v2, 상세 강화안"
                  />
                </label>
                <label className="editor-field">
                  프롬프트
                  <textarea
                    value={draftBody}
                    onChange={(event) => {
                      setDraftBody(event.target.value);
                      setActiveVersionId("draft");
                    }}
                    placeholder="강화한 프롬프트를 작성"
                  />
                </label>
                {selectedTopicKind === "text" ? (
                  <label className="editor-field result-text-field">
                    결과 텍스트
                    <textarea
                      value={draftResultText}
                      onChange={(event) => {
                        setDraftResultText(event.target.value);
                        setActiveVersionId("draft");
                      }}
                      placeholder="프롬프트 실행 결과로 나온 텍스트를 저장"
                    />
                  </label>
                ) : null}
                <label>
                  변경 메모
                  <textarea
                    value={draftNotes}
                    onChange={(event) => {
                      setDraftNotes(event.target.value);
                      setActiveVersionId("draft");
                    }}
                    placeholder="의도, 제약, 참고사항"
                    rows={3}
                  />
                </label>

                {selectedTopicKind === "image" ? (
                  <div className="image-result-section">
                    <div className="image-input-panel">
                      <div className="upload-row">
                        <label className="file-button">
                          <ImagePlus aria-hidden="true" size={17} />
                          결과 이미지 추가
                          <input type="file" accept="image/*" multiple onChange={handleImageUpload} />
                        </label>
                        <span>작성본 이미지 {draftImages.length}개</span>
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
                          <strong>결과 이미지 붙여넣기</strong>
                          <small>이 영역을 선택하고 붙여넣기</small>
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
                                  setDraftImages((current) => current.filter((item) => item.id !== image.id))
                                }
                                aria-label={`${image.name} 삭제`}
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

              <section className="panel diff-panel">
                <div className="diff-titlebar">
                  <div className="editor-tab active">
                    <Diff aria-hidden="true" size={15} />
                    {compareTargetKind === "text" ? "result.diff" : "prompt.diff"}
                  </div>
                  <div className="diff-summary">
                    <span className="added">+{addedCount}</span>
                    <span className="removed">-{removedCount}</span>
                  </div>
                </div>
                <div
                  className="split-diff"
                  aria-label={compareTargetKind === "text" ? "결과 텍스트 차이" : "프롬프트 차이"}
                >
                  <DiffFile
                    side="left"
                    title={compareBase?.label ?? "이전 버전 없음"}
                    kind={compareBase ? compareBaseKind : null}
                    rows={lineDiffRows}
                  />
                  <DiffFile
                    side="right"
                    title={compareTargetLabel}
                    kind={compareTargetKind}
                    rows={lineDiffRows}
                  />
                </div>

                {compareTargetKind === "image" ? (
                  <div className="asset-diff-panel">
                    <div className="asset-diff-title">
                      <FileImage aria-hidden="true" size={15} />
                      결과 이미지
                    </div>
                    <div className="image-compare">
                      <ImageColumn title="이전 결과 이미지" images={compareBaseImages} />
                      <ImageColumn title="현재 결과 이미지" images={compareTargetImages} />
                    </div>
                  </div>
                ) : null}
              </section>
            </div>

            <section className="history-panel">
              <div className="panel-heading">
                <h3>저장 기록</h3>
                <span>{topicVersions.length}개</span>
              </div>
              <div className="version-list">
                {topicVersions.map((version) => (
                  <article
                    key={version.id}
                    className={`version-card ${version.id === activeVersionId ? "active" : ""}`}
                  >
                    <button
                      type="button"
                      className="version-main"
                      onClick={() => setActiveVersionId(version.id)}
                    >
                      <strong>
                        {version.label}
                        <KindBadge kind={getVersionKind(version)} />
                      </strong>
                      <span>
                        <Clock3 aria-hidden="true" size={14} />
                        {formatDateTime(version.createdAt)}
                      </span>
                      <p>{getVersionKind(version) === "text" ? getVersionResultText(version) : version.body}</p>
                    </button>
                    <div className="version-actions">
                      <button type="button" onClick={() => continueFromVersion(version)}>
                        이어쓰기
                      </button>
                      <button type="button" onClick={() => handleVersionDelete(version.id)}>
                        삭제
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </>
        ) : (
          <section className="empty-state">
            <Sparkles aria-hidden="true" size={24} />
            <h2>주제를 선택하세요</h2>
          </section>
        )}
      </main>
    </div>
  );
}

type ImageColumnProps = {
  title: string;
  images: Array<ImageAsset | DraftImage>;
};

function KindBadge({ kind }: { kind: PromptVersionKind }) {
  return <span className={`kind-badge ${kind}`}>{kind === "image" ? "이미지" : "텍스트"}</span>;
}

type DiffFileProps = {
  side: "left" | "right";
  title: string;
  kind: PromptVersionKind | null;
  rows: LineDiffRow[];
};

function DiffFile({ side, title, kind, rows }: DiffFileProps) {
  const isLeft = side === "left";

  return (
    <div className="diff-file">
      <div className="diff-file-header">
        <span>{title}</span>
        {kind ? <KindBadge kind={kind} /> : null}
      </div>
      <div className="code-lines">
        {rows.length > 0 ? (
          rows.map((row) => {
            const visible =
              row.type === "same" || (isLeft && row.type === "removed") || (!isLeft && row.type === "added");
            const lineNumber = isLeft ? row.leftLineNumber : row.rightLineNumber;
            const text = isLeft ? row.leftText : row.rightText;
            const marker = row.type === "same" || !visible ? "" : isLeft ? "-" : "+";

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
            <code>빈 내용</code>
          </div>
        )}
      </div>
    </div>
  );
}

function ImageColumn({ title, images }: ImageColumnProps) {
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
        <div className="empty-image">이미지 없음</div>
      )}
    </div>
  );
}
