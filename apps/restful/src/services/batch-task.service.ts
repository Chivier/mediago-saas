import { provide } from "@inversifyjs/binding-decorators";
import { inject, injectable } from "inversify";
import { DataSource, LessThan, In, Repository } from "typeorm";
import {
  BatchTask,
  BatchTaskItem,
  type BatchTaskStatus,
  type BatchTaskItemStatus,
} from "../entity";
import { generateTaskId } from "../utils";
import { ApiError } from "../types";
import Logger from "./logger.service";

@injectable()
@provide()
export class BatchTaskService {
  private taskRepository!: Repository<BatchTask>;
  private itemRepository!: Repository<BatchTaskItem>;

  constructor(
    @inject(Logger)
    private readonly logger: Logger,
  ) {}

  init(dataSource: DataSource) {
    this.taskRepository = dataSource.getRepository(BatchTask);
    this.itemRepository = dataSource.getRepository(BatchTaskItem);
  }

  async createTask(name: string, urls: string[]): Promise<BatchTask> {
    const taskId = generateTaskId();

    const task = this.taskRepository.create({
      task_id: taskId,
      name,
      status: "pending",
      total: urls.length,
      completed: 0,
      failed: 0,
      size_bytes: 0,
    });

    await this.taskRepository.save(task);

    const items = urls.map((url) =>
      this.itemRepository.create({
        task_id: taskId,
        url,
        title: null,
        status: "pending",
        progress: 0,
        filename: null,
        size_bytes: null,
      }),
    );

    await this.itemRepository.save(items);

    this.logger.info(`Created batch task ${taskId} with ${urls.length} items`);

    return task;
  }

  async getTask(taskId: string, includeItems = false): Promise<BatchTask> {
    const task = await this.taskRepository.findOne({
      where: { task_id: taskId },
    });

    if (!task) {
      throw new ApiError("task_not_found", `Task ${taskId} not found`, 404);
    }

    // Manually load items if requested
    if (includeItems) {
      task.items = await this.getTaskItems(taskId);
    }

    return task;
  }

  async listTasks(
    status?: BatchTaskStatus,
    limit = 20,
    offset = 0,
  ): Promise<{ tasks: BatchTask[]; total: number }> {
    const where = status ? { status } : {};

    const [tasks, total] = await this.taskRepository.findAndCount({
      where,
      order: { created_at: "DESC" },
      take: limit,
      skip: offset,
    });

    return { tasks, total };
  }

  async updateTaskStatus(taskId: string, status: BatchTaskStatus): Promise<void> {
    await this.taskRepository.update({ task_id: taskId }, { status });
  }

  async updateItemStatus(
    itemId: number,
    status: BatchTaskItemStatus,
    updates?: Partial<BatchTaskItem>,
  ): Promise<void> {
    await this.itemRepository.update(
      { id: itemId },
      { status, ...updates },
    );
  }

  async incrementTaskProgress(
    taskId: string,
    completed: number,
    failed: number,
    sizeBytes: number,
  ): Promise<void> {
    const task = await this.getTask(taskId);

    const newCompleted = task.completed + completed;
    const newFailed = task.failed + failed;
    const newSizeBytes = Number(task.size_bytes) + sizeBytes;

    let status: BatchTaskStatus = "running";
    if (newCompleted + newFailed >= task.total) {
      if (newFailed === 0) {
        status = "completed";
      } else if (newCompleted === 0) {
        status = "failed";
      } else {
        status = "partial";
      }
    }

    await this.taskRepository.update(
      { task_id: taskId },
      {
        completed: newCompleted,
        failed: newFailed,
        size_bytes: newSizeBytes,
        status,
      },
    );
  }

  async getTaskItems(taskId: string): Promise<BatchTaskItem[]> {
    return this.itemRepository.find({
      where: { task_id: taskId },
    });
  }

  async getPendingItems(taskId: string): Promise<BatchTaskItem[]> {
    return this.itemRepository.find({
      where: { task_id: taskId, status: "pending" },
    });
  }

  async deleteTask(taskId: string): Promise<{ freed_bytes: number }> {
    const task = await this.getTask(taskId);
    const freedBytes = Number(task.size_bytes);

    await this.itemRepository.delete({ task_id: taskId });
    await this.taskRepository.delete({ task_id: taskId });

    this.logger.info(`Deleted batch task ${taskId}`);

    return { freed_bytes: freedBytes };
  }

  async cleanupTasks(
    before: Date,
    statuses?: BatchTaskStatus[],
  ): Promise<{ deleted_count: number; freed_bytes: number }> {
    const where: any = {
      created_at: LessThan(before),
    };

    if (statuses && statuses.length > 0) {
      where.status = In(statuses);
    }

    const tasks = await this.taskRepository.find({ where });

    let freedBytes = 0;
    for (const task of tasks) {
      freedBytes += Number(task.size_bytes);
      await this.itemRepository.delete({ task_id: task.task_id });
      await this.taskRepository.delete({ task_id: task.task_id });
    }

    this.logger.info(`Cleaned up ${tasks.length} tasks, freed ${freedBytes} bytes`);

    return { deleted_count: tasks.length, freed_bytes: freedBytes };
  }

  async getTaskCount(): Promise<number> {
    return this.taskRepository.count();
  }

  async getTotalSize(): Promise<number> {
    const result = await this.taskRepository
      .createQueryBuilder("task")
      .select("SUM(task.size_bytes)", "total")
      .getRawOne();

    return Number(result?.total || 0);
  }

  async setItemDownloadTaskId(itemId: number, downloadTaskId: number): Promise<void> {
    await this.itemRepository.update(
      { id: itemId },
      { download_task_id: downloadTaskId },
    );
  }
}
