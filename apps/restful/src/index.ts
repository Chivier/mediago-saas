import "reflect-metadata";
import { buildProviderModule } from "@inversifyjs/binding-decorators";
import { Container } from "inversify";
import RestfulApp from "./app";

// Import all providers to register them
import "./services/logger.service";
import "./services/batch-task.service";
import "./services/storage.service";
import "./services/download-processor.service";
import "./middleware/auth";
import "./middleware/error-handler";
import "./controller/health.controller";
import "./controller/download.controller";
import "./controller/task.controller";
import "./controller/storage.controller";
import "./core/router";
import "./core/database";

const container = new Container({
  defaultScope: "Singleton",
});

async function start() {
  await container.load(buildProviderModule());
  const app = container.get(RestfulApp);
  await app.init();
}

void start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
