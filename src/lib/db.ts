import type { ImageAsset, Project, PromptVersion, Theme, Topic } from "../types";

type StoreMap = {
  projects: Project;
  themes: Theme;
  topics: Topic;
  versions: PromptVersion;
  images: ImageAsset;
};

type StoreName = keyof StoreMap;

const DB_NAME = "prompt-reinforcer";
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

export const createId = () => {
  if ("randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

export const nowIso = () => new Date().toISOString();

const openDb = () => {
  if (dbPromise) {
    return dbPromise;
  }

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains("projects")) {
        db.createObjectStore("projects", { keyPath: "id" });
      }

      if (!db.objectStoreNames.contains("themes")) {
        const store = db.createObjectStore("themes", { keyPath: "id" });
        store.createIndex("projectId", "projectId", { unique: false });
      }

      if (!db.objectStoreNames.contains("topics")) {
        const store = db.createObjectStore("topics", { keyPath: "id" });
        store.createIndex("projectId", "projectId", { unique: false });
        store.createIndex("themeId", "themeId", { unique: false });
      }

      if (!db.objectStoreNames.contains("versions")) {
        const store = db.createObjectStore("versions", { keyPath: "id" });
        store.createIndex("topicId", "topicId", { unique: false });
      }

      if (!db.objectStoreNames.contains("images")) {
        const store = db.createObjectStore("images", { keyPath: "id" });
        store.createIndex("topicId", "topicId", { unique: false });
        store.createIndex("versionId", "versionId", { unique: false });
      }
    };
  });

  return dbPromise;
};

const requestToPromise = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });

const withStore = async <T>(
  storeName: StoreName,
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => IDBRequest<T>,
) => {
  const db = await openDb();
  const tx = db.transaction(storeName, mode);
  const complete = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  const result = await requestToPromise(callback(tx.objectStore(storeName)));

  await complete;

  return result;
};

export const getAll = async <Name extends StoreName>(storeName: Name) =>
  withStore<StoreMap[Name][]>(storeName, "readonly", (store) => store.getAll());

export const putItem = async <Name extends StoreName>(
  storeName: Name,
  item: StoreMap[Name],
) => withStore<IDBValidKey>(storeName, "readwrite", (store) => store.put(item));

export const deleteItem = async (storeName: StoreName, id: string) =>
  withStore<undefined>(storeName, "readwrite", (store) => store.delete(id));

export const getByIndex = async <Name extends StoreName>(
  storeName: Name,
  indexName: string,
  value: string,
) =>
  withStore<StoreMap[Name][]>(storeName, "readonly", (store) =>
    store.index(indexName).getAll(value),
  );

export const seedIfEmpty = async () => {
  const projects = await getAll("projects");
  if (projects.length > 0) {
    return;
  }

  const createdAt = nowIso();
  const projectId = createId();
  const themeId = createId();
  const topicId = createId();

  await putItem("projects", {
    id: projectId,
    name: "첫 번째 프롬프트 프로젝트",
    description: "강화 전후를 보관하고 이미지 참고자료까지 같이 비교하는 로컬 저장소",
    createdAt,
    updatedAt: createdAt,
  });

  await putItem("themes", {
    id: themeId,
    projectId,
    name: "제품 상세페이지",
    color: "#2563eb",
    createdAt,
    updatedAt: createdAt,
  });

  await putItem("topics", {
    id: topicId,
    projectId,
    themeId,
    kind: "text",
    title: "신규 랜딩 히어로 카피",
    brief: "원본 의도는 유지하면서 구체성, 제약, 결과 형식을 더 분명하게 만든다.",
    createdAt,
    updatedAt: createdAt,
  });

  await putItem("versions", {
    id: createId(),
    topicId,
    kind: "text",
    label: "초안",
    body: "우리 제품을 소개하는 랜딩 페이지 히어로 카피를 작성해줘.",
    resultText: "제품의 핵심 가치를 한 문장으로 드러내는 히어로 카피 초안",
    notes: "비교용 샘플 초안",
    createdAt,
  });
};
