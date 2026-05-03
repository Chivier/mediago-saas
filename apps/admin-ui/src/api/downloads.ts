import { goClient } from "./client";

export type DownloadStatus =
  | "queued"
  | "downloading"
  | "success"
  | "failed"
  | "paused";
export type DownloadType = "video" | "audio" | "image" | "document" | "unknown";

export interface Download {
  id: string;
  title: string;
  url: string;
  type: DownloadType;
  status: DownloadStatus;
  progress?: number;
  speed?: string;
  size?: string;
  createdAt: string;
  updatedAt?: string;
  filePath?: string;
  error?: string;
}

export interface DownloadsResponse {
  items: Download[];
  total: number;
  page: number;
  pageSize: number;
}

export interface DownloadListParams {
  page?: number;
  pageSize?: number;
  status?: DownloadStatus | "all";
}

export async function fetchDownloads(
  params: DownloadListParams = {},
): Promise<DownloadsResponse> {
  const { page = 1, pageSize = 20, status } = params;
  const query: Record<string, string | number> = { page, pageSize };
  if (status && status !== "all") query.status = status;
  const { data } = await goClient.get<DownloadsResponse>("/api/downloads", {
    params: query,
  });
  return data;
}

export async function fetchDownload(id: string): Promise<Download> {
  const { data } = await goClient.get<Download>(`/api/downloads/${id}`);
  return data;
}

export async function startDownload(id: string): Promise<void> {
  await goClient.post(`/api/downloads/${id}/start`);
}

export async function stopDownload(id: string): Promise<void> {
  await goClient.post(`/api/downloads/${id}/stop`);
}

export async function deleteDownload(id: string): Promise<void> {
  await goClient.delete(`/api/downloads/${id}`);
}

export async function createDownload(payload: {
  url: string;
  title?: string;
}): Promise<Download> {
  const { data } = await goClient.post<Download>("/api/downloads", payload);
  return data;
}

export interface DownloadStats {
  total: number;
  completed: number;
  failed: number;
  active: number;
  queued: number;
}

export async function fetchDownloadStats(): Promise<DownloadStats> {
  const { data } = await goClient.get<DownloadStats>("/api/downloads/stats");
  return data;
}
