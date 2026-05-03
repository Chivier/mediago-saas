import os from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const API_PREFIX = "/api";
export const HOME_DIR = os.homedir();
export const DOWNLOAD_DIR =
  process.env.STORAGE_PATH || resolve(HOME_DIR, "mediago-restful");
export const BIN_DIR = resolve(__dirname, "./bin");
export const WORKSPACE = resolve(DOWNLOAD_DIR, ".store");
export const DB_PATH = resolve(WORKSPACE, "mediago-restful.db");
export const LOG_DIR = resolve(WORKSPACE, "logs");
export const TEMP_DIR = resolve(WORKSPACE, "temp");

// Environment configuration
export const PORT = parseInt(process.env.PORT || "8898", 10);
export const PRIVATE_KEY = process.env.PRIVATE_KEY || "";
export const STORAGE_MAX_BYTES = parseInt(
  process.env.STORAGE_MAX_BYTES || String(100 * 1024 * 1024 * 1024),
  10,
); // 100GB default
export const AUTO_CLEANUP = process.env.AUTO_CLEANUP === "true";
export const AUTO_CLEANUP_DAYS = parseInt(
  process.env.AUTO_CLEANUP_DAYS || "7",
  10,
);
export const MAX_CONCURRENT_DOWNLOADS = parseInt(
  process.env.MAX_CONCURRENT_DOWNLOADS || "3",
  10,
);
export const MAX_CONCURRENT_TASKS = parseInt(
  process.env.MAX_CONCURRENT_TASKS || "5",
  10,
);

export enum Platform {
  Windows = "win32",
  MacOS = "darwin",
  Linux = "linux",
}

export const isMac = process.platform === Platform.MacOS;
export const isWin = process.platform === Platform.Windows;
export const isLinux = process.platform === Platform.Linux;
