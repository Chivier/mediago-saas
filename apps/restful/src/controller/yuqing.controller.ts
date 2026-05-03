/**
 * Yuqing-specific controller — 单源 URL 异步下载 + 可选 audio_only ffmpeg 抽取
 *
 * 设计目标: yuqing (舆情系统) 调 mediago 把 m3u8 / Bilibili stream URL 转成本地 mp4/mp3,
 * 走 url-in / poll / file-out 模式; 不走 mediago 的 batch task / UI 流程, 避免侵入。
 *
 * 端点 (PRIVATE_KEY auth 由全局 middleware 处理):
 *   POST /api/yuqing/download              {url, audio_only?, hint_title?}  → {task_id}
 *   GET  /api/yuqing/jobs/:task_id          → {status, video_path?, audio_path?, error?}
 *   GET  /api/yuqing/jobs/:task_id/file?type=video|audio   → 流式下载文件
 *
 * 状态机: queued → downloading → done | failed (audio_only 在 done 之前还有 extracting)
 */

import { provide } from "@inversifyjs/binding-decorators";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { inject, injectable } from "inversify";
import type Router from "@koa/router";
import { DownloadType } from "@mediago/shared-common";
import Logger from "../services/logger.service";
import { MediaGoClient } from "../services/mediago-client.service";
import { ApiError } from "../types";
import { success, isValidUrl } from "../utils";
import { DOWNLOAD_DIR } from "../constants";

type JobStatus =
  | "queued"
  | "downloading"
  | "extracting"
  | "done"
  | "failed";

interface YuqingJob {
  task_id: string;
  url: string;
  audio_only: boolean;
  status: JobStatus;
  download_task_id?: number;
  video_path?: string;
  audio_path?: string;
  file_size?: number;
  error?: string;
  created_at: number;
  updated_at: number;
}

@injectable()
@provide()
export default class YuqingController {
  private jobs = new Map<string, YuqingJob>();
  // Go download ID → yuqing task_id reverse lookup
  private dlTaskToJob = new Map<number, string>();

  constructor(
    @inject(Logger)
    private readonly logger: Logger,
    @inject(MediaGoClient)
    private readonly client: MediaGoClient,
  ) {
    this.subscribeEvents();
  }

  private subscribeEvents(): void {
    this.client.on("download-success", async (downloadTaskId: number | string) => {
      const yuqingTaskId = this.dlTaskToJob.get(Number(downloadTaskId));
      if (!yuqingTaskId) return;
      await this.onDownloadComplete(yuqingTaskId, true);
    });
    this.client.on("download-failed", async (downloadTaskId: number | string) => {
      const yuqingTaskId = this.dlTaskToJob.get(Number(downloadTaskId));
      if (!yuqingTaskId) return;
      await this.onDownloadComplete(yuqingTaskId, false);
    });
  }

  register(router: Router): void {
    // POST /api/yuqing/download
    router.post("/yuqing/download", async (ctx) => {
      const body = ctx.request.body as {
        url?: string;
        audio_only?: boolean;
        hint_title?: string;
      };
      if (!body?.url || !isValidUrl(body.url)) {
        throw new ApiError("invalid_url", "valid url required", 400);
      }

      const task_id = randomUUID();
      const job: YuqingJob = {
        task_id,
        url: body.url,
        audio_only: !!body.audio_only,
        status: "queued",
        created_at: Date.now(),
        updated_at: Date.now(),
      };
      this.jobs.set(task_id, job);

      // start async; don't await
      this.startDownload(job, body.hint_title).catch((err) => {
        this.logger.error(`yuqing job ${task_id} start error:`, err);
        this.markFailed(task_id, err instanceof Error ? err.message : String(err));
      });

      ctx.body = success({
        task_id,
        status: job.status,
        status_url: `/api/yuqing/jobs/${task_id}`,
      });
    });

    // GET /api/yuqing/jobs/:task_id
    router.get("/yuqing/jobs/:task_id", async (ctx) => {
      const job = this.jobs.get(ctx.params.task_id);
      if (!job) throw new ApiError("not_found", `job ${ctx.params.task_id} not found`, 404);
      ctx.body = success(this.publicJob(job));
    });

    // GET /api/yuqing/jobs/:task_id/file?type=video|audio
    router.get("/yuqing/jobs/:task_id/file", async (ctx) => {
      const job = this.jobs.get(ctx.params.task_id);
      if (!job) throw new ApiError("not_found", `job ${ctx.params.task_id} not found`, 404);
      if (job.status !== "done") {
        throw new ApiError("not_ready", `job status=${job.status}`, 409);
      }
      const type = (ctx.query.type as string) || (job.audio_only ? "audio" : "video");
      const filePath = type === "audio" ? job.audio_path : job.video_path;
      if (!filePath) throw new ApiError("no_file", `no ${type} file for job`, 404);
      try {
        const st = await stat(filePath);
        ctx.set("Content-Length", String(st.size));
        ctx.set("Content-Type", type === "audio" ? "audio/mpeg" : "video/mp4");
        ctx.set("Content-Disposition", `attachment; filename="${path.basename(filePath)}"`);
        ctx.body = createReadStream(filePath);
      } catch (err) {
        throw new ApiError("file_missing", `file gone: ${err}`, 410);
      }
    });
  }

