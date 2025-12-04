import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
} from "typeorm";

export type BatchTaskItemStatus =
  | "pending"
  | "downloading"
  | "completed"
  | "failed";

@Entity("batch_task_item")
export class BatchTaskItem {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "varchar", length: 32 })
  task_id!: string;

  @Column({ type: "text" })
  url!: string;

  @Column({ type: "varchar", length: 500, nullable: true })
  title!: string | null;

  @Column({ type: "varchar", length: 32, default: "pending" })
  status!: BatchTaskItemStatus;

  @Column({ type: "float", default: 0 })
  progress!: number;

  @Column({ type: "varchar", length: 500, nullable: true })
  filename!: string | null;

  @Column({ type: "bigint", nullable: true })
  size_bytes!: number | null;

  @Column({ type: "text", nullable: true })
  error!: string | null;

  @Column({ type: "int", nullable: true })
  download_task_id!: number | null;
}
