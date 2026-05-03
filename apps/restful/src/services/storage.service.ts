import { provide } from "@inversifyjs/binding-decorators";
import { inject, injectable } from "inversify";
import { DataSource, Repository } from "typeorm";
import fs from "node:fs/promises";
import path from "node:path";
import { glob } from "glob";
import { StorageConfigEntity } from "../entity";
import { DOWNLOAD_DIR, STORAGE_MAX_BYTES, AUTO_CLEANUP, AUTO_CLEANUP_DAYS } from "../constants";
import Logger from "./logger.service";
import type { StorageStatus, StorageConfig } from "../types";

@injectable()
@provide()
export class StorageService {
  private configRepository!: Repository<StorageConfigEntity>;
  private config!: StorageConfigEntity;

  constructor(
    @inject(Logger)
    private readonly logger: Logger,
  ) {}

  async init(dataSource: DataSource) {
    this.configRepository = dataSource.getRepository(StorageConfigEntity);

    // Initialize or load config
    let config = await this.configRepository.findOne({
      where: { id: "default" },
    });

    if (!config) {
      config = this.configRepository.create({
        id: "default",
        max_bytes: STORAGE_MAX_BYTES,
        auto_cleanup: AUTO_CLEANUP,
        auto_cleanup_days: AUTO_CLEANUP_DAYS,
      });
      await this.configRepository.save(config);
    }

    this.config = config;
    this.logger.info("Storage service initialized");
  }

  async getStatus(): Promise<StorageStatus> {
    await this.ensureDirectoryExists();

    const files = await glob("**/*", {
      cwd: DOWNLOAD_DIR,
      nodir: true,
    });

    let usedBytes = 0;
    for (const file of files) {
      try {
        const filePath = path.join(DOWNLOAD_DIR, file);
        const stat = await fs.stat(filePath);
        usedBytes += stat.size;
      } catch {
        // Ignore errors for inaccessible files
      }
    }

    const totalBytes = this.config.max_bytes;
    const freeBytes = Math.max(0, totalBytes - usedBytes);
    const usagePercent = (usedBytes / totalBytes) * 100;

    return {
      total_bytes: Number(totalBytes),
      used_bytes: usedBytes,
      free_bytes: freeBytes,
      usage_percent: Math.round(usagePercent * 10) / 10,
      task_count: 0, // Will be filled by caller
      file_count: files.length,
    };
  }

  async updateConfig(updates: StorageConfig): Promise<StorageConfigEntity> {
    if (updates.max_bytes !== undefined) {
      this.config.max_bytes = updates.max_bytes;
    }
    if (updates.auto_cleanup !== undefined) {
      this.config.auto_cleanup = updates.auto_cleanup;
    }
    if (updates.auto_cleanup_days !== undefined) {
      this.config.auto_cleanup_days = updates.auto_cleanup_days;
    }

    await this.configRepository.save(this.config);
    this.logger.info("Storage config updated", this.config);

    return this.config;
  }

  getConfig(): StorageConfigEntity {
    return this.config;
  }

  async checkStorageAvailable(requiredBytes: number = 0): Promise<boolean> {
    const status = await this.getStatus();
    return status.free_bytes >= requiredBytes;
  }

  async getTaskDirectory(taskId: string): Promise<string> {
    const taskDir = path.join(DOWNLOAD_DIR, taskId);
    await fs.mkdir(taskDir, { recursive: true });
    return taskDir;
  }

  async deleteTaskFiles(taskId: string): Promise<number> {
    const taskDir = path.join(DOWNLOAD_DIR, taskId);

    try {
      const stat = await fs.stat(taskDir);
      if (!stat.isDirectory()) return 0;

      const files = await glob("**/*", { cwd: taskDir, nodir: true });
      let freedBytes = 0;

      for (const file of files) {
        const filePath = path.join(taskDir, file);
        const fileStat = await fs.stat(filePath);
        freedBytes += fileStat.size;
      }

      await fs.rm(taskDir, { recursive: true, force: true });
      this.logger.info(`Deleted task files for ${taskId}, freed ${freedBytes} bytes`);

      return freedBytes;
    } catch {
      return 0;
    }
  }

  async createZipStream(taskId: string): Promise<{ stream: any; filename: string }> {
    const archiver = await import("archiver");
    const taskDir = path.join(DOWNLOAD_DIR, taskId);

    const archive = archiver.default("zip", { zlib: { level: 5 } });
    archive.directory(taskDir, false);
    archive.finalize();

    return {
      stream: archive,
      filename: `${taskId}.zip`,
    };
  }

  private async ensureDirectoryExists(): Promise<void> {
    await fs.mkdir(DOWNLOAD_DIR, { recursive: true });
  }
}
