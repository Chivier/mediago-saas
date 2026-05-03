import { provide } from "@inversifyjs/binding-decorators";
import { inject, injectable } from "inversify";
import type Router from "@koa/router";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { DOWNLOAD_DIR } from "../constants";
import { success, error } from "../utils";
import Logger from "../services/logger.service";

interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  modified_at: string;
  ext: string;
}

interface FilesListResponse {
  cwd: string;
  parent: string | null;
  entries: FileEntry[];
}

const PREVIEW_EXTS = new Set([
  ".mp4",
  ".mkv",
  ".webm",
  ".mov",
  ".m4v",
  ".mp3",
  ".m4a",
  ".wav",
  ".srt",
  ".vtt",
  ".txt",
  ".json",
  ".log",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
]);

const PREVIEW_MIME: Record<string, string> = {
  ".mp4": "video/mp4",
  ".mkv": "video/x-matroska",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".m4v": "video/mp4",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
  ".srt": "text/plain; charset=utf-8",
  ".vtt": "text/vtt; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".log": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

@injectable()
@provide()
export default class FilesController {
  constructor(
    @inject(Logger)
    private readonly logger: Logger,
  ) {}

  // Resolve a user-supplied relative path against DOWNLOAD_DIR and reject
  // anything that escapes the root via "..", absolute paths, or symlinks.
  private async resolveSafe(relPath: string): Promise<string | null> {
    const normalized = relPath.replace(/^\/+/, "").trim();
    const target = path.resolve(DOWNLOAD_DIR, normalized);
    const root = path.resolve(DOWNLOAD_DIR);
    if (target !== root && !target.startsWith(root + path.sep)) {
      return null;
    }
    return target;
  }

  register(router: Router): void {
    // GET /api/files?path=relative/dir → list directory contents
    router.get("/files", async (ctx) => {
      const relPath = String(ctx.query.path ?? "");
      const safe = await this.resolveSafe(relPath);
      if (safe === null) {
        ctx.status = 400;
        ctx.body = error("Invalid path");
        return;
      }

      try {
        const stat = await fs.stat(safe);
        if (!stat.isDirectory()) {
          ctx.status = 400;
          ctx.body = error("Path is not a directory");
          return;
        }
      } catch {
        ctx.status = 404;
        ctx.body = error("Directory not found");
        return;
      }

      const dirents = await fs.readdir(safe, { withFileTypes: true });
      const entries: FileEntry[] = [];
      for (const d of dirents) {
        if (d.name.startsWith(".")) continue;
        try {
          const full = path.join(safe, d.name);
          const s = await fs.stat(full);
          const rel = path
            .relative(DOWNLOAD_DIR, full)
            .split(path.sep)
            .join("/");
          entries.push({
            name: d.name,
            path: rel,
            is_dir: s.isDirectory(),
            size: s.isDirectory() ? 0 : s.size,
            modified_at: s.mtime.toISOString(),
            ext: s.isDirectory() ? "" : path.extname(d.name).toLowerCase(),
          });
        } catch {
          // Skip files we can't stat (broken symlinks, races)
        }
      }

      // Directories first, then by name
      entries.sort((a, b) => {
        if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      const cwdRel = path
        .relative(DOWNLOAD_DIR, safe)
        .split(path.sep)
        .join("/");
      const parentRel =
        safe === path.resolve(DOWNLOAD_DIR)
          ? null
          : path
              .relative(DOWNLOAD_DIR, path.dirname(safe))
              .split(path.sep)
              .join("/");

      const body: FilesListResponse = {
        cwd: cwdRel,
        parent: parentRel,
        entries,
      };
      ctx.body = success(body);
    });

    // GET /api/files/preview?path=... → stream the file inline (video/audio/image/text)
    router.get("/files/preview", async (ctx) => {
      const relPath = String(ctx.query.path ?? "");
      const safe = await this.resolveSafe(relPath);
      if (safe === null) {
        ctx.status = 400;
        ctx.body = error("Invalid path");
        return;
      }

      let stat;
      try {
        stat = await fs.stat(safe);
      } catch {
        ctx.status = 404;
        ctx.body = error("File not found");
        return;
      }
      if (stat.isDirectory()) {
        ctx.status = 400;
        ctx.body = error("Path is a directory");
        return;
      }

      const ext = path.extname(safe).toLowerCase();
      if (!PREVIEW_EXTS.has(ext)) {
        ctx.status = 415;
        ctx.body = error("Preview not supported for this file type");
        return;
      }

      ctx.set("Content-Type", PREVIEW_MIME[ext] ?? "application/octet-stream");
      ctx.set("Content-Length", String(stat.size));
      ctx.set("Accept-Ranges", "bytes");
      ctx.body = createReadStream(safe);
    });

    // GET /api/files/download?path=... → force download attachment
    router.get("/files/download", async (ctx) => {
      const relPath = String(ctx.query.path ?? "");
      const safe = await this.resolveSafe(relPath);
      if (safe === null) {
        ctx.status = 400;
        ctx.body = error("Invalid path");
        return;
      }
      let stat;
      try {
        stat = await fs.stat(safe);
      } catch {
        ctx.status = 404;
        ctx.body = error("File not found");
        return;
      }
      if (stat.isDirectory()) {
        ctx.status = 400;
        ctx.body = error("Path is a directory");
        return;
      }

      const filename = path.basename(safe);
      ctx.set("Content-Type", "application/octet-stream");
      ctx.set("Content-Length", String(stat.size));
      ctx.set(
        "Content-Disposition",
        `attachment; filename="${encodeURIComponent(filename)}"`,
      );
      ctx.body = createReadStream(safe);
    });

    // DELETE /api/files?path=... → remove file or empty directory
    router.delete("/files", async (ctx) => {
      const relPath = String(ctx.query.path ?? "");
      const safe = await this.resolveSafe(relPath);
      if (safe === null || safe === path.resolve(DOWNLOAD_DIR)) {
        ctx.status = 400;
        ctx.body = error("Invalid path");
        return;
      }
      try {
        const stat = await fs.stat(safe);
        if (stat.isDirectory()) {
          await fs.rm(safe, { recursive: true, force: true });
        } else {
          await fs.unlink(safe);
        }
        this.logger.info(`Deleted ${safe}`);
        ctx.body = success({ deleted: relPath });
      } catch (e) {
        ctx.status = 404;
        ctx.body = error((e as Error).message);
      }
    });
  }
}
