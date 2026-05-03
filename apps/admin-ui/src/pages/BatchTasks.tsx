import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  AlertCircle,
  CheckCircle,
  XCircle,
  Loader2,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Button } from "../components/ui/button";
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
import { Textarea } from "../components/ui/textarea";
import { Progress } from "../components/ui/progress";
import { StatusBadge } from "../components/StatusBadge";
import { Badge } from "../components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import {
  fetchBatchTasks,
  fetchBatchTask,
  createBatchTask,
  deleteBatchTask,
  type BatchTask,
} from "../api/batch";
import { cn } from "../components/ui/utils";

function CreateTaskDialog({ onSuccess }: { onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [urlsText, setUrlsText] = useState("");

  const mutation = useMutation({
    mutationFn: createBatchTask,
    onSuccess: () => {
      setOpen(false);
      setName("");
      setUrlsText("");
      onSuccess();
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const urls = urlsText
      .split("\n")
      .map((u) => u.trim())
      .filter(Boolean);
    if (!name.trim() || urls.length === 0) return;
    mutation.mutate({ name: name.trim(), urls });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus size={14} />
          New Batch Task
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Create Batch Task</DialogTitle>
            <DialogDescription>
              Enter a task name and paste one URL per line.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="task-name">Task Name</Label>
              <Input
                id="task-name"
                placeholder="e.g. News batch 2024-05"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="task-urls">URLs (one per line)</Label>
              <Textarea
                id="task-urls"
                placeholder={
                  "https://example.com/video1\nhttps://example.com/video2"
                }
                value={urlsText}
                onChange={(e) => setUrlsText(e.target.value)}
                rows={8}
                required
              />
              <p className="text-xs text-muted-foreground">
                {urlsText.split("\n").filter((u) => u.trim()).length} URL(s)
                entered
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending && (
                <Loader2 size={14} className="animate-spin" />
              )}
              Create Task
            </Button>
          </DialogFooter>
          {mutation.isError && (
            <p className="text-sm text-destructive mt-2">
              {(mutation.error as Error).message}
            </p>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}

function BatchTaskRow({
  task,
  onDelete,
}: {
  task: BatchTask;
  onDelete: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const { data: fullTask, isFetching } = useQuery({
    queryKey: ["batch-task", task.id],
    queryFn: () => fetchBatchTask(task.id),
    enabled: expanded,
    refetchInterval: expanded && task.status === "processing" ? 5000 : false,
  });

  const progress =
    task.total > 0
      ? Math.round(((task.completed + task.failed) / task.total) * 100)
      : 0;

  return (
    <>
      <TableRow
        className="cursor-pointer"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <TableCell>
          <div className="flex items-center gap-2">
            {expanded ? (
              <ChevronDown
                size={14}
                className="text-muted-foreground flex-shrink-0"
              />
            ) : (
              <ChevronRight
                size={14}
                className="text-muted-foreground flex-shrink-0"
              />
            )}
            <span className="font-medium text-sm">{task.name}</span>
          </div>
        </TableCell>
        <TableCell className="text-sm">{task.total}</TableCell>
        <TableCell>
          <div className="flex items-center gap-1.5">
            <CheckCircle size={12} className="text-green-500" />
            <span className="text-sm">{task.completed}</span>
          </div>
        </TableCell>
        <TableCell>
          <div className="flex items-center gap-1.5">
            <XCircle size={12} className="text-red-500" />
            <span className="text-sm">{task.failed}</span>
          </div>
        </TableCell>
        <TableCell className="w-36">
          <div className="space-y-1">
            <Progress value={progress} className="h-1.5" />
            <span className="text-xs text-muted-foreground">{progress}%</span>
          </div>
        </TableCell>
        <TableCell>
          <StatusBadge status={task.status} />
        </TableCell>
        <TableCell className="hidden sm:table-cell text-xs text-muted-foreground whitespace-nowrap">
          {new Date(task.createdAt).toLocaleString()}
        </TableCell>
        <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Delete task"
            className="text-destructive hover:text-destructive"
            onClick={() => onDelete(task.id)}
          >
            <Trash2 size={14} />
          </Button>
        </TableCell>
      </TableRow>

      {/* Expanded row with items */}
      {expanded && (
        <TableRow className="bg-muted/30">
          <TableCell colSpan={8} className="p-0">
            <div className="px-8 py-3">
              {isFetching && !fullTask ? (
                <div className="flex items-center gap-2 text-muted-foreground py-2">
                  <Loader2 size={14} className="animate-spin" />
                  <span className="text-sm">Loading items...</span>
                </div>
              ) : !fullTask?.items?.length ? (
                <p className="text-sm text-muted-foreground py-2">
                  No items available
                </p>
              ) : (
                <div className="space-y-1.5 max-h-64 overflow-y-auto">
                  {fullTask.items.map((item) => (
                    <div
                      key={item.id}
                      className={cn(
                        "flex items-center gap-3 rounded px-3 py-1.5 text-sm",
                        item.status === "success" &&
                          "bg-green-50 dark:bg-green-950/30",
                        item.status === "failed" &&
                          "bg-red-50 dark:bg-red-950/30",
                        item.status === "processing" &&
                          "bg-blue-50 dark:bg-blue-950/30",
                        item.status === "queued" && "bg-background",
                      )}
                    >
                      <Badge
                        variant={
                          item.status === "success"
                            ? "success"
                            : item.status === "failed"
                              ? "destructive"
                              : item.status === "processing"
                                ? "info"
                                : "gray"
                        }
                        className="text-xs flex-shrink-0"
                      >
                        {item.status}
                      </Badge>
                      <span
                        className="truncate text-xs text-muted-foreground flex-1"
                        title={item.url}
                      >
                        {item.url}
                      </span>
                      {item.title && (
                        <span className="hidden md:inline text-xs truncate max-w-[200px]">
                          {item.title}
                        </span>
                      )}
                      {item.error && (
                        <span
                          className="text-xs text-destructive truncate max-w-[160px]"
                          title={item.error}
                        >
                          {item.error}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

export function BatchTasks() {
  const queryClient = useQueryClient();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["batch-tasks"],
    queryFn: fetchBatchTasks,
    refetchInterval: 5000,
  });

  const deleteMutation = useMutation({
    mutationFn: deleteBatchTask,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["batch-tasks"] }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {data ? `${data.total} batch task(s)` : ""}
        </p>
        <CreateTaskDialog
          onSuccess={() =>
            queryClient.invalidateQueries({ queryKey: ["batch-tasks"] })
          }
        />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Batch Tasks</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isError && (
            <div className="flex items-center gap-2 p-6 text-destructive">
              <AlertCircle size={16} />
              <span className="text-sm">{(error as Error).message}</span>
            </div>
          )}

          {isLoading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-10 bg-muted rounded animate-pulse" />
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Done</TableHead>
                  <TableHead>Failed</TableHead>
                  <TableHead className="w-36">Progress</TableHead>
                  <TableHead>Status</TableHead>
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
                      colSpan={8}
                      className="text-center py-10 text-muted-foreground"
                    >
                      No batch tasks yet. Create one to get started.
                    </TableCell>
                  </TableRow>
                ) : (
                  data.items.map((task) => (
                    <BatchTaskRow
                      key={task.id}
                      task={task}
                      onDelete={(id) => deleteMutation.mutate(id)}
                    />
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
