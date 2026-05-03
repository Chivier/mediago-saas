import { provide } from "@inversifyjs/binding-decorators";
import { inject, injectable } from "inversify";
import {
  DownloaderServer,
  DownloadTaskService,
  getPageTitle,
} from "@mediago/shared-node";
import { DownloadStatus, DownloadType } from "@mediago/shared-common";
import { BatchTaskService } from "./batch-task.service";
import { StorageService } from "./storage.service";
import Logger from "./logger.service";
import { DOWNLOAD_DIR, MAX_CONCURRENT_DOWNLOADS, MAX_CONCURRENT_TASKS, LOG_DIR } from "../constants";
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
    @inject(DownloaderServer)
    private readonly downloaderServer: DownloaderServer,
    @inject(DownloadTaskService)
    private readonly downloadTaskService: DownloadTaskService,
  ) {
    this.setupDownloaderEvents();
  }

  init(): void {
    this.downloaderServer.start({
      logDir: LOG_DIR,
      localDir: DOWNLOAD_DIR,
      deleteSegments: true,
      proxy: process.env.PROXY || "",
      useProxy: !!process.env.PROXY,
      maxRunner: MAX_CONCURRENT_DOWNLOADS,
    });
    this.logger.info("Download processor service initialized");
  }

  private setupDownloaderEvents(): void {
    this.downloaderServer.on("download-success", async (taskId: number) => {
      this.logger.info(`Download success event received for task ${taskId}`);
      try {
        await this.handleDownloadComplete(taskId, true);
      } catch (err) {
        this.logger.error(`Error in download-success handler:`, err);
      }
    });

    this.downloaderServer.on("download-failed", async (taskId: number) => {
      this.logger.info(`Download failed event received for task ${taskId}`);
      try {
        await this.handleDownloadComplete(taskId, false);
      } catch (err) {
        this.logger.error(`Error in download-failed handler:`, err);
      }
    });
  }

  private async handleDownloadComplete(
    downloadTaskId: number,
    success: boolean,
  ): Promise<void> {
    this.activeDownloads = Math.max(0, this.activeDownloads - 1);

    try {
      const task = await this.downloadTaskService.findById(downloadTaskId);
      if (!task) return;

      // Find the batch task item associated with this download
      // The folder field contains the batch task ID
      const batchTaskId = task.folder;
      if (!batchTaskId) return;

      const items = await this.batchTaskService.getTaskItems(batchTaskId);
      // Convert both to numbers for comparison since event passes string but DB stores number
      const item = items.find((i) => i.download_task_id !== null && Number(i.download_task_id) === Number(downloadTaskId));

      if (item) {
        const fileSize = success ? await this.getFileSize(task.name, batchTaskId) : 0;

        await this.batchTaskService.updateItemStatus(item.id, success ? "completed" : "failed", {
          filename: success ? `${task.name}.mp4` : null,
          size_bytes: fileSize,
          title: task.name,
          error: success ? null : "Download failed",
        });
        this.logger.info(`Download ${success ? "completed" : "failed"} for item ${item.id}`);

        await this.batchTaskService.incrementTaskProgress(
          batchTaskId,
          success ? 1 : 0,
          success ? 0 : 1,
          fileSize,
        );
        this.logger.info(`Incremented task progress for ${batchTaskId}`);
      }

      // Process next item in queue
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
      // Ignore errors
    }
    return 0;
  }

  async startBatchTask(taskId: string): Promise<void> {
    if (this.processingTasks.get(taskId)) {
      return;
    }

    const hasStorage = await this.storageService.checkStorageAvailable();
    if (!hasStorage) {
      throw new ApiError("storage_full", "Storage space is full", 507);
    }

    this.processingTasks.set(taskId, true);
    await this.batchTaskService.updateTaskStatus(taskId, "running");

    this.logger.info(`Starting batch task ${taskId}`);

    // Process queue with proper error handling
    this.processNextInQueue(taskId).catch((err) => {
      this.logger.error(`Error processing batch task ${taskId}:`, err);
    });
  }

  private async processNextInQueue(taskId: string): Promise<void> {
    this.logger.info(`Processing queue for task ${taskId}, active downloads: ${this.activeDownloads}`);

    if (!this.processingTasks.get(taskId)) {
      this.logger.info(`Task ${taskId} is not in processing state`);
      return;
    }

    if (this.activeDownloads >= MAX_CONCURRENT_DOWNLOADS) {
      this.logger.info(`Max concurrent downloads reached (${MAX_CONCURRENT_DOWNLOADS})`);
      return;
    }

    const pendingItems = await this.batchTaskService.getPendingItems(taskId);
    this.logger.info(`Found ${pendingItems.length} pending items for task ${taskId}`);

    if (pendingItems.length === 0) {
      this.processingTasks.delete(taskId);
      this.logger.info(`No pending items, task ${taskId} complete`);
      return;
    }

    const item = pendingItems[0];
    this.logger.info(`Starting download for item ${item.id}: ${item.url}`);
    await this.downloadItem(taskId, item);

    // Schedule next item
    if (pendingItems.length > 1) {
      setTimeout(() => this.processNextInQueue(taskId).catch((err) => {
        this.logger.error(`Error in processNextInQueue:`, err);
      }), 100);
    }
  }

  private async downloadItem(taskId: string, item: BatchTaskItem): Promise<void> {
    try {
      this.activeDownloads++;
      this.logger.info(`Download item ${item.id} started, active downloads: ${this.activeDownloads}`);

      await this.batchTaskService.updateItemStatus(item.id, "downloading");

      // Get video title
      let title: string;
      try {
        this.logger.info(`Getting page title for: ${item.url}`);
        title = await getPageTitle(item.url);
        this.logger.info(`Got title: ${title}`);
      } catch (err) {
        this.logger.warn(`Failed to get page title: ${err}`);
        title = `video_${item.id}`;
      }

      // Create download task in the main service
      const downloadType = this.detectDownloadType(item.url);
      this.logger.info(`Creating download task with type: ${downloadType}`);

      const downloadTask = await this.downloadTaskService.addDownloadTask({
        name: title,
        url: item.url,
        type: downloadType,
        folder: taskId,
        headers: "",
        status: DownloadStatus.Watting,
        isLive: false,
        createdDate: new Date(),
        duration: null,
      });
      this.logger.info(`Created download task: ${downloadTask.id}`);

      // Store the download task ID for later reference
      await this.batchTaskService.setItemDownloadTaskId(item.id, downloadTask.id);

      // Start the actual download
      const taskDir = await this.storageService.getTaskDirectory(taskId);
      this.logger.info(`Starting download to directory: ${taskDir}`);
      await this.downloadTaskService.startDownload(downloadTask.id, taskDir, true);
      this.logger.info(`Download started for task ${downloadTask.id}`);

    } catch (error) {
      this.activeDownloads = Math.max(0, this.activeDownloads - 1);

      this.logger.error(`Failed to download item ${item.id}:`, error);

      await this.batchTaskService.updateItemStatus(item.id, "failed", {
        error: error instanceof Error ? error.message : "Unknown error",
      });

      await this.batchTaskService.incrementTaskProgress(taskId, 0, 1, 0);

      // Continue processing
      this.processNextInQueue(taskId).catch((err) => {
        this.logger.error(`Error continuing queue:`, err);
      });
    }
  }

  private detectDownloadType(url: string): DownloadType {
    if (url.includes("bilibili.com")) {
      return DownloadType.bilibili;
    }
    if (url.includes("m3u8")) {
      return DownloadType.m3u8;
    }
    return DownloadType.m3u8; // Default to m3u8
  }

  async downloadSingleVideo(url: string): Promise<{ stream: any; filename: string }> {
    const downloadType = this.detectDownloadType(url);

    let title: string;
    try {
      title = await getPageTitle(url);
    } catch {
      title = `download_${Date.now()}`;
    }

    // Create a temporary task
    const downloadTask = await this.downloadTaskService.addDownloadTask({
      name: title,
      url,
      type: downloadType,
      folder: "",
      headers: "",
      status: DownloadStatus.Watting,
      isLive: false,
      createdDate: new Date(),
      duration: null,
    });

    // Start download and wait for completion
    await this.downloadTaskService.startDownload(downloadTask.id, DOWNLOAD_DIR, true);

    // This is a simplified version - in production, you'd want to stream the file
    // as it downloads or wait for completion
    return {
      stream: null,
      filename: `${title}.mp4`,
    };
  }

  stopBatchTask(taskId: string): void {
    this.processingTasks.delete(taskId);
    this.logger.info(`Stopped batch task ${taskId}`);
  }
}
