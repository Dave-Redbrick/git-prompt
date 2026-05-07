import type {
  ImageAsset,
  Project,
  PromptVersion,
  ResultMediaKind,
  Theme,
  Topic,
  TopicModelConfig,
} from "../types";
import { createId, nowIso, putItem } from "./db";
import { getResultMediaKind, getVersionResultTexts, joinResultTexts } from "./promptVersions";

export type ProjectArchiveStore = {
  projects: Project[];
  themes: Theme[];
  topics: Topic[];
  versions: PromptVersion[];
  images: ImageAsset[];
  customModels: TopicModelConfig[];
};

type ArchivePromptVersion = Omit<PromptVersion, "resultText" | "resultTexts">;

type ArchiveResultKind = "text" | ResultMediaKind;

type ArchiveResultFile = {
  id: string;
  topicId: string;
  versionId: string;
  kind: ArchiveResultKind;
  name: string;
  type: string;
  path: string;
  createdAt: string;
  index?: number;
};

type ProjectArchiveManifest = {
  app: "Git Prompt";
  exportedAt: string;
  schema: "git-prompt.project-archive";
  version: 2;
  project: Project;
  themes: Theme[];
  topics: Topic[];
  versions: ArchivePromptVersion[];
  resultFiles: ArchiveResultFile[];
  customModels: TopicModelConfig[];
};

export type ImportedProjectArchive = {
  project: Project;
  themes: Theme[];
  topics: Topic[];
  versions: PromptVersion[];
  images: ImageAsset[];
  customModels: TopicModelConfig[];
};

type ZipEntryInput = {
  name: string;
  data: Uint8Array;
};

type ZipEntryOutput = ZipEntryInput;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const crcTable = (() => {
  const table = new Uint32Array(256);

  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }

  return table;
})();

