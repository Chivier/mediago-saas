import { restfulClient } from "./client";

export type BatchTaskStatus =
  | "queued"
  | "processing"
  | "done"
  | "failed"
  | "partial";

export type BatchTaskItemStatus =
  | "queued"
  | "processing"
  | "success"
  | "failed";

export interface BatchTaskItem {
  id: string;
  url: string;
  title?: string;
  status: BatchTaskItemStatus;
  error?: string;
  filePath?: string;
}

export interface BatchTask {
  id: string;
  name: string;
  total: number;
  completed: number;
  failed: number;
  status: BatchTaskStatus;
  items?: BatchTaskItem[];
  createdAt: string;
  updatedAt?: string;
}

export interface BatchTasksResponse {
  items: BatchTask[];
  total: number;
}

// The Koa restful service emits snake_case fields and uses a different
// status vocabulary than the admin-ui. Translate at the boundary so the
// rest of the UI keeps using the camelCase shape it was written against.
type RawBatchTaskStatus =
  | "pending"
  | "running"
  | "completed"
  | "partial"
  | "failed";

type RawBatchTaskItemStatus =
  | "pending"
  | "downloading"
  | "completed"
  | "failed";

type RawBatchTaskItem = {
  url: string;
  title: string | null;
  status: RawBatchTaskItemStatus;
  progress?: number;
  filename: string | null;
  size_bytes: number | null;
  error?: string;
};

type RawBatchTask = {
  task_id: string;
  name: string;
  status: RawBatchTaskStatus;
  total: number;
  completed?: number;
  failed?: number;
  progress?: number;
  size_bytes?: number;
  created_at: string;
  updated_at?: string;
  items?: RawBatchTaskItem[];
};

type RawListResponse = {
  tasks: RawBatchTask[];
  total: number;
  limit?: number;
  offset?: number;
};

const TASK_STATUS_MAP: Record<RawBatchTaskStatus, BatchTaskStatus> = {
  pending: "queued",
  running: "processing",
  completed: "done",
  partial: "partial",
  failed: "failed",
};

const ITEM_STATUS_MAP: Record<RawBatchTaskItemStatus, BatchTaskItemStatus> = {
  pending: "queued",
  downloading: "processing",
  completed: "success",
  failed: "failed",
};

function adaptItem(raw: RawBatchTaskItem, index: number): BatchTaskItem {
  return {
    id: `${index}-${raw.url}`,
    url: raw.url,
    title: raw.title ?? undefined,
    status: ITEM_STATUS_MAP[raw.status] ?? (raw.status as BatchTaskItemStatus),
    error: raw.error,
    filePath: raw.filename ?? undefined,
  };
}

function adaptTask(raw: RawBatchTask): BatchTask {
  return {
    id: raw.task_id,
    name: raw.name,
    total: raw.total,
    completed: raw.completed ?? 0,
    failed: raw.failed ?? 0,
    status: TASK_STATUS_MAP[raw.status] ?? (raw.status as BatchTaskStatus),
    items: raw.items?.map(adaptItem),
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

export async function fetchBatchTasks(): Promise<BatchTasksResponse> {
  const { data } = await restfulClient.get<RawListResponse>("/api/tasks");
  return {
    items: data.tasks.map(adaptTask),
    total: data.total,
  };
}

export async function fetchBatchTask(id: string): Promise<BatchTask> {
  const { data } = await restfulClient.get<RawBatchTask>(`/api/tasks/${id}`);
  return adaptTask(data);
}

export interface CreateBatchTaskPayload {
  name: string;
  urls: string[];
}

export async function createBatchTask(
  payload: CreateBatchTaskPayload,
): Promise<BatchTask> {
  const { data } = await restfulClient.post<RawBatchTask>(
    "/api/tasks",
    payload,
  );
  return adaptTask(data);
}

export async function deleteBatchTask(id: string): Promise<void> {
  await restfulClient.delete(`/api/tasks/${id}`);
}
