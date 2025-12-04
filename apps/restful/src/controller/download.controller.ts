import { provide } from "@inversifyjs/binding-decorators";
import { inject, injectable } from "inversify";
import type Router from "@koa/router";
import { DownloadProcessorService } from "../services/download-processor.service";
import { ApiError } from "../types";
import { success, isValidUrl } from "../utils";
import Logger from "../services/logger.service";

@injectable()
@provide()
export default class DownloadController {
  constructor(
    @inject(DownloadProcessorService)
    private readonly downloadProcessor: DownloadProcessorService,
    @inject(Logger)
    private readonly logger: Logger,
  ) {}

  register(router: Router): void {
    // POST /api/download - Single video download
    router.post("/download", async (ctx) => {
      const { url } = ctx.request.body as { url?: string };

      if (!url) {
        throw new ApiError("invalid_url", "URL is required", 400);
      }

      if (!isValidUrl(url)) {
        throw new ApiError("invalid_url", "Invalid URL format", 400);
      }

      this.logger.info(`Single download request for: ${url}`);

      try {
        const result = await this.downloadProcessor.downloadSingleVideo(url);

        // For now, return success message
        // In production, this would stream the file
        ctx.body = success({
          message: "Download started",
          filename: result.filename,
        });
      } catch (error) {
        this.logger.error("Download failed:", error);
        throw new ApiError(
          "download_failed",
          error instanceof Error ? error.message : "Download failed",
          503,
        );
      }
    });

    // GET /bilibili/:bvid - Bilibili quick download
    router.get("/bilibili/:bvid", async (ctx) => {
      const { bvid } = ctx.params;
      const url = `https://www.bilibili.com/video/${bvid}`;

      this.logger.info(`Bilibili download request for: ${bvid}`);

      try {
        const result = await this.downloadProcessor.downloadSingleVideo(url);

        ctx.body = success({
          message: "Download started",
          filename: result.filename,
          bvid,
        });
      } catch (error) {
        this.logger.error("Bilibili download failed:", error);
        throw new ApiError(
          "download_failed",
          error instanceof Error ? error.message : "Download failed",
          503,
        );
      }
    });
  }
}
