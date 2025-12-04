import { provide } from "@inversifyjs/binding-decorators";
import { inject, injectable } from "inversify";
import type Router from "@koa/router";
import multer from "@koa/multer";
import { BatchTaskService } from "../services/batch-task.service";
import { DownloadProcessorService } from "../services/download-processor.service";
import { StorageService } from "../services/storage.service";
import { ApiError, type BatchTaskStatus, type CleanupRequest } from "../types";
import { success, isValidUrl, detectFileTypeAndParse } from "../utils";
import Logger from "../services/logger.service";
import { TEMP_DIR } from "../constants";
import fs from "node:fs/promises";

const upload = multer({ dest: TEMP_DIR });

@injectable()
@provide()
export default class TaskController {
  constructor(
    @inject(BatchTaskService)
    private readonly batchTaskService: BatchTaskService,
    @inject(DownloadProcessorService)
    private readonly downloadProcessor: DownloadProcessorService,
    @inject(StorageService)
    private readonly storageService: StorageService,
    @inject(Logger)
    private readonly logger: Logger,
  ) {}

  register(router: Router): void {
    // POST /api/tasks - Create batch task
    router.post("/tasks", upload.single("file"), async (ctx) => {
      let urls: string[] = [];
      let name = "Batch Download";

      // Handle file upload
      if (ctx.file) {
        const fileContent = await fs.readFile(ctx.file.path, "utf-8");
        urls = detectFileTypeAndParse(fileContent, ctx.file.originalname);
        name = (ctx.request.body as any)?.name || ctx.file.originalname || name;

        // Clean up temp file
        await fs.unlink(ctx.file.path).catch(() => {});
      } else {
        // Handle JSON body
        const body = ctx.request.body as { name?: string; urls?: string[] };
        name = body.name || name;
        urls = body.urls || [];
      }

      // Validate URLs
      urls = urls.filter((url) => isValidUrl(url));

      if (urls.length === 0) {
        throw new ApiError("empty_urls", "No valid URLs provided", 400);
      }

      // Check storage
      const hasStorage = await this.storageService.checkStorageAvailable();
      if (!hasStorage) {
        throw new ApiError("storage_full", "Storage space is full", 507);
      }

      this.logger.info(`Creating batch task with ${urls.length} URLs`);

      const task = await this.batchTaskService.createTask(name, urls);

      // Start processing in background
      this.downloadProcessor.startBatchTask(task.task_id).catch((err) => {
        this.logger.error("Failed to start batch task:", err);
      });

      ctx.status = 201;
      ctx.body = success({
        task_id: task.task_id,
        name: task.name,
        status: task.status,
        total: task.total,
        created_at: task.created_at.toISOString(),
      });
    });

    // GET /api/tasks - List tasks
    router.get("/tasks", async (ctx) => {
      const status = ctx.query.status as BatchTaskStatus | undefined;
      const limit = Math.min(parseInt(ctx.query.limit as string) || 20, 100);
      const offset = parseInt(ctx.query.offset as string) || 0;

      const { tasks, total } = await this.batchTaskService.listTasks(
        status,
        limit,
        offset,
      );

      ctx.body = success({
        tasks: tasks.map((task) => ({
          task_id: task.task_id,
          name: task.name,
          status: task.status,
          total: task.total,
          completed: task.completed,
          failed: task.failed,
          progress: task.progress,
          created_at: task.created_at.toISOString(),
        })),
        total,
        limit,
        offset,
      });
    });

    // GET /api/tasks/:taskId - Get task details
    router.get("/tasks/:taskId", async (ctx) => {
      const { taskId } = ctx.params;

      const task = await this.batchTaskService.getTask(taskId, true);

      ctx.body = success({
        task_id: task.task_id,
        name: task.name,
        status: task.status,
        total: task.total,
        completed: task.completed,
        failed: task.failed,
        progress: task.progress,
        size_bytes: Number(task.size_bytes),
        created_at: task.created_at.toISOString(),
        updated_at: task.updated_at.toISOString(),
        items: task.items?.map((item) => ({
          url: item.url,
          title: item.title,
          status: item.status,
          progress: item.progress,
          filename: item.filename,
          size_bytes: item.size_bytes ? Number(item.size_bytes) : null,
          error: item.error,
        })),
      });
    });

    // GET /api/tasks/:taskId/download - Download task as ZIP
    router.get("/tasks/:taskId/download", async (ctx) => {
      const { taskId } = ctx.params;

      const task = await this.batchTaskService.getTask(taskId);

      if (task.status !== "completed" && task.status !== "partial") {
        throw new ApiError(
          "task_not_ready",
          "Task is not ready for download",
          409,
        );
      }

      this.logger.info(`Downloading task ${taskId} as ZIP`);

      const { stream, filename } = await this.storageService.createZipStream(taskId);

      ctx.set("Content-Type", "application/zip");
      ctx.set(
        "Content-Disposition",
        `attachment; filename="${encodeURIComponent(task.name)}.zip"`,
      );
      ctx.body = stream;
    });

    // DELETE /api/tasks/:taskId - Delete task
    router.delete("/tasks/:taskId", async (ctx) => {
      const { taskId } = ctx.params;
      const keepFiles = ctx.query.keep_files === "true";

      // Stop processing if running
      this.downloadProcessor.stopBatchTask(taskId);

      // Delete files unless keep_files is true
      let freedBytes = 0;
      if (!keepFiles) {
        freedBytes = await this.storageService.deleteTaskFiles(taskId);
      }

      // Delete from database
      const result = await this.batchTaskService.deleteTask(taskId);

      ctx.body = success({
        task_id: taskId,
        deleted: true,
        freed_bytes: freedBytes || result.freed_bytes,
      });
    });

    // POST /api/tasks/cleanup - Batch cleanup tasks
    router.post("/tasks/cleanup", async (ctx) => {
      const body = ctx.request.body as CleanupRequest;

      const before = body.before ? new Date(body.before) : new Date();
      const statuses = body.status || ["completed", "failed"];

      let totalFreedBytes = 0;
      let deletedCount = 0;

      // Get tasks to delete
      for (const status of statuses) {
        const { tasks } = await this.batchTaskService.listTasks(
          status as BatchTaskStatus,
          1000,
          0,
        );

        for (const task of tasks) {
          if (new Date(task.created_at) < before) {
            const freedBytes = await this.storageService.deleteTaskFiles(
              task.task_id,
            );
            await this.batchTaskService.deleteTask(task.task_id);
            totalFreedBytes += freedBytes;
            deletedCount++;
          }
        }
      }

      this.logger.info(
        `Cleaned up ${deletedCount} tasks, freed ${totalFreedBytes} bytes`,
      );

      ctx.body = success({
        deleted_count: deletedCount,
        freed_bytes: totalFreedBytes,
      });
    });
  }
}
