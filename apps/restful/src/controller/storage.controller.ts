import { provide } from "@inversifyjs/binding-decorators";
import { inject, injectable } from "inversify";
import type Router from "@koa/router";
import { StorageService } from "../services/storage.service";
import { BatchTaskService } from "../services/batch-task.service";
import type { StorageConfig } from "../types";
import { success } from "../utils";
import Logger from "../services/logger.service";

@injectable()
@provide()
export default class StorageController {
  constructor(
    @inject(StorageService)
    private readonly storageService: StorageService,
    @inject(BatchTaskService)
    private readonly batchTaskService: BatchTaskService,
    @inject(Logger)
    private readonly logger: Logger,
  ) {}

  register(router: Router): void {
    // GET /api/storage - Get storage status
    router.get("/storage", async (ctx) => {
      const status = await this.storageService.getStatus();
      const taskCount = await this.batchTaskService.getTaskCount();

      ctx.body = success({
        ...status,
        task_count: taskCount,
      });
    });

    // PATCH /api/storage - Update storage config
    router.patch("/storage", async (ctx) => {
      const body = ctx.request.body as StorageConfig;

      this.logger.info("Updating storage config:", body);

      const config = await this.storageService.updateConfig(body);

      ctx.body = success({
        max_bytes: Number(config.max_bytes),
        auto_cleanup: config.auto_cleanup,
        auto_cleanup_days: config.auto_cleanup_days,
        updated_at: config.updated_at.toISOString(),
      });
    });
  }
}
