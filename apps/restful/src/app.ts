import http from "node:http";
import { provide } from "@inversifyjs/binding-decorators";
import cors from "@koa/cors";
import Router from "@koa/router";
import { inject, injectable } from "inversify";
import Koa from "koa";
import bodyParser from "koa-bodyparser";
import RouterService from "./core/router";
import Database from "./core/database";
import { PORT, LOG_DIR, DOWNLOAD_DIR, TEMP_DIR } from "./constants";
import Logger from "./services/logger.service";
import { BatchTaskService } from "./services/batch-task.service";
import { StorageService } from "./services/storage.service";
import { DownloadProcessorService } from "./services/download-processor.service";
import { MediaGoClient } from "./services/mediago-client.service";
import AuthMiddleware from "./middleware/auth";
import ErrorHandlerMiddleware from "./middleware/error-handler";
import fs from "node:fs";

@injectable()
@provide()
export default class RestfulApp extends Koa {
  constructor(
    @inject(RouterService)
    private readonly router: RouterService,
    @inject(Database)
    private readonly database: Database,
    @inject(Logger)
    private readonly logger: Logger,
    @inject(BatchTaskService)
    private readonly batchTaskService: BatchTaskService,
    @inject(StorageService)
    private readonly storageService: StorageService,
    @inject(DownloadProcessorService)
    private readonly downloadProcessor: DownloadProcessorService,
    @inject(MediaGoClient)
    private readonly mediaGoClient: MediaGoClient,
    @inject(AuthMiddleware)
    private readonly authMiddleware: AuthMiddleware,
    @inject(ErrorHandlerMiddleware)
    private readonly errorHandler: ErrorHandlerMiddleware,
  ) {
    super();
  }

  async init(): Promise<void> {
    // Ensure directories exist
    fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.mkdirSync(TEMP_DIR, { recursive: true });

    // Initialize local SQLite (batch tasks + storage config)
    const dataSource = await this.database.init();

    // Initialize services with database
    this.batchTaskService.init(dataSource);
    await this.storageService.init(dataSource);
    this.downloadProcessor.init();

    // Subscribe to Go backend SSE events
    this.mediaGoClient.startEventStream();

    // Initialize router
    this.router.init();

    // Setup middleware
    this.use(cors());
    this.use(this.errorHandler.handle.bind(this.errorHandler));
    this.use(bodyParser());
    this.use(this.authMiddleware.handle.bind(this.authMiddleware));
    this.use(this.router.routes());
    this.use(this.router.allowedMethods());

    // Bilibili shortcut convenience route
    const bilibiliRouter = new Router();
    bilibiliRouter.get("/bilibili/:bvid", async (ctx) => {
      ctx.redirect(`/api/bilibili/${ctx.params.bvid}${ctx.search}`);
    });
    this.use(bilibiliRouter.routes());

    // Create HTTP server
    const server = http.createServer(this.callback());

    server.listen(PORT, () => {
      this.logger.info(`RESTful API server running on port ${PORT}`);
    });
  }
}
