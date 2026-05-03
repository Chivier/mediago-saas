import { provide } from "@inversifyjs/binding-decorators";
import { injectable } from "inversify";
import { DataSource } from "typeorm";
import {
  BatchTask,
  BatchTaskItem,
  StorageConfigEntity,
} from "../entity";
import { DB_PATH, WORKSPACE } from "../constants";
import fs from "node:fs";

@injectable()
@provide()
export default class Database {
  private dataSource!: DataSource;

  async init(): Promise<DataSource> {
    // Ensure workspace directory exists
    fs.mkdirSync(WORKSPACE, { recursive: true });

    this.dataSource = new DataSource({
      type: "better-sqlite3",
      database: DB_PATH,
      entities: [BatchTask, BatchTaskItem, StorageConfigEntity],
      synchronize: true,
      logging: process.env.NODE_ENV === "development",
    });

    await this.dataSource.initialize();

    return this.dataSource;
  }

  getDataSource(): DataSource {
    return this.dataSource;
  }
}
