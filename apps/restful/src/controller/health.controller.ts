import { provide } from "@inversifyjs/binding-decorators";
import { injectable } from "inversify";
import type Router from "@koa/router";
import { success } from "../utils";

@injectable()
@provide()
export default class HealthController {
  register(router: Router): void {
    router.get("/health", async (ctx) => {
      ctx.body = success({
        status: "ok",
        timestamp: new Date().toISOString(),
        version: "1.0.0",
      });
    });
  }
}
