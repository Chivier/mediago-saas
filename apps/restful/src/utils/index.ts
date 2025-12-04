import type { ApiResponse, ApiErrorCode } from "../types";

export function success<T>(data: T): ApiResponse<T> {
  return {
    success: true,
    data,
  };
}

export function error(
  message: string,
  code?: ApiErrorCode,
  httpStatus?: number,
): ApiResponse {
  return {
    success: false,
    error: message,
    code: httpStatus,
  };
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

export function generateTaskId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `t_${timestamp}${random}`;
}

export function parseUrls(content: string): string[] {
  return content
    .split(/[\n\r]+/)
    .map((line) => line.trim())
    .filter((line) => line && isValidUrl(line));
}

export function isValidUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function parseCsv(content: string): string[] {
  const lines = content.split(/[\n\r]+/).filter((line) => line.trim());
  if (lines.length === 0) return [];

  const urls: string[] = [];
  const header = lines[0].toLowerCase();
  const hasHeader = header.includes("url");

  let urlColumnIndex = 0;
  if (hasHeader) {
    const columns = header.split(",").map((c) => c.trim());
    urlColumnIndex = columns.findIndex((c) => c === "url");
    if (urlColumnIndex === -1) urlColumnIndex = 0;
  }

  const dataLines = hasHeader ? lines.slice(1) : lines;

  for (const line of dataLines) {
    const columns = line.split(",").map((c) => c.trim().replace(/^["']|["']$/g, ""));
    const url = columns[urlColumnIndex];
    if (url && isValidUrl(url)) {
      urls.push(url);
    }
  }

  return urls;
}

export function parseJsonUrls(content: string): string[] {
  try {
    const data = JSON.parse(content);
    if (Array.isArray(data)) {
      return data
        .map((item) => {
          if (typeof item === "string") return item;
          if (typeof item === "object" && item.url) return item.url;
          return null;
        })
        .filter((url): url is string => url !== null && isValidUrl(url));
    }
    return [];
  } catch {
    return [];
  }
}

export function detectFileTypeAndParse(
  content: string,
  filename?: string,
): string[] {
  const ext = filename?.split(".").pop()?.toLowerCase();

  switch (ext) {
    case "json":
      return parseJsonUrls(content);
    case "csv":
      return parseCsv(content);
    case "txt":
    default:
      return parseUrls(content);
  }
}
