import { provide } from "@inversifyjs/binding-decorators";
import { injectable } from "inversify";
import axios, { type AxiosInstance } from "axios";
import { EventEmitter } from "node:events";
import { MEDIAGO_BASE_URL } from "../constants";
import Logger from "./logger.service";
import { inject } from "inversify";

export interface GoDownloadTask {
  id: number;
  name: string;
  url: string;
  type: string;
  folder?: string;
  headers?: string;
  status: string;
  log?: string;
  createdDate?: string;
  updatedDate?: string;
}

export interface CreateDownloadInput {
  name?: string;
  url: string;
  type: string;
  folder?: string;
  headers?: string;
  startDownload?: boolean;
}

export interface GoTaskQueueItem {
  id: string;
  name: string;
  url: string;
  type: string;
  status: string;
  log?: string;
}

/**
 * HTTP client that wraps the Go backend API (apps/core running at MEDIAGO_BASE_URL).
 * Replaces the removed @mediago/shared-node DownloaderServer + DownloadTaskService.
 */
@injectable()
@provide()
export class MediaGoClient extends EventEmitter {
  private http: AxiosInstance;

  constructor(
    @inject(Logger)
    private readonly logger: Logger,
  ) {
    super();
    this.http = axios.create({
      baseURL: MEDIAGO_BASE_URL,
      timeout: 30_000,
    });
  }

  // ── Persistent download tasks (require Go backend with --db-path) ──────────

  async createDownload(input: CreateDownloadInput): Promise<GoDownloadTask> {
    const res = await this.http.post("/api/downloads", {
      tasks: [
        {
          name: input.name || "",
          url: input.url,
          type: input.type,
          folder: input.folder || "",
          headers: input.headers || "",
        },
      ],
      startDownload: input.startDownload ?? true,
    });
    const data = res.data?.data;
    return Array.isArray(data) ? data[0] : data;
  }

  async getDownload(id: number): Promise<GoDownloadTask> {
    const res = await this.http.get(`/api/downloads/${id}`);
    return res.data?.data;
  }

  async startDownload(id: number): Promise<void> {
    await this.http.post(`/api/downloads/${id}/start`);
  }

  async stopDownload(id: number): Promise<void> {
    await this.http.post(`/api/downloads/${id}/stop`);
  }

  async listDownloads(folder?: string): Promise<GoDownloadTask[]> {
    const params: Record<string, string> = {};
    if (folder) params.folder = folder;
    const res = await this.http.get("/api/downloads", { params });
    return res.data?.data?.list ?? res.data?.data ?? [];
  }

  // ── Queue-only tasks (no DB required) ─────────────────────────────────────

  async createTask(input: {
    url: string;
    type: string;
    name?: string;
    folder?: string;
    headers?: string;
  }): Promise<{ id: string; status: string }> {
    const res = await this.http.post("/api/tasks", {
      url: input.url,
      type: input.type,
      name: input.name || "",
      folder: input.folder || "",
      headers: input.headers || "",
    });
    return res.data?.data;
  }

  async getTask(id: string): Promise<GoTaskQueueItem> {
    const res = await this.http.get(`/api/tasks/${id}`);
    return res.data?.data;
  }

  async stopTask(id: string): Promise<void> {
    await this.http.post(`/api/tasks/${id}/stop`);
  }

  async getTaskLogs(id: string): Promise<string> {
    const res = await this.http.get(`/api/tasks/${id}/logs`);
    return res.data?.data ?? "";
  }

  // ── Utility ───────────────────────────────────────────────────────────────

  async getPageTitle(url: string): Promise<string> {
    try {
      const res = await this.http.get("/api/url/title", {
        params: { url },
        timeout: 10_000,
      });
      return res.data?.data?.title ?? "";
    } catch {
      return "";
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await this.http.get("/healthy", { timeout: 3_000 });
      return res.status === 200;
    } catch {
      return false;
    }
  }

  /**
   * Subscribe to the Go backend's SSE event stream and re-emit relevant events.
   * Reconnects automatically on failure (best-effort, non-blocking).
   */
  startEventStream(): void {
    this.connectSSE().catch((err) => {
      this.logger.warn("SSE initial connect failed, will retry", err?.message);
    });
  }

  private async connectSSE(retryDelay = 3000): Promise<void> {
    try {
      const response = await this.http.get("/api/events", {
        responseType: "stream",
        timeout: 0, // no timeout for SSE
      });

      const stream = response.data as NodeJS.ReadableStream;
      let buf = "";

      stream.on("data", (chunk: Buffer) => {
        buf += chunk.toString();
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";

        for (const line of lines) {
          this.parseSseLine(line.trim());
        }
      });

      stream.on("end", () => {
        this.logger.warn("SSE stream ended, reconnecting...");
        setTimeout(() => this.connectSSE(retryDelay), retryDelay);
      });

      stream.on("error", (err) => {
        this.logger.warn("SSE stream error, reconnecting...", err.message);
        setTimeout(() => this.connectSSE(retryDelay), retryDelay);
      });
    } catch (err: any) {
      this.logger.warn("SSE connect error, retrying...", err?.message);
      setTimeout(() => this.connectSSE(Math.min(retryDelay * 2, 30_000)), retryDelay);
    }
  }

  private parseSseLine(line: string): void {
    if (!line.startsWith("data:")) return;
    try {
      const payload = JSON.parse(line.slice(5).trim());
      const eventName = payload.event ?? payload.type ?? "message";
      // Re-emit using the same event names the old DownloaderServer used so
      // existing handlers (yuqing controller, download-processor) need minimal changes.
      if (eventName === "download-success" || eventName === "downloadSuccess") {
        this.emit("download-success", payload.id ?? payload.taskId);
      } else if (eventName === "download-failed" || eventName === "downloadFailed") {
        this.emit("download-failed", payload.id ?? payload.taskId);
      } else {
        this.emit(eventName, payload);
      }
    } catch {
      // Ignore malformed SSE lines
    }
  }
}
