import { goClient, aiClient } from "./client";

export interface GoHealthResponse {
  status: string;
  activeDownloads?: number;
  version?: string;
}

export interface AiHealthResponse {
  status: string;
  gpu_available?: boolean;
  gpu_name?: string;
  gpu_memory_used?: number;
  gpu_memory_total?: number;
  model_loaded?: boolean;
  funasr_loaded?: boolean;
}

export interface ServiceHealth {
  go: { ok: boolean; data?: GoHealthResponse };
  ai: { ok: boolean; data?: AiHealthResponse };
}

export async function fetchGoHealth(): Promise<GoHealthResponse> {
  const { data } = await goClient.get<GoHealthResponse>("/healthy");
  return data;
}

export async function fetchAiHealth(): Promise<AiHealthResponse> {
  const { data } = await aiClient.get<AiHealthResponse>("/health");
  return data;
}

export async function fetchAllHealth(): Promise<ServiceHealth> {
  const [goResult, aiResult] = await Promise.allSettled([
    fetchGoHealth(),
    fetchAiHealth(),
  ]);

  return {
    go: {
      ok: goResult.status === "fulfilled",
      data: goResult.status === "fulfilled" ? goResult.value : undefined,
    },
    ai: {
      ok: aiResult.status === "fulfilled",
      data: aiResult.status === "fulfilled" ? aiResult.value : undefined,
    },
  };
}
