import { aiClient } from "./client";

// ─── Shared AI job progress types ───────────────────────────────────────────────

export type SubtitleLanguage = "auto" | "zh" | "en" | "ja" | "ko";
export type JobStatus = "queued" | "processing" | "done" | "failed";
export type JobStage =
  | "queued"
  | "transcribing"
  | "summarizing"
  | "polishing"
  | "done"
  | "failed";

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
  stage: JobStage;
  progressPercent: number;
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

type RawSubtitleJob = {
  job_id: string;
  status: JobStatus;
  stage?: JobStage;
  progress_percent?: number;
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
    stage: (raw.stage ?? (raw.status === "done" ? "done" : raw.status === "failed" ? "failed" : raw.status === "processing" ? "transcribing" : "queued")) as JobStage,
    progressPercent: raw.progress_percent ?? (raw.status === "done" ? 100 : raw.status === "failed" ? 100 : raw.status === "processing" ? 50 : 0),
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
  stage: JobStage;
  progressPercent: number;
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
  stage?: JobStage;
  progress_percent?: number;
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
    stage: (raw.stage ?? (raw.status === "done" ? "done" : raw.status === "failed" ? "failed" : raw.status === "processing" ? "summarizing" : "queued")) as JobStage,
    progressPercent: raw.progress_percent ?? (raw.status === "done" ? 100 : raw.status === "failed" ? 100 : raw.status === "processing" ? 60 : 0),
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

export interface NotesJob {
  id: string;
  filePath: string;
  title?: string;
  language: SummaryLanguage;
  status: JobStatus;
  stage: JobStage;
  progressPercent: number;
  transcript?: string;
  transcriptTimed?: string;
  summary?: string;
  keyTopics?: string[];
  sections?: Array<Record<string, unknown>>;
  mindmap?: string;
  polished?: boolean;
  polishNotes?: string;
  error?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface NotesJobsResponse {
  items: NotesJob[];
  total: number;
}

type RawNotesJob = {
  job_id: string;
  status: JobStatus;
  stage?: JobStage;
  progress_percent?: number;
  file_path?: string;
  title?: string | null;
  language?: SummaryLanguage;
  transcript?: string;
  transcript_timed?: string;
  summary?: string;
  key_topics?: string[];
  sections?: Array<Record<string, unknown>>;
  mindmap?: string;
  polished?: boolean;
  polish_notes?: string | null;
  error?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

function adaptNotes(raw: RawNotesJob): NotesJob {
  return {
    id: raw.job_id,
    filePath: raw.file_path ?? "",
    title: raw.title ?? undefined,
    language: (raw.language ?? "zh") as SummaryLanguage,
    status: raw.status,
    stage: (raw.stage ?? (raw.status === "done" ? "done" : raw.status === "failed" ? "failed" : raw.status === "processing" ? "transcribing" : "queued")) as JobStage,
    progressPercent: raw.progress_percent ?? (raw.status === "done" ? 100 : raw.status === "failed" ? 100 : raw.status === "processing" ? 50 : 0),
    transcript: raw.transcript,
    transcriptTimed: raw.transcript_timed,
    summary: raw.summary,
    keyTopics: raw.key_topics,
    sections: raw.sections,
    mindmap: raw.mindmap,
    polished: raw.polished,
    polishNotes: raw.polish_notes ?? undefined,
    error: raw.error ?? undefined,
    createdAt: raw.created_at ?? new Date().toISOString(),
    updatedAt: raw.updated_at ?? undefined,
  };
}

export async function fetchNotesJobs(): Promise<NotesJobsResponse> {
  const { data } = await aiClient.get<{
    items: RawNotesJob[];
    total: number;
  }>("/api/notes/jobs");
  return {
    items: data.items.map(adaptNotes),
    total: data.total,
  };
}
