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
  // Server never returns the cookie string itself, only whether one is
  // configured — so the UI can show a "cookies set" indicator without
  // leaking SESSDATA into the React Query cache.
  hasCookies: boolean;
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
  cookies?: string;
}): Promise<Creator> {
  const { data } = await followClient.post<Creator>("/api/creators", payload);
  return data;
}

export async function patchCreator(
  id: number,
  // ``cookies: ""`` clears the stored value; ``undefined`` leaves it alone.
  payload: { name?: string; autoDownload?: boolean; cookies?: string },
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

// ─── Bilibili QR login ─────────────────────────────────────────────────

export interface QrStart {
  qrcodeKey: string;
  qrPngB64: string;
  url: string;
}

// Status values are deliberately narrow because the UI switches on them.
export type QrPollStatus =
  | "pending"
  | "scanned"
  | "confirmed"
  | "expired"
  | "error";

export interface QrPoll {
  status: QrPollStatus;
  message: string | null;
  cookies: string | null;
}

export async function startBiliQrLogin(): Promise<QrStart> {
  const { data } = await followClient.post<QrStart>("/api/bili-login/qr/start");
  return data;
}

export async function pollBiliQrLogin(qrcodeKey: string): Promise<QrPoll> {
  const { data } = await followClient.get<QrPoll>("/api/bili-login/qr/poll", {
    params: { key: qrcodeKey },
  });
  return data;
}

// ─── Platform-level login credentials ──────────────────────────────────

export interface PlatformLogin {
  platform: Platform;
  hasCookies: boolean;
  updatedAt: string | null;
}

export interface PlatformLoginsResponse {
  items: PlatformLogin[];
}

export async function fetchPlatformLogins(): Promise<PlatformLoginsResponse> {
  const { data } = await followClient.get<PlatformLoginsResponse>(
    "/api/platform-logins",
  );
  return data;
}

export async function savePlatformLogin(
  platform: Platform,
  cookies: string,
): Promise<PlatformLogin> {
  const { data } = await followClient.put<PlatformLogin>(
    `/api/platform-logins/${platform}`,
    { cookies },
  );
  return data;
}

export async function deletePlatformLogin(
  platform: Platform,
): Promise<PlatformLogin> {
  const { data } = await followClient.delete<PlatformLogin>(
    `/api/platform-logins/${platform}`,
  );
  return data;
}
