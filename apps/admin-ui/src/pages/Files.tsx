import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Folder,
  FileText,
  FileVideo,
  FileAudio,
  FileImage,
  File as FileIcon,
  StickyNote,
  Captions,
  ChevronRight,
  Home,
  Trash2,
  Download as DownloadIcon,
  Eye,
  X,
  AlertCircle,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Button } from "../components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import {
  listFiles,
  deleteFile,
  getPreviewUrl,
  getFileDownloadUrl,
  previewKind,
  isPreviewable,
  formatBytes,
  type FileEntry,
  type FileKind,
} from "../api/files";

// Single source of truth for icon sizing in this page. Earlier some
// rows used 14px and others 16px, which made them visibly mismatched
// when the table column auto-sized. Stick to one number per role.
const ICON_PX = 18;
const ACTION_ICON_PX = 14;

function iconForEntry(entry: FileEntry) {
  const cls = "flex-shrink-0";
  if (entry.isDir)
    return <Folder size={ICON_PX} className={`${cls} text-blue-500`} />;
  // Use the server-supplied kind first (covers note/transcript named files);
  // fall back to extension-only previewKind for older API responses.
  switch (entry.kind) {
    case "video":
      return <FileVideo size={ICON_PX} className={`${cls} text-purple-500`} />;
    case "audio":
      return <FileAudio size={ICON_PX} className={`${cls} text-pink-500`} />;
    case "image":
      return <FileImage size={ICON_PX} className={`${cls} text-green-500`} />;
    case "subtitle":
      return <Captions size={ICON_PX} className={`${cls} text-amber-500`} />;
    case "note":
      return (
        <StickyNote size={ICON_PX} className={`${cls} text-emerald-500`} />
      );
    case "transcript":
    case "text":
      return <FileText size={ICON_PX} className={`${cls} text-yellow-500`} />;
    default: {
      const k = previewKind(entry.ext);
      if (k === "video")
        return (
          <FileVideo size={ICON_PX} className={`${cls} text-purple-500`} />
        );
      if (k === "audio")
        return <FileAudio size={ICON_PX} className={`${cls} text-pink-500`} />;
      if (k === "image")
        return <FileImage size={ICON_PX} className={`${cls} text-green-500`} />;
      if (k === "text")
        return <FileText size={ICON_PX} className={`${cls} text-yellow-500`} />;
      return (
        <FileIcon size={ICON_PX} className={`${cls} text-muted-foreground`} />
      );
    }
  }
}

const KIND_FILTERS: Array<{ value: FileKind | "all"; label: string }> = [
  { value: "all", label: "全部" },
  { value: "video", label: "视频" },
  { value: "note", label: "笔记 (notes.md)" },
  { value: "transcript", label: "转写稿" },
  { value: "subtitle", label: "字幕 (srt/vtt)" },
  { value: "audio", label: "音频" },
  { value: "image", label: "图片" },
  { value: "other", label: "其他" },
];

