import axios from "axios";

// follow-tracker has its own axios client because it returns plain JSON
// (FastAPI), no {success,data} envelope to unwrap.
const FOLLOW_API_URL = import.meta.env.VITE_FOLLOW_API_URL ?? "/api/follow";

const followClient = axios.create({
  baseURL: FOLLOW_API_URL,
  // Bilibili refreshes are Selenium-driven and can take 30s+ on the first
  // page-load. Anything shorter than 90s leaves the user staring at a
  // 504 even though the actual job succeeds.
  timeout: 120000,
  headers: { "Content-Type": "application/json" },
});

// FastAPI's error envelope is {detail: "..."}; normalize so callers see
// a uniform Error.message regardless of which service threw.
followClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const message =
      error.response?.data?.detail ??
      error.response?.data?.message ??
      error.response?.data?.error ??
      error.message ??
      "Unknown error";
    return Promise.reject(new Error(message));
  },
);

// ─── Types ─────────────────────────────────────────────────────────────

export type Platform = "bilibili" | "youtube";
export type CreatorStatus = "ok" | "error";

export interface Creator {
  id: number;
  platform: Platform;
  externalId: string;
  name: string;
  autoDownload: boolean;
  lastCheckedAt: string | null;
  lastError: string | null;
  createdAt: string;
  videoCount: number;
}

export interface CreatorsResponse {
  items: Creator[];
  total: number;
}

export type VideoStatus =
  | "discovered"
  | "queued"
  | "succeeded"
  | "failed"
  | "skipped";
export type AiStatus = "pending" | "processing" | "done" | "failed" | null;

export interface NotesSection {
  title?: string;
  timestamp?: string;
  summary?: string;
  key_points?: string[];
  details?: string;
}

export interface VideoNotes {
  transcript?: string;
  summary?: string;
  key_topics?: string[];
  sections?: NotesSection[];
  mindmap?: string;
}

export interface FollowVideo {
  id: number;
  creatorId: number;
  externalId: string;
  title: string;
  url: string;
  pubDate: string | null;
  duration: string | null;
  coverUrl: string | null;
  status: VideoStatus;
  downloadId: number | null;
  filePath: string | null;
  aiStatus: AiStatus;
  aiJobId: string | null;
  notes: VideoNotes | null;
  discoveredAt: string;
  updatedAt: string;
}

export interface VideosResponse {
  items: FollowVideo[];
  total: number;
}

// ─── Calls ─────────────────────────────────────────────────────────────

export async function fetchCreators(): Promise<CreatorsResponse> {
  const { data } = await followClient.get<CreatorsResponse>("/api/creators");
  return data;
}

export async function addCreator(payload: {
  platform: Platform;
  externalId?: string;
  name?: string;
  autoDownload?: boolean;
}): Promise<Creator> {
  const { data } = await followClient.post<Creator>("/api/creators", payload);
  return data;
}

export async function patchCreator(
  id: number,
  payload: { name?: string; autoDownload?: boolean },
): Promise<Creator> {
  const { data } = await followClient.patch<Creator>(
    `/api/creators/${id}`,
    payload,
  );
  return data;
}

export async function deleteCreator(id: number): Promise<void> {
  await followClient.delete(`/api/creators/${id}`);
}

export async function refreshCreator(id: number): Promise<{
  creatorId: number;
  discovered: number;
  queued: number;
  durationSeconds: number;
  error: string | null;
}> {
  const { data } = await followClient.post(`/api/creators/${id}/refresh`);
  return data;
}

export async function fetchCreatorVideos(
  creatorId: number,
  params: { status?: VideoStatus; limit?: number; offset?: number } = {},
): Promise<VideosResponse> {
  const { data } = await followClient.get<VideosResponse>(
    `/api/creators/${creatorId}/videos`,
    { params },
  );
  return data;
}

export async function fetchVideo(id: number): Promise<FollowVideo> {
  const { data } = await followClient.get<FollowVideo>(`/api/videos/${id}`);
  return data;
}

export async function queueVideo(id: number): Promise<FollowVideo> {
  const { data } = await followClient.post<FollowVideo>(
    `/api/videos/${id}/queue`,
  );
  return data;
}

export async function skipVideo(id: number): Promise<FollowVideo> {
  const { data } = await followClient.post<FollowVideo>(
    `/api/videos/${id}/skip`,
  );
  return data;
}
