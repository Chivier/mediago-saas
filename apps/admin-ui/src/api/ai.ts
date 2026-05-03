import { aiClient } from "./client";

// ─── Subtitle types ────────────────────────────────────────────────────────────

export type SubtitleLanguage = "auto" | "zh" | "en" | "ja" | "ko";
export type JobStatus = "queued" | "processing" | "done" | "failed";

export interface SubtitleJob {
  id: string;
  filePath: string;
  language: SubtitleLanguage;
  status: JobStatus;
  srtPath?: string;
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

export async function fetchSubtitleJobs(): Promise<SubtitleJobsResponse> {
  const { data } =
    await aiClient.get<SubtitleJobsResponse>("/api/subtitle/jobs");
  return data;
}

export async function submitSubtitleJob(
  payload: SubmitSubtitlePayload,
): Promise<SubtitleJob> {
  const { data } = await aiClient.post<SubtitleJob>(
    "/api/subtitle/submit",
    payload,
  );
  return data;
}

export function getSubtitleDownloadUrl(jobId: string): string {
  const base = import.meta.env.VITE_AI_API_URL ?? "http://localhost:8899";
  return `${base}/api/subtitle/${jobId}/download`;
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

export async function fetchSummaryJobs(): Promise<SummaryJobsResponse> {
  const { data } = await aiClient.get<SummaryJobsResponse>(
    "/api/summarize/jobs",
  );
  return data;
}

export async function submitSummaryJob(
  payload: SubmitSummaryPayload,
): Promise<SummaryJob> {
  const { data } = await aiClient.post<SummaryJob>(
    "/api/summarize/submit",
    payload,
  );
  return data;
}
