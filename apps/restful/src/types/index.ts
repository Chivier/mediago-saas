export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  code?: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

// Batch task types
export type BatchTaskStatus =
  | "pending"
  | "running"
  | "completed"
  | "partial"
  | "failed";

export type BatchTaskItemStatus =
  | "pending"
  | "downloading"
  | "completed"
  | "failed";

export interface BatchTaskItem {
  url: string;
  title: string | null;
  status: BatchTaskItemStatus;
  progress?: number;
  filename: string | null;
  size_bytes: number | null;
  error?: string;
}

export interface BatchTask {
  task_id: string;
  name: string;
  status: BatchTaskStatus;
  total: number;
  completed: number;
  failed: number;
  progress: number;
  size_bytes: number;
  created_at: string;
  updated_at: string;
  items?: BatchTaskItem[];
}

export interface CreateBatchTaskRequest {
  name?: string;
  urls: string[];
}

export interface TaskListQuery {
  status?: BatchTaskStatus;
  limit?: number;
  offset?: number;
}

export interface CleanupRequest {
  before?: string;
  status?: BatchTaskStatus[];
}

export interface StorageStatus {
  total_bytes: number;
  used_bytes: number;
  free_bytes: number;
  usage_percent: number;
  task_count: number;
  file_count: number;
}

export interface StorageConfig {
  max_bytes?: number;
  auto_cleanup?: boolean;
  auto_cleanup_days?: number;
}

// Error types
export type ApiErrorCode =
  | "invalid_url"
  | "invalid_file"
  | "empty_urls"
  | "unauthorized"
  | "task_not_found"
  | "video_not_found"
  | "task_not_ready"
  | "storage_full"
  | "download_failed";

export class ApiError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    message: string,
    public readonly httpStatus: number = 400,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
