import { provide } from "@inversifyjs/binding-decorators";
import { inject, injectable } from "inversify";
import type { Context, Next } from "koa";
import Logger from "../services/logger.service";
import { ApiError } from "../types";
import { error } from "../utils";

@injectable()
@provide()
export default class ErrorHandlerMiddleware {
  constructor(
    @inject(Logger)
    private readonly logger: Logger,
  ) {}

  async handle(ctx: Context, next: Next): Promise<void> {
    try {
      await next();
    } catch (err) {
      if (err instanceof ApiError) {
        ctx.status = err.httpStatus;
        ctx.body = error(err.message, err.code, err.httpStatus);
        return;
      }

      this.logger.error("Unhandled error:", err);

      ctx.status = 500;
      ctx.body = error(
        err instanceof Error ? err.message : "Internal server error",
        undefined,
        500,
      );
    }
  }
}
