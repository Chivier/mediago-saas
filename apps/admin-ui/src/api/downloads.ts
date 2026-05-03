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

// Go core's raw video record (snake_case-free; mostly camelCase already).
interface RawDownload {
  id: number;
  name?: string;
  url: string;
  type: string;
  status: string;
  folder?: string | null;
  isLive?: boolean;
  createdDate?: string;
  updatedDate?: string;
  exists?: boolean;
}

interface RawListResponse {
  total: number;
  list: RawDownload[];
}

function adaptStatus(s: string): DownloadStatus {
  if (s === "ready" || s === "pending") return "queued";
  if (
    s === "downloading" ||
    s === "success" ||
    s === "failed" ||
    s === "paused"
  ) {
    return s;
  }
  return "queued";
}

function adaptDownload(raw: RawDownload): Download {
  const inferType = (t: string): DownloadType => {
    if (t === "m3u8" || t === "direct") return "video";
    if (t === "bilibili" || t === "youtube" || t === "mediago") return "video";
    return "unknown";
  };
  return {
    id: String(raw.id),
    title: raw.name ?? "",
    url: raw.url,
    type: inferType(raw.type),
    status: adaptStatus(raw.status),
    createdAt: raw.createdDate ?? new Date().toISOString(),
    updatedAt: raw.updatedDate,
  };
}

export async function fetchDownloads(
  params: DownloadListParams = {},
): Promise<DownloadsResponse> {
  const { page = 1, pageSize = 20, status } = params;
  const query: Record<string, string | number> = { current: page, pageSize };
  // Go core accepts filter=done|list — translate where it maps cleanly.
  if (status === "success") query.filter = "done";
  else if (status && status !== "all") {
    query.filter = "list";
  }
  const { data } = await goClient.get<RawListResponse>("/api/downloads", {
    params: query,
  });
  let items = data.list.map(adaptDownload);
  // The Go filter is coarse (done vs not-done), so refine client-side
  // when the user picked a more specific status.
  if (status && status !== "all") {
    items = items.filter((d) => d.status === status);
  }
  return { items, total: data.total, page, pageSize };
}

export async function fetchDownload(id: string): Promise<Download> {
  const { data } = await goClient.get<RawDownload>(`/api/downloads/${id}`);
  return adaptDownload(data);
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

// Go core's accepted download types
export type CoreDownloadType =
  | "m3u8"
  | "bilibili"
  | "direct"
  | "mediago"
  | "youtube"
  | "auto";

// Heuristic auto-detect to keep parity with the Electron frontend.
// Anything with .m3u8 → m3u8, bilibili.com → bilibili, youtube.com/youtu.be → youtube,
// otherwise direct.
function detectType(url: string): Exclude<CoreDownloadType, "auto"> {
  const l = url.toLowerCase();
  if (l.includes(".m3u8")) return "m3u8";
  if (
    l.includes("bilibili.com") ||
    l.startsWith("bv1") ||
    /^bv[0-9a-z]+/i.test(url)
  )
    return "bilibili";
  if (l.includes("youtube.com") || l.includes("youtu.be")) return "youtube";
  return "direct";
}

export interface CreateDownloadPayload {
  url: string;
  title?: string;
  type?: CoreDownloadType;
  startNow?: boolean;
  folder?: string;
}

// Wraps Go core's POST /api/downloads, which expects a batched request
// shape ({tasks:[…], startDownload}). Single-URL submits from the UI
// build a one-element batch on the way out.
export async function createDownload(
  payload: CreateDownloadPayload,
): Promise<{ ids: number[] }> {
  const type =
    payload.type && payload.type !== "auto"
      ? payload.type
      : detectType(payload.url);
  const body = {
    tasks: [
      {
        type,
        url: payload.url,
        ...(payload.title ? { name: payload.title } : {}),
        ...(payload.folder ? { folder: payload.folder } : {}),
      },
    ],
    startDownload: payload.startNow ?? true,
  };
  const { data } = await goClient.post<{ ids: number[] }>(
    "/api/downloads",
    body,
  );
  return data;
}

export interface DownloadStats {
  total: number;
  completed: number;
  failed: number;
  active: number;
  queued: number;
}

// Go core doesn't expose /api/downloads/stats; derive stats from the
// list endpoint (cheap because it's a single SQLite scan and we already
// poll it on the Dashboard).
export async function fetchDownloadStats(): Promise<DownloadStats> {
  const { data } = await goClient.get<RawListResponse>("/api/downloads", {
    params: { current: 1, pageSize: 10000 },
  });
  const items = data.list.map(adaptDownload);
  return {
    total: data.total,
    completed: items.filter((d) => d.status === "success").length,
    failed: items.filter((d) => d.status === "failed").length,
    active: items.filter((d) => d.status === "downloading").length,
    queued: items.filter((d) => d.status === "queued").length,
  };
}
