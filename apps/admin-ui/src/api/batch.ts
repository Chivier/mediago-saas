import { restfulClient } from "./client";

export type BatchTaskStatus =
  | "queued"
  | "processing"
  | "done"
  | "failed"
  | "partial";

export interface BatchTaskItem {
  id: string;
  url: string;
  title?: string;
  status: "queued" | "processing" | "success" | "failed";
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

export async function fetchBatchTasks(): Promise<BatchTasksResponse> {
  const { data } = await restfulClient.get<BatchTasksResponse>("/api/tasks");
  return data;
}

export async function fetchBatchTask(id: string): Promise<BatchTask> {
  const { data } = await restfulClient.get<BatchTask>(`/api/tasks/${id}`);
  return data;
}

export interface CreateBatchTaskPayload {
  name: string;
  urls: string[];
}

export async function createBatchTask(
  payload: CreateBatchTaskPayload,
): Promise<BatchTask> {
  const { data } = await restfulClient.post<BatchTask>("/api/tasks", payload);
  return data;
}

export async function deleteBatchTask(id: string): Promise<void> {
  await restfulClient.delete(`/api/tasks/${id}`);
}