function PreviewDialog({
  entry,
  onClose,
}: {
  entry: FileEntry | null;
  onClose: () => void;
}) {
  const [textContent, setTextContent] = useState<string | null>(null);
  const [textError, setTextError] = useState<string | null>(null);

  const kind = entry ? previewKind(entry.ext) : null;
  const url = entry ? getPreviewUrl(entry.path) : "";

  useEffect(() => {
    setTextContent(null);
    setTextError(null);
    if (!entry || kind !== "text") return;
    const ctrl = new AbortController();
    fetch(url, { signal: ctrl.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then(setTextContent)
      .catch((e) => {
        if (e.name !== "AbortError") setTextError(String(e));
      });
    return () => ctrl.abort();
  }, [entry, kind, url]);

  return (
    <Dialog open={entry !== null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="truncate text-sm font-mono pr-8">
            {entry?.name}
          </DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-auto">
          {!entry && null}
          {entry && kind === "video" && (
            <video
              src={url}
              controls
              className="w-full max-h-[60vh] bg-black"
            />
          )}
          {entry && kind === "audio" && (
            <audio src={url} controls className="w-full" />
          )}
          {entry && kind === "image" && (
            <img
              src={url}
              alt={entry.name}
              className="max-w-full max-h-[60vh] mx-auto"
            />
          )}
          {entry && kind === "text" && (
            <div className="bg-muted rounded p-3 max-h-[60vh] overflow-auto">
              {textError ? (
                <div className="text-destructive text-sm flex items-center gap-2">
                  <AlertCircle size={14} />
                  {textError}
                </div>
              ) : textContent === null ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : (
                <pre className="text-xs font-mono whitespace-pre-wrap break-words">
                  {textContent}
                </pre>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function Files() {
  const queryClient = useQueryClient();
  const [cwd, setCwd] = useState("");
  const [kindFilter, setKindFilter] = useState<FileKind | "all">("all");
  const [previewEntry, setPreviewEntry] = useState<FileEntry | null>(null);
  const [pendingDelete, setPendingDelete] = useState<FileEntry | null>(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["files", cwd, kindFilter],
    queryFn: () => listFiles(cwd, { kind: kindFilter }),
    refetchInterval: 15000,
  });

  const deleteMutation = useMutation({
    mutationFn: deleteFile,
    onSuccess: () => {
      setPendingDelete(null);
      queryClient.invalidateQueries({ queryKey: ["files"] });
    },
  });

  const breadcrumbs = useMemo(() => {
    if (!cwd) return [] as { name: string; path: string }[];
    const parts = cwd.split("/").filter(Boolean);
    const segs: { name: string; path: string }[] = [];
    let acc = "";
    for (const p of parts) {
      acc = acc ? `${acc}/${p}` : p;
      segs.push({ name: p, path: acc });
    }
    return segs;
  }, [cwd]);

  return (
    <div className="space-y-4">
      {/* Breadcrumbs + filter */}
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Files</CardTitle>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">类型</span>
            <Select
              value={kindFilter}
              onValueChange={(v) => setKindFilter(v as FileKind | "all")}
            >
              <SelectTrigger className="w-44 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KIND_FILTERS.map((f) => (
                  <SelectItem key={f.value} value={f.value} className="text-xs">
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-1 text-sm flex-wrap">
            <button
              type="button"
              onClick={() => setCwd("")}
              className="flex items-center gap-1 hover:text-foreground text-muted-foreground"
            >
              <Home size={ACTION_ICON_PX} />
              <span>downloads</span>
            </button>
            {breadcrumbs.map((b) => (
              <span key={b.path} className="flex items-center gap-1">
                <ChevronRight size={12} className="text-muted-foreground" />
                <button
                  type="button"
                  className="hover:text-foreground text-muted-foreground"
                  onClick={() => setCwd(b.path)}
                >
                  {b.name}
                </button>
              </span>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Listing */}
      <Card>
        <CardContent className="p-0">
          {isError && (
            <div className="flex items-center gap-2 p-6 text-destructive">
              <AlertCircle size={16} />
              <span className="text-sm">{(error as Error).message}</span>
            </div>
          )}

          {isLoading && !data ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-10 bg-muted rounded animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead className="hidden sm:table-cell w-32">
                      Size
                    </TableHead>
                    <TableHead className="hidden md:table-cell w-44">
                      Modified
                    </TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data?.parent !== null && data?.parent !== undefined && (
                    <TableRow
                      className="cursor-pointer"
                      onClick={() => setCwd(data.parent ?? "")}
                    >
                      <TableCell colSpan={4} className="text-muted-foreground">
                        <div className="flex items-center gap-2">
                          <Folder
                            size={ICON_PX}
                            className="flex-shrink-0 text-blue-500"
                          />
                          ..
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                  {!data?.entries.length && data?.parent === null ? (
                    <TableRow>
                      <TableCell
                        colSpan={4}
                        className="text-center py-10 text-muted-foreground"
                      >
                        Directory is empty
                      </TableCell>
                    </TableRow>
                  ) : (
                    data?.entries.map((entry) => (
                      <TableRow
                        key={entry.path}
                        className={entry.isDir ? "cursor-pointer" : undefined}
                        onClick={
                          entry.isDir ? () => setCwd(entry.path) : undefined
                        }
                      >
                        <TableCell>
                          <div className="flex items-center gap-2 max-w-[280px]">
                            {iconForEntry(entry)}
                            <span className="truncate" title={entry.name}>
                              {entry.name}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="hidden sm:table-cell text-xs text-muted-foreground">
                          {entry.isDir ? "—" : formatBytes(entry.size)}
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-xs text-muted-foreground whitespace-nowrap">
                          {new Date(entry.modifiedAt).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right">
                          <div
                            className="flex items-center justify-end gap-1"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {!entry.isDir && isPreviewable(entry.ext) && (
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label="Preview"
                                onClick={() => setPreviewEntry(entry)}
                              >
                                <Eye size={ACTION_ICON_PX} />
                              </Button>
                            )}
                            {!entry.isDir && (
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label="Download"
                                title={
                                  entry.kind === "note"
                                    ? "Download notes"
                                    : entry.kind === "transcript"
                                      ? "Download transcript"
                                      : "Download file"
                                }
                                asChild
                              >
                                <a
                                  href={getFileDownloadUrl(entry.path)}
                                  download
                                >
                                  <DownloadIcon size={ACTION_ICON_PX} />
                                </a>
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label="Delete"
                              title={
                                entry.kind === "video"
                                  ? "Delete video (notes stay)"
                                  : entry.isDir
                                    ? "Delete folder + everything inside"
                                    : "Delete this file"
                              }
                              className="text-destructive hover:text-destructive"
                              onClick={() => setPendingDelete(entry)}
                            >
                              <Trash2 size={ACTION_ICON_PX} />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <PreviewDialog
        entry={previewEntry}
        onClose={() => setPreviewEntry(null)}
      />

      {/* Delete confirm */}
      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(v) => !v && setPendingDelete(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {pendingDelete?.name}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {pendingDelete?.isDir
              ? "The folder and all its contents will be permanently removed."
              : "The file will be permanently removed."}
          </p>
          {deleteMutation.isError && (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertCircle size={14} />
              {(deleteMutation.error as Error).message}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setPendingDelete(null)}
              disabled={deleteMutation.isPending}
            >
              <X size={14} />
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() =>
                pendingDelete && deleteMutation.mutate(pendingDelete.path)
              }
            >
              <Trash2 size={14} />
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
