export type PromptVersionKind = "text" | "image";

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
  title: string;
  brief: string;
  createdAt: string;
  updatedAt: string;
};

export type PromptVersion = {
  id: string;
  topicId: string;
  kind?: PromptVersionKind;
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
