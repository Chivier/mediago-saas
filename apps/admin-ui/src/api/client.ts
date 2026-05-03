import axios from "axios";

// Default to nginx-proxied paths so the admin-ui's HTTP traffic flows
// through the same basic-auth gate as the static SPA. Override via
// VITE_*_URL build args only when the admin-ui is served standalone
// (e.g. `pnpm dev` against direct backend ports).
//
// Path scheme:
//   /api/core    → mediago-core:8080
//   /api/restful → mediago-restful:8898
//   /api/ai      → mediago-ai:8899
export const GO_API_URL = import.meta.env.VITE_GO_API_URL ?? "/api/core";
export const RESTFUL_API_URL =
  import.meta.env.VITE_RESTFUL_API_URL ?? "/api/restful";
export const AI_API_URL = import.meta.env.VITE_AI_API_URL ?? "/api/ai";

export const goClient = axios.create({
  baseURL: GO_API_URL,
  timeout: 15000,
  headers: { "Content-Type": "application/json" },
});

export const restfulClient = axios.create({
  baseURL: RESTFUL_API_URL,
  timeout: 15000,
  headers: { "Content-Type": "application/json" },
});

export const aiClient = axios.create({
  baseURL: AI_API_URL,
  timeout: 30000,
  headers: { "Content-Type": "application/json" },
});

// Both Go core and Koa restful wrap responses as
// {success, code?, message?, data}. Unwrap to the inner data so callers
// see the same shape they'd see in the OpenAPI doc; surface message on error.
const addEnvelopeInterceptor = (client: typeof goClient) => {
  client.interceptors.response.use(
    (response) => {
      const body = response.data;
      if (body && typeof body === "object" && "success" in body) {
        if (body.success === false) {
          const msg =
            (body as { message?: string; error?: string }).message ??
            (body as { message?: string; error?: string }).error ??
            "Request failed";
          return Promise.reject(new Error(msg));
        }
        if ("data" in body) {
          response.data = (body as { data: unknown }).data;
        }
      }
      return response;
    },
    (error) => {
      const message =
        error.response?.data?.message ??
        error.response?.data?.error ??
        error.message ??
        "Unknown error";
      return Promise.reject(new Error(message));
    },
  );
};

// AI service (FastAPI) returns plain JSON; only attach error normalization.
const addPlainErrorInterceptor = (client: typeof goClient) => {
  client.interceptors.response.use(
    (response) => response,
    (error) => {
      const message =
        error.response?.data?.detail ??
        error.response?.data?.message ??
        error.response?.data?.error ??
        error.message ??
        "Unknown error";
      return Promise.reject(new Error(message));
    },
  );
};

addEnvelopeInterceptor(goClient);
addEnvelopeInterceptor(restfulClient);
addPlainErrorInterceptor(aiClient);
