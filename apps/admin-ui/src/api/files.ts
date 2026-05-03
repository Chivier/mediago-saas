import { restfulClient, RESTFUL_API_URL } from "./client";

export interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  modifiedAt: string;
  ext: string;
}

export interface FilesListResponse {
  cwd: string;
  parent: string | null;
  entries: FileEntry[];
}

type RawFileEntry = {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  modified_at: string;
  ext: string;
};

type RawFilesListResponse = {
  cwd: string;
  parent: string | null;
  entries: RawFileEntry[];
};

function adapt(raw: RawFileEntry): FileEntry {
  return {
    name: raw.name,
    path: raw.path,
    isDir: raw.is_dir,
    size: raw.size,
    modifiedAt: raw.modified_at,
    ext: raw.ext,
  };
}

export async function listFiles(dirPath = ""): Promise<FilesListResponse> {
  const { data } = await restfulClient.get<{
    success: boolean;
    data: RawFilesListResponse;
  }>("/api/files", { params: { path: dirPath } });
  return {
    cwd: data.data.cwd,
    parent: data.data.parent,
    entries: data.data.entries.map(adapt),
  };
}

export async function deleteFile(filePath: string): Promise<void> {
  await restfulClient.delete("/api/files", { params: { path: filePath } });
}

export function getPreviewUrl(filePath: string): string {
  return `${RESTFUL_API_URL}/api/files/preview?path=${encodeURIComponent(filePath)}`;
}

export function getFileDownloadUrl(filePath: string): string {
  return `${RESTFUL_API_URL}/api/files/download?path=${encodeURIComponent(filePath)}`;
}

const PREVIEWABLE = new Set([
  ".mp4",
  ".mkv",
  ".webm",
  ".mov",
  ".m4v",
  ".mp3",
  ".m4a",
  ".wav",
  ".srt",
  ".vtt",
  ".txt",
  ".json",
  ".log",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
]);

export function isPreviewable(ext: string): boolean {
  return PREVIEWABLE.has(ext.toLowerCase());
}

export function previewKind(
  ext: string,
): "video" | "audio" | "image" | "text" | null {
  const e = ext.toLowerCase();
  if ([".mp4", ".mkv", ".webm", ".mov", ".m4v"].includes(e)) return "video";
  if ([".mp3", ".m4a", ".wav"].includes(e)) return "audio";
  if ([".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(e)) return "image";
  if ([".srt", ".vtt", ".txt", ".json", ".log"].includes(e)) return "text";
  return null;
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(n) / Math.log(1024));
  const v = n / Math.pow(1024, i);
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}
