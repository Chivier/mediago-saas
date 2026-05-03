import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";

export type BatchTaskStatus =
  | "pending"
  | "running"
  | "completed"
  | "partial"
  | "failed";

@Entity("batch_task")
export class BatchTask {
  @PrimaryColumn({ type: "varchar", length: 32 })
  task_id!: string;

  @Column({ type: "varchar", length: 255 })
  name!: string;

  @Column({ type: "varchar", length: 32, default: "pending" })
  status!: BatchTaskStatus;

  @Column({ type: "int", default: 0 })
  total!: number;

  @Column({ type: "int", default: 0 })
  completed!: number;

  @Column({ type: "int", default: 0 })
  failed!: number;

  @Column({ type: "bigint", default: 0 })
  size_bytes!: number;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;

  // Note: items relation removed to avoid bundling issues
  // Use BatchTaskService.getTaskItems() instead
  items?: any[];

  get progress(): number {
    if (this.total === 0) return 0;
    return Math.round(((this.completed + this.failed) / this.total) * 1000) / 10;
  }
}
