import { provide } from "@inversifyjs/binding-decorators";
import Router from "@koa/router";
import { inject, injectable } from "inversify";
import HealthController from "../controller/health.controller";
import DownloadController from "../controller/download.controller";
import TaskController from "../controller/task.controller";
import StorageController from "../controller/storage.controller";
import { API_PREFIX } from "../constants";
import Logger from "../services/logger.service";

@injectable()
@provide()
export default class RouterService extends Router {
  constructor(
    @inject(HealthController)
    private readonly healthController: HealthController,
    @inject(DownloadController)
    private readonly downloadController: DownloadController,
    @inject(TaskController)
    private readonly taskController: TaskController,
    @inject(StorageController)
    private readonly storageController: StorageController,
    @inject(Logger)
    private readonly logger: Logger,
  ) {
    super();
  }

  init(): void {
    this.prefix(API_PREFIX);

    // Register all controllers
    this.healthController.register(this);
    this.downloadController.register(this);
    this.taskController.register(this);
    this.storageController.register(this);

    // Also register bilibili route without API prefix
    const bilibiliRouter = new Router();
    bilibiliRouter.get("/bilibili/:bvid", async (ctx) => {
      // Redirect to API endpoint
      ctx.redirect(`${API_PREFIX}/bilibili/${ctx.params.bvid}${ctx.search}`);
    });

    this.logger.info("Routes initialized");
  }
}