const crc32 = (data: Uint8Array) => {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const writeUint16 = (view: DataView, offset: number, value: number) => {
  view.setUint16(offset, value, true);
};

const writeUint32 = (view: DataView, offset: number, value: number) => {
  view.setUint32(offset, value, true);
};

const readUint16 = (data: Uint8Array, offset: number) =>
  data[offset] | (data[offset + 1] << 8);

const readUint32 = (data: Uint8Array, offset: number) =>
  (
    data[offset] |
    (data[offset + 1] << 8) |
    (data[offset + 2] << 16) |
    (data[offset + 3] << 24)
  ) >>> 0;

const concatBytes = (chunks: Uint8Array[]) => {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const merged = new Uint8Array(total);
  let offset = 0;

  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return merged;
};

const sanitizePathPart = (value: string) =>
  value
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "project";

const getFileExtension = (name: string) =>
  name.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() ?? "";

const getBaseName = (name: string) =>
  name.replace(/\.[a-z0-9]+$/i, "") || name;

const dataUrlToBytes = (dataUrl: string) => {
  const match = /^data:([^;,]+)?(?:;[^,]*)?;base64,(.*)$/i.exec(dataUrl);
  if (!match) {
    throw new Error("Unsupported result file data URL.");
  }

  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return {
    bytes,
    mimeType: match[1] || "application/octet-stream",
  };
};

const bytesToDataUrl = (bytes: Uint8Array, mimeType: string) => {
  let binary = "";
  for (let offset = 0; offset < bytes.byteLength; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
};

const fileExtensionForResultFile = (file: Pick<ImageAsset, "name" | "type">) => {
  const fromName = getFileExtension(file.name);
  if (fromName) {
    return fromName;
  }

  const fromType = file.type.split("/")[1];
  return fromType ? fromType.replace("jpeg", "jpg") : "bin";
};

const createZipBlob = (entries: ZipEntryInput[]) => {
  const localChunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = textEncoder.encode(entry.name);
    const data = entry.data;
    const entryCrc = crc32(data);

    const localHeader = new Uint8Array(30 + nameBytes.byteLength);
    const localView = new DataView(localHeader.buffer);
    writeUint32(localView, 0, 0x04034b50);
    writeUint16(localView, 4, 20);
    writeUint16(localView, 6, 0x0800);
    writeUint16(localView, 8, 0);
    writeUint16(localView, 10, 0);
    writeUint16(localView, 12, 0);
    writeUint32(localView, 14, entryCrc);
    writeUint32(localView, 18, data.byteLength);
    writeUint32(localView, 22, data.byteLength);
    writeUint16(localView, 26, nameBytes.byteLength);
    writeUint16(localView, 28, 0);
    localHeader.set(nameBytes, 30);

    localChunks.push(localHeader, data);

    const centralHeader = new Uint8Array(46 + nameBytes.byteLength);
    const centralView = new DataView(centralHeader.buffer);
    writeUint32(centralView, 0, 0x02014b50);
    writeUint16(centralView, 4, 20);
    writeUint16(centralView, 6, 20);
    writeUint16(centralView, 8, 0x0800);
    writeUint16(centralView, 10, 0);
    writeUint16(centralView, 12, 0);
    writeUint16(centralView, 14, 0);
    writeUint32(centralView, 16, entryCrc);
    writeUint32(centralView, 20, data.byteLength);
    writeUint32(centralView, 24, data.byteLength);
    writeUint16(centralView, 28, nameBytes.byteLength);
    writeUint16(centralView, 30, 0);
    writeUint16(centralView, 32, 0);
    writeUint16(centralView, 34, 0);
    writeUint16(centralView, 36, 0);
    writeUint32(centralView, 38, 0);
    writeUint32(centralView, 42, offset);
    centralHeader.set(nameBytes, 46);
    centralChunks.push(centralHeader);

    offset += localHeader.byteLength + data.byteLength;
  }

  const centralDirectory = concatBytes(centralChunks);
  const endRecord = new Uint8Array(22);
  const endView = new DataView(endRecord.buffer);
  writeUint32(endView, 0, 0x06054b50);
  writeUint16(endView, 4, 0);
  writeUint16(endView, 6, 0);
  writeUint16(endView, 8, entries.length);
  writeUint16(endView, 10, entries.length);
  writeUint32(endView, 12, centralDirectory.byteLength);
  writeUint32(endView, 16, offset);
  writeUint16(endView, 20, 0);

  const zipBytes = concatBytes([...localChunks, centralDirectory, endRecord]);

  return new Blob([zipBytes.buffer as ArrayBuffer], {
    type: "application/zip",
  });
};

const readZipEntries = async (file: Blob): Promise<ZipEntryOutput[]> => {
  const data = new Uint8Array(await file.arrayBuffer());
  const entries: ZipEntryOutput[] = [];
  let offset = 0;

  while (
    offset + 4 <= data.byteLength &&
    readUint32(data, offset) === 0x04034b50
  ) {
    const flags = readUint16(data, offset + 6);
    const method = readUint16(data, offset + 8);
    const compressedSize = readUint32(data, offset + 18);
    const fileNameLength = readUint16(data, offset + 26);
    const extraLength = readUint16(data, offset + 28);
    const nameStart = offset + 30;
    const nameEnd = nameStart + fileNameLength;
    const dataStart = nameEnd + extraLength;
    const dataEnd = dataStart + compressedSize;

    if (flags & 8 || method !== 0 || dataEnd > data.byteLength) {
      throw new Error("Unsupported zip archive.");
    }

    entries.push({
      name: textDecoder.decode(data.subarray(nameStart, nameEnd)),
      data: data.subarray(dataStart, dataEnd),
    });

    offset = dataEnd;
  }

  return entries;
};

function assertArchiveManifest(
  value: unknown,
): asserts value is ProjectArchiveManifest {
  if (
    !value ||
    typeof value !== "object" ||
    (value as ProjectArchiveManifest).schema !== "git-prompt.project-archive" ||
    (value as ProjectArchiveManifest).version !== 2 ||
    !Array.isArray((value as ProjectArchiveManifest).resultFiles) ||
    !Array.isArray((value as ProjectArchiveManifest).customModels)
  ) {
    throw new Error("Invalid Git Prompt project archive.");
  }
}

const collectProjectArchive = (
  projectId: string,
  store: ProjectArchiveStore,
): ProjectArchiveManifest => {
  const project = store.projects.find((item) => item.id === projectId);
  if (!project) {
    throw new Error("Project not found.");
  }

  const themes = store.themes
    .filter((theme) => theme.projectId === project.id)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const topics = store.topics
    .filter((topic) => topic.projectId === project.id)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const topicIds = new Set(topics.map((topic) => topic.id));
  const versions = store.versions
    .filter((version) => topicIds.has(version.topicId))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const versionIds = new Set(versions.map((version) => version.id));
  const textResultFiles = versions.flatMap((version) =>
    getVersionResultTexts(version).map<ArchiveResultFile>((_resultText, index) => ({
      id: `${version.id}:text:${index + 1}`,
      topicId: version.topicId,
      versionId: version.id,
      kind: "text",
      name: `result-${index + 1}.txt`,
      type: "text/plain;charset=utf-8",
      path: `results/${version.id}/result-${index + 1}.txt`,
      createdAt: version.createdAt,
      index,
    })),
  );
  const mediaResultFiles = store.images
    .filter(
      (image) => topicIds.has(image.topicId) || versionIds.has(image.versionId),
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map<ArchiveResultFile>(({ dataUrl: _dataUrl, ...image }) => {
      const extension = fileExtensionForResultFile(image);
      const baseName = sanitizePathPart(getBaseName(image.name));
      return {
        ...image,
        kind: image.kind ?? getResultMediaKind(image),
        path: `results/${image.versionId}/${image.id}-${baseName}.${extension}`,
      };
    });
  const archiveVersions = versions.map<ArchivePromptVersion>(
    ({ resultText: _resultText, resultTexts: _resultTexts, ...version }) =>
      version,
  );

  return {
    app: "Git Prompt",
    exportedAt: nowIso(),
    schema: "git-prompt.project-archive",
    version: 2,
    project,
    themes,
    topics,
    versions: archiveVersions,
    resultFiles: [...textResultFiles, ...mediaResultFiles],
    customModels: store.customModels ?? [],
  };
};

export const createProjectArchiveZip = async (
  projectId: string,
  store: ProjectArchiveStore,
) => {
  const manifest = collectProjectArchive(projectId, store);
  const originalMediaFiles = new Map(store.images.map((image) => [image.id, image]));
  const originalVersions = new Map(
    store.versions.map((version) => [version.id, version]),
  );
  const resultEntries = manifest.resultFiles.map((resultFile) => {
    if (resultFile.kind === "text") {
      const version = originalVersions.get(resultFile.versionId);
      const resultText = version
        ? (getVersionResultTexts(version)[resultFile.index ?? 0] ?? "")
        : "";

      return {
        name: resultFile.path,
        data: textEncoder.encode(resultText),
      };
    }

    const original = originalMediaFiles.get(resultFile.id);
    if (!original) {
      throw new Error(`Missing result file: ${resultFile.id}`);
    }

    return {
      name: resultFile.path,
      data: dataUrlToBytes(original.dataUrl).bytes,
    };
  });
  const manifestEntry = {
    name: "manifest.json",
    data: textEncoder.encode(JSON.stringify(manifest, null, 2)),
  };
  const blob = createZipBlob([manifestEntry, ...resultEntries]);
  const fileName = `${sanitizePathPart(manifest.project.name)}-git-prompt.zip`;

  return { blob, fileName, manifest };
};

export const downloadBlob = (blob: Blob, fileName: string) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
};

export const importProjectArchiveZip = async (
  file: Blob,
): Promise<ImportedProjectArchive> => {
  const entries = await readZipEntries(file);
  const entryMap = new Map(entries.map((entry) => [entry.name, entry.data]));
  const manifestEntry = entryMap.get("manifest.json");
  if (!manifestEntry) {
    throw new Error("manifest.json was not found in the archive.");
  }

  const manifest = JSON.parse(textDecoder.decode(manifestEntry)) as unknown;
  assertArchiveManifest(manifest);

  const projectId = createId();
  const themeIdMap = new Map(
    manifest.themes.map((theme) => [theme.id, createId()]),
  );
  const topicIdMap = new Map(
    manifest.topics.map((topic) => [topic.id, createId()]),
  );
  const versionIdMap = new Map(
    manifest.versions.map((version) => [version.id, createId()]),
  );
  const importedAt = nowIso();
  const project: Project = {
    ...manifest.project,
    id: projectId,
    updatedAt: importedAt,
  };
  const themes: Theme[] = manifest.themes.map((theme) => ({
    ...theme,
    id: themeIdMap.get(theme.id) ?? createId(),
    projectId,
  }));
  const topics: Topic[] = manifest.topics.map((topic) => ({
    ...topic,
    id: topicIdMap.get(topic.id) ?? createId(),
    projectId,
    themeId: topic.themeId ? themeIdMap.get(topic.themeId) : undefined,
  }));
  const textResultsByVersion = new Map<string, string[]>();
  const textResultFiles = manifest.resultFiles
    .filter((resultFile) => resultFile.kind === "text")
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

  for (const resultFile of textResultFiles) {
    const textData = entryMap.get(resultFile.path);
    if (!textData) {
      throw new Error(`Missing result file: ${resultFile.path}`);
    }

    const results = textResultsByVersion.get(resultFile.versionId) ?? [];
    results[resultFile.index ?? results.length] = textDecoder.decode(textData);
    textResultsByVersion.set(resultFile.versionId, results);
  }

  const versions: PromptVersion[] = manifest.versions.map((version) => {
    const resultTexts = (textResultsByVersion.get(version.id) ?? []).filter(
      (resultText) => resultText.trim().length > 0,
    );
    const resultText = joinResultTexts(resultTexts);

    const versionKind = version.kind ?? "text";

    return {
      ...version,
      id: versionIdMap.get(version.id) ?? createId(),
      topicId: topicIdMap.get(version.topicId) ?? version.topicId,
      resultText: versionKind === "text" ? resultText : "",
      resultTexts: versionKind === "text" ? resultTexts : [],
    };
  });
  const images: ImageAsset[] = manifest.resultFiles
    .filter(
      (resultFile): resultFile is ArchiveResultFile & { kind: ResultMediaKind } =>
        resultFile.kind !== "text",
    )
    .map((resultFile) => {
      const resultData = entryMap.get(resultFile.path);
      if (!resultData) {
        throw new Error(`Missing result file: ${resultFile.path}`);
      }

      return {
        id: createId(),
        topicId: topicIdMap.get(resultFile.topicId) ?? resultFile.topicId,
        versionId: versionIdMap.get(resultFile.versionId) ?? resultFile.versionId,
        kind: resultFile.kind,
        name: resultFile.name,
        type: resultFile.type,
        dataUrl: bytesToDataUrl(resultData, resultFile.type),
        createdAt: resultFile.createdAt,
      };
    });
  const customModels = manifest.customModels;

  await putItem("projects", project);
  await Promise.all(themes.map((theme) => putItem("themes", theme)));
  await Promise.all(topics.map((topic) => putItem("topics", topic)));
  await Promise.all(versions.map((version) => putItem("versions", version)));
  await Promise.all(images.map((image) => putItem("images", image)));

  return {
    project,
    themes,
    topics,
    versions,
    images,
    customModels,
  };
};