  // ==================== internals ====================

  private async startDownload(job: YuqingJob, hintTitle?: string): Promise<void> {
    job.status = "downloading";
    job.updated_at = Date.now();

    let title: string;
    try {
      title = hintTitle || (await this.client.getPageTitle(job.url)) || `yuqing_${job.task_id.slice(0, 8)}`;
    } catch {
      title = `yuqing_${job.task_id.slice(0, 8)}`;
    }

    const downloadType = job.url.includes("bilibili.com")
      ? DownloadType.bilibili
      : DownloadType.m3u8;

    const goTask = await this.client.createDownload({
      name: title,
      url: job.url,
      type: downloadType,
      folder: "_yuqing",
      startDownload: true,
    });

    job.download_task_id = goTask.id;
    this.dlTaskToJob.set(goTask.id, job.task_id);
    this.logger.info(`[yuqing] job ${job.task_id} → Go task ${goTask.id} (${title})`);
  }

  private async onDownloadComplete(yuqingTaskId: string, success: boolean): Promise<void> {
    const job = this.jobs.get(yuqingTaskId);
    if (!job) return;
    if (job.download_task_id) this.dlTaskToJob.delete(job.download_task_id);

    if (!success) {
      this.markFailed(yuqingTaskId, "download failed");
      return;
    }

    // 找文件 (mediago 把文件放在 DOWNLOAD_DIR/_yuqing/<name>.mp4)
    try {
      const dt = await this.client.getDownload(job.download_task_id!);
      if (!dt) {
        this.markFailed(yuqingTaskId, "download task disappeared");
        return;
      }
      const taskDir = path.join(DOWNLOAD_DIR, "_yuqing");
      const candidate = path.join(taskDir, `${dt.name}.mp4`);
      const st = await stat(candidate).catch(() => null);
      if (!st) {
        this.markFailed(yuqingTaskId, `expected file not found: ${candidate}`);
        return;
      }
      job.video_path = candidate;
      job.file_size = st.size;
      job.updated_at = Date.now();

      if (job.audio_only) {
        job.status = "extracting";
        try {
          const audioPath = await this.extractAudio(candidate);
          job.audio_path = audioPath;
        } catch (err) {
          this.logger.error(`[yuqing] ffmpeg extract failed for ${yuqingTaskId}:`, err);
          this.markFailed(yuqingTaskId, `ffmpeg failed: ${err}`);
          return;
        }
      }

      job.status = "done";
      job.updated_at = Date.now();
      this.logger.info(`[yuqing] job ${yuqingTaskId} done video=${!!job.video_path} audio=${!!job.audio_path}`);
    } catch (err) {
      this.markFailed(yuqingTaskId, err instanceof Error ? err.message : String(err));
    }
  }

  private extractAudio(videoPath: string): Promise<string> {
    const audioPath = videoPath.replace(/\.mp4$/i, ".mp3");
    return new Promise((resolve, reject) => {
      const ff = spawn(
        "ffmpeg",
        ["-y", "-i", videoPath, "-vn", "-acodec", "libmp3lame", "-q:a", "4", audioPath],
        { stdio: ["ignore", "ignore", "pipe"] },
      );
      let stderr = "";
      ff.stderr.on("data", (d) => { stderr += d.toString(); });
      ff.on("error", reject);
      ff.on("close", (code) => {
        if (code === 0) resolve(audioPath);
        else reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(-500)}`));
      });
    });
  }

  private markFailed(taskId: string, error: string): void {
    const job = this.jobs.get(taskId);
    if (!job) return;
    job.status = "failed";
    job.error = error;
    job.updated_at = Date.now();
  }

  private publicJob(j: YuqingJob): Record<string, unknown> {
    return {
      task_id: j.task_id,
      url: j.url,
      audio_only: j.audio_only,
      status: j.status,
      file_size: j.file_size,
      error: j.error,
      created_at: new Date(j.created_at).toISOString(),
      updated_at: new Date(j.updated_at).toISOString(),
      // 文件路径**不**返回; 客户端用 /file?type=video|audio 拉
      has_video: !!j.video_path,
      has_audio: !!j.audio_path,
    };
  }
}
