import { Entity, PrimaryColumn, Column, UpdateDateColumn } from "typeorm";

@Entity("storage_config")
export class StorageConfigEntity {
  @PrimaryColumn({ type: "varchar", length: 32, default: "default" })
  id!: string;

  @Column({ type: "bigint", default: 107374182400 }) // 100GB default
  max_bytes!: number;

  @Column({ type: "boolean", default: false })
  auto_cleanup!: boolean;

  @Column({ type: "int", default: 7 })
  auto_cleanup_days!: number;

  @UpdateDateColumn()
  updated_at!: Date;
}
