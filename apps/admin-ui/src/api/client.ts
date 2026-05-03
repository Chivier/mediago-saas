import axios from "axios";

export const GO_API_URL =
  import.meta.env.VITE_GO_API_URL ?? "http://localhost:8080";
export const RESTFUL_API_URL =
  import.meta.env.VITE_RESTFUL_API_URL ?? "http://localhost:8898";
export const AI_API_URL =
  import.meta.env.VITE_AI_API_URL ?? "http://localhost:8899";

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

// Response interceptors for unified error handling
const addResponseInterceptor = (client: typeof goClient) => {
  client.interceptors.response.use(
    (response) => response,
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

addResponseInterceptor(goClient);
addResponseInterceptor(restfulClient);
addResponseInterceptor(aiClient);
