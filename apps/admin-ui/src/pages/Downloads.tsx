import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Play,
  Square,
  Trash2,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  Plus,
  Loader2,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { StatusBadge } from "../components/StatusBadge";
import {
  fetchDownloads,
  startDownload,
  stopDownload,
  deleteDownload,
  createDownload,
  type DownloadStatus,
  type CoreDownloadType,
} from "../api/downloads";
import { Progress } from "../components/ui/progress";

function CreateDownloadDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [type, setType] = useState<CoreDownloadType>("auto");

  const mutation = useMutation({
    mutationFn: createDownload,
    onSuccess: () => {
      setOpen(false);
      setUrl("");
      setTitle("");
      setType("auto");
      onCreated();
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedUrl = url.trim();
    if (!trimmedUrl) return;
    mutation.mutate({
      url: trimmedUrl,
      title: title.trim() || undefined,
      type,
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) mutation.reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus size={14} />
          New Download
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Download</DialogTitle>
          <DialogDescription>
            Submit a video URL (m3u8, MP4, Bilibili, YouTube, …). The Go backend
            will detect the type and queue it.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="dl-url">URL</Label>
            <Input
              id="dl-url"
              placeholder="https://example.com/video.m3u8"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              required
              autoFocus
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="dl-title">
                Title{" "}
                <span className="text-muted-foreground font-normal">
                  (optional)
                </span>
              </Label>
              <Input
                id="dl-title"
                placeholder="My recording"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dl-type">Type</Label>
              <Select
                value={type}
                onValueChange={(v) => setType(v as CoreDownloadType)}
              >
                <SelectTrigger id="dl-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto detect</SelectItem>
                  <SelectItem value="m3u8">m3u8 (HLS)</SelectItem>
                  <SelectItem value="direct">Direct (mp4 / file)</SelectItem>
                  <SelectItem value="bilibili">Bilibili</SelectItem>
                  <SelectItem value="youtube">YouTube</SelectItem>
                  <SelectItem value="mediago">Mediago</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {mutation.isError && (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertCircle size={14} />
              {(mutation.error as Error).message}
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={mutation.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending || !url.trim()}>
              {mutation.isPending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Plus size={14} />
              )}
              Submit
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const STATUS_FILTERS = [
  { value: "all", label: "All" },
  { value: "queued", label: "Queued" },
  { value: "downloading", label: "Downloading" },
  { value: "success", label: "Success" },
  { value: "failed", label: "Failed" },
];

const PAGE_SIZE = 20;

export function Downloads() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<DownloadStatus | "all">(
    "all",
  );

  const { data, isLoading, isError, error } = useQuery({
    queryKey: [
      "downloads",
      { page, pageSize: PAGE_SIZE, status: statusFilter },
    ],
    queryFn: () =>
      fetchDownloads({ page, pageSize: PAGE_SIZE, status: statusFilter }),
    refetchInterval: 5000,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["downloads"] });

  const startMutation = useMutation({
    mutationFn: startDownload,
    onSuccess: invalidate,
  });

  const stopMutation = useMutation({
    mutationFn: stopDownload,
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: deleteDownload,
    onSuccess: invalidate,
  });

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 1;

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <label htmlFor="status-filter" className="text-sm font-medium">
          Filter by status:
        </label>
        <Select
          value={statusFilter}
          onValueChange={(v) => {
            setStatusFilter(v as DownloadStatus | "all");
            setPage(1);
          }}
        >
          <SelectTrigger className="w-40" id="status-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_FILTERS.map((f) => (
              <SelectItem key={f.value} value={f.value}>
                {f.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {data && (
          <span className="text-sm text-muted-foreground ml-auto">
            {data.total} total
          </span>
        )}

        <CreateDownloadDialog onCreated={invalidate} />
      </div>

      {/* Table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Downloads</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isError && (
            <div className="flex items-center gap-2 p-6 text-destructive">
              <AlertCircle size={16} />
              <span className="text-sm">{(error as Error).message}</span>
            </div>
          )}

          {isLoading && !data ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-10 bg-muted rounded animate-pulse" />
              ))}
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Title / URL</TableHead>
                      <TableHead className="hidden lg:table-cell">
                        Type
                      </TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="hidden md:table-cell w-36">
                        Progress
                      </TableHead>
                      <TableHead className="hidden sm:table-cell">
                        Created
                      </TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {!data?.items.length ? (
                      <TableRow>
                        <TableCell
                          colSpan={6}
                          className="text-center py-10 text-muted-foreground"
                        >
                          No downloads found
                        </TableCell>
                      </TableRow>
                    ) : (
                      data.items.map((dl) => (
                        <TableRow key={dl.id}>
                          <TableCell>
                            <div className="max-w-[220px]">
                              <p
                                className="font-medium text-sm truncate"
                                title={dl.title}
                              >
                                {dl.title || "(no title)"}
                              </p>
                              <p
                                className="text-xs text-muted-foreground truncate"
                                title={dl.url}
                              >
                                {dl.url}
                              </p>
                            </div>
                          </TableCell>
                          <TableCell className="hidden lg:table-cell">
                            <Badge
                              variant="outline"
                              className="capitalize text-xs"
                            >
                              {dl.type}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <StatusBadge status={dl.status} />
                          </TableCell>
                          <TableCell className="hidden md:table-cell">
                            {dl.progress != null ? (
                              <div className="space-y-1">
                                <Progress
                                  value={dl.progress}
                                  className="h-1.5 w-28"
                                />
                                <span className="text-xs text-muted-foreground">
                                  {dl.progress}%
                                  {dl.speed ? ` · ${dl.speed}` : ""}
                                </span>
                              </div>
                            ) : (
                              <span className="text-muted-foreground text-xs">
                                —
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="hidden sm:table-cell text-xs text-muted-foreground whitespace-nowrap">
                            {new Date(dl.createdAt).toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              {(dl.status === "queued" ||
                                dl.status === "paused") && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  aria-label="Start download"
                                  disabled={startMutation.isPending}
                                  onClick={() => startMutation.mutate(dl.id)}
                                >
                                  <Play size={14} />
                                </Button>
                              )}
                              {dl.status === "downloading" && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  aria-label="Stop download"
                                  disabled={stopMutation.isPending}
                                  onClick={() => stopMutation.mutate(dl.id)}
                                >
                                  <Square size={14} />
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label="Delete download"
                                disabled={deleteMutation.isPending}
                                onClick={() => deleteMutation.mutate(dl.id)}
                                className="text-destructive hover:text-destructive"
                              >
                                <Trash2 size={14} />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t">
                  <span className="text-sm text-muted-foreground">
                    Page {page} of {totalPages}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => p - 1)}
                      aria-label="Previous page"
                    >
                      <ChevronLeft size={14} />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page >= totalPages}
                      onClick={() => setPage((p) => p + 1)}
                      aria-label="Next page"
                    >
                      <ChevronRight size={14} />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
