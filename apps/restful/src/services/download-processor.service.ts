import { provide } from "@inversifyjs/binding-decorators";
import { inject, injectable } from "inversify";
import { DownloadType } from "@mediago/shared-common";
import { BatchTaskService } from "./batch-task.service";
import { StorageService } from "./storage.service";
import { MediaGoClient } from "./mediago-client.service";
import Logger from "./logger.service";
import { DOWNLOAD_DIR, MAX_CONCURRENT_DOWNLOADS } from "../constants";
import { ApiError } from "../types";
import type { BatchTaskItem } from "../entity";

@injectable()
@provide()
export class DownloadProcessorService {
  private processingTasks = new Map<string, boolean>();
  private activeDownloads = 0;

  constructor(
    @inject(Logger)
    private readonly logger: Logger,
    @inject(BatchTaskService)
    private readonly batchTaskService: BatchTaskService,
    @inject(StorageService)
    private readonly storageService: StorageService,
    @inject(MediaGoClient)
    private readonly client: MediaGoClient,
  ) {}

  init(): void {
    this.setupDownloaderEvents();
    this.logger.info("Download processor service initialized (Go backend)");
  }

  private setupDownloaderEvents(): void {
    this.client.on("download-success", async (taskId: number | string) => {
      this.logger.info(`download-success event for task ${taskId}`);
      try {
        await this.handleDownloadComplete(Number(taskId), true);
      } catch (err) {
        this.logger.error("Error in download-success handler:", err);
      }
    });

    this.client.on("download-failed", async (taskId: number | string) => {
      this.logger.info(`download-failed event for task ${taskId}`);
      try {
        await this.handleDownloadComplete(Number(taskId), false);
      } catch (err) {
        this.logger.error("Error in download-failed handler:", err);
      }
    });
  }

  private async handleDownloadComplete(
    downloadTaskId: number,
    success: boolean,
  ): Promise<void> {
    this.activeDownloads = Math.max(0, this.activeDownloads - 1);

    try {
      const task = await this.client.getDownload(downloadTaskId);
      if (!task) return;

      const batchTaskId = task.folder;
      if (!batchTaskId) return;

      const items = await this.batchTaskService.getTaskItems(batchTaskId);
      const item = items.find(
        (i) => i.download_task_id !== null && Number(i.download_task_id) === downloadTaskId,
      );

      if (item) {
        const fileSize = success
          ? await this.getFileSize(task.name, batchTaskId)
          : 0;

        await this.batchTaskService.updateItemStatus(
          item.id,
          success ? "completed" : "failed",
          {
            filename: success ? `${task.name}.mp4` : null,
            size_bytes: fileSize,
            title: task.name,
            error: success ? null : "Download failed",
          },
        );

        await this.batchTaskService.incrementTaskProgress(
          batchTaskId,
          success ? 1 : 0,
          success ? 0 : 1,
          fileSize,
        );
      }

      this.processNextInQueue(batchTaskId);
    } catch (error) {
      this.logger.error("Error handling download complete", error);
    }
  }

  private async getFileSize(name: string, taskId: string): Promise<number> {
    try {
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      const { glob } = await import("glob");
      const taskDir = path.join(DOWNLOAD_DIR, taskId);
      const files = await glob(`${name}.*`, { cwd: taskDir });
      if (files.length > 0) {
        const stat = await fs.stat(path.join(taskDir, files[0]));
        return stat.size;
      }
    } catch {
      // ignore
    }
    return 0;
  }

  async startBatchTask(taskId: string): Promise<void> {
    if (this.processingTasks.get(taskId)) return;

    const hasStorage = await this.storageService.checkStorageAvailable();
    if (!hasStorage) {
      throw new ApiError("storage_full", "Storage space is full", 507);
    }

    this.processingTasks.set(taskId, true);
    await this.batchTaskService.updateTaskStatus(taskId, "running");
    this.logger.info(`Starting batch task ${taskId}`);
    this.processNextInQueue(taskId).catch((err) => {
      this.logger.error(`Error processing batch task ${taskId}:`, err);
    });
  }

  private async processNextInQueue(taskId: string): Promise<void> {
    this.logger.info(
      `Processing queue for ${taskId}, active: ${this.activeDownloads}`,
    );

    if (!this.processingTasks.get(taskId)) return;
    if (this.activeDownloads >= MAX_CONCURRENT_DOWNLOADS) return;

    const pendingItems = await this.batchTaskService.getPendingItems(taskId);
    if (pendingItems.length === 0) {
      this.processingTasks.delete(taskId);
      return;
    }

    const item = pendingItems[0];
    await this.downloadItem(taskId, item);

    if (pendingItems.length > 1) {
      setTimeout(() => {
        this.processNextInQueue(taskId).catch((err) => {
          this.logger.error("processNextInQueue error:", err);
        });
      }, 100);
    }
  }

  private async downloadItem(taskId: string, item: BatchTaskItem): Promise<void> {
    try {
      this.activeDownloads++;
      await this.batchTaskService.updateItemStatus(item.id, "downloading");

      let title: string;
      try {
        title = await this.client.getPageTitle(item.url);
      } catch {
        title = `video_${item.id}`;
      }
      if (!title) title = `video_${item.id}`;

      const downloadType = this.detectDownloadType(item.url);
      const taskDir = await this.storageService.getTaskDirectory(taskId);

      // Create persistent download in Go backend, using folder = taskId for correlation
      const goTask = await this.client.createDownload({
        name: title,
        url: item.url,
        type: downloadType,
        folder: taskId,
        startDownload: true,
      });

      await this.batchTaskService.setItemDownloadTaskId(item.id, goTask.id);
      this.logger.info(
        `Created Go download task ${goTask.id} → batch item ${item.id} in ${taskDir}`,
      );
    } catch (error) {
      this.activeDownloads = Math.max(0, this.activeDownloads - 1);
      this.logger.error(`Failed to download item ${item.id}:`, error);

      await this.batchTaskService.updateItemStatus(item.id, "failed", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
      await this.batchTaskService.incrementTaskProgress(taskId, 0, 1, 0);
      this.processNextInQueue(taskId).catch((err) => {
        this.logger.error("processNextInQueue error after failure:", err);
      });
    }
  }

  private detectDownloadType(url: string): string {
    if (url.includes("bilibili.com")) return DownloadType.bilibili;
    if (url.includes("youtube.com") || url.includes("youtu.be"))
      return DownloadType.youtube;
    if (url.includes(".m3u8")) return DownloadType.m3u8;
    return DownloadType.direct;
  }

  async downloadSingleVideo(url: string): Promise<{ filename: string }> {
    const type = this.detectDownloadType(url);
    let title: string;
    try {
      title = await this.client.getPageTitle(url);
    } catch {
      title = `download_${Date.now()}`;
    }
    if (!title) title = `download_${Date.now()}`;

    const goTask = await this.client.createDownload({
      name: title,
      url,
      type,
      startDownload: true,
    });
    return { filename: `${goTask.name ?? title}.mp4` };
  }

  stopBatchTask(taskId: string): void {
    this.processingTasks.delete(taskId);
    this.logger.info(`Stopped batch task ${taskId}`);
  }
}
