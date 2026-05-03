import { aiClient } from "./client";

// ─── Subtitle types ────────────────────────────────────────────────────────────

export type SubtitleLanguage = "auto" | "zh" | "en" | "ja" | "ko";
export type JobStatus = "queued" | "processing" | "done" | "failed";

export interface SubtitleSegment {
  start: number;
  end: number;
  text: string;
}

export interface SubtitleJob {
  id: string;
  filePath: string;
  language: SubtitleLanguage;
  status: JobStatus;
  segments?: SubtitleSegment[];
  error?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface SubtitleJobsResponse {
  items: SubtitleJob[];
  total: number;
}

export interface SubmitSubtitlePayload {
  filePath: string;
  language?: SubtitleLanguage;
}

// FastAPI returns snake_case; the table renderers expect camelCase. Normalize
// at the boundary so the rest of the UI stays in one shape.
type RawSubtitleJob = {
  job_id: string;
  status: JobStatus;
  file_path?: string;
  language?: SubtitleLanguage;
  subtitles?: SubtitleSegment[];
  error?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

function adaptSubtitle(raw: RawSubtitleJob): SubtitleJob {
  return {
    id: raw.job_id,
    filePath: raw.file_path ?? "",
    language: (raw.language ?? "auto") as SubtitleLanguage,
    status: raw.status,
    segments: raw.subtitles,
    error: raw.error ?? undefined,
    createdAt: raw.created_at ?? new Date().toISOString(),
    updatedAt: raw.updated_at ?? undefined,
  };
}

export async function fetchSubtitleJobs(): Promise<SubtitleJobsResponse> {
  const { data } = await aiClient.get<{
    items: RawSubtitleJob[];
    total: number;
  }>("/api/subtitle/jobs");
  return {
    items: data.items.map(adaptSubtitle),
    total: data.total,
  };
}

export async function submitSubtitleJob(
  payload: SubmitSubtitlePayload,
): Promise<{ jobId: string; status: JobStatus }> {
  const { data } = await aiClient.post<{ job_id: string; status: JobStatus }>(
    "/api/subtitle/transcribe",
    {
      file_path: payload.filePath,
      language: payload.language ?? "auto",
    },
  );
  return { jobId: data.job_id, status: data.status };
}

export function getSubtitleDownloadUrl(jobId: string): string {
  const base = import.meta.env.VITE_AI_API_URL ?? "/api/ai";
  return `${base}/api/subtitle/jobs/${jobId}/srt`;
}

// ─── Summary types ─────────────────────────────────────────────────────────────

export type SummaryLanguage = "auto" | "zh" | "en";

export interface SummaryJob {
  id: string;
  filePath: string;
  title?: string;
  language: SummaryLanguage;
  status: JobStatus;
  summary?: string;
  keyPoints?: string[];
  topic?: string;
  error?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface SummaryJobsResponse {
  items: SummaryJob[];
  total: number;
}

export interface SubmitSummaryPayload {
  filePath: string;
  title?: string;
  language?: SummaryLanguage;
}

type RawSummaryJob = {
  job_id: string;
  status: JobStatus;
  file_path?: string;
  title?: string | null;
  language?: SummaryLanguage;
  summary?: string;
  key_points?: string[];
  topic?: string;
  error?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

function adaptSummary(raw: RawSummaryJob): SummaryJob {
  return {
    id: raw.job_id,
    filePath: raw.file_path ?? "",
    title: raw.title ?? undefined,
    language: (raw.language ?? "auto") as SummaryLanguage,
    status: raw.status,
    summary: raw.summary,
    keyPoints: raw.key_points,
    topic: raw.topic,
    error: raw.error ?? undefined,
    createdAt: raw.created_at ?? new Date().toISOString(),
    updatedAt: raw.updated_at ?? undefined,
  };
}

export async function fetchSummaryJobs(): Promise<SummaryJobsResponse> {
  const { data } = await aiClient.get<{
    items: RawSummaryJob[];
    total: number;
  }>("/api/summarize/jobs");
  return {
    items: data.items.map(adaptSummary),
    total: data.total,
  };
}

export async function submitSummaryJob(
  payload: SubmitSummaryPayload,
): Promise<{ jobId: string; status: JobStatus }> {
  const { data } = await aiClient.post<{ job_id: string; status: JobStatus }>(
    "/api/summarize/video",
    {
      file_path: payload.filePath,
      title: payload.title,
      language: payload.language ?? "auto",
    },
  );
  return { jobId: data.job_id, status: data.status };
}
