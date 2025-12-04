import { provide } from "@inversifyjs/binding-decorators";
import { inject, injectable } from "inversify";
import type { Context, Next } from "koa";
import { PRIVATE_KEY, API_PREFIX } from "../constants";
import Logger from "../services/logger.service";
import { error } from "../utils";

@injectable()
@provide()
export default class AuthMiddleware {
  constructor(
    @inject(Logger)
    private readonly logger: Logger,
  ) {}

  async handle(ctx: Context, next: Next): Promise<void> {
    // Skip non-API paths
    if (!ctx.path.startsWith(API_PREFIX)) {
      await next();
      return;
    }

    // Skip health check endpoint
    if (ctx.path === `${API_PREFIX}/health`) {
      await next();
      return;
    }

    // If no PRIVATE_KEY is set, allow all requests
    if (!PRIVATE_KEY) {
      await next();
      return;
    }

    // Check for API key in various locations
    const apiKey = this.extractApiKey(ctx);

    if (!apiKey) {
      ctx.status = 401;
      ctx.body = error("Authentication required", "unauthorized", 401);
      return;
    }

    if (apiKey !== PRIVATE_KEY) {
      ctx.status = 401;
      ctx.body = error("Invalid API key", "unauthorized", 401);
      return;
    }

    await next();
  }

  private extractApiKey(ctx: Context): string | null {
    // Check Authorization header (Bearer token)
    const authHeader = ctx.get("Authorization");
    if (authHeader?.startsWith("Bearer ")) {
      return authHeader.slice(7);
    }

    // Check X-API-Key header
    const xApiKey = ctx.get("X-API-Key");
    if (xApiKey) {
      return xApiKey;
    }

    // Check query parameter
    const queryKey = ctx.query.key;
    if (typeof queryKey === "string") {
      return queryKey;
    }

    return null;
  }
}
