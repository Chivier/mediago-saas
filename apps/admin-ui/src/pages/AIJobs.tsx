import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Send,
  Download,
  ChevronDown,
  ChevronRight,
  AlertCircle,
  Loader2,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { StatusBadge } from "../components/StatusBadge";
import { Progress } from "../components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import { Badge } from "../components/ui/badge";
import {
  fetchSubtitleJobs,
  submitSubtitleJob,
  fetchSummaryJobs,
  submitSummaryJob,
  getSubtitleDownloadUrl,
  type SubtitleLanguage,
  type SummaryLanguage,
} from "../api/ai";

function stageLabel(stage: string) {
  switch (stage) {
    case "queued":
      return "Queued";
    case "transcribing":
      return "Transcribing";
    case "summarizing":
      return "Summarizing";
    case "polishing":
      return "Polishing";
    case "done":
      return "Done";
    case "failed":
      return "Failed";
    default:
      return stage;
  }
}

function JobProgress({ stage, progressPercent }: { stage: string; progressPercent: number }) {
  return (
    <div className="flex flex-col gap-1 min-w-[150px]">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{stageLabel(stage)}</span>
        <span className="text-xs font-mono text-muted-foreground">{progressPercent}%</span>
      </div>
      <Progress value={progressPercent} className="h-2" />
    </div>
  );
}

// ─── Subtitle Tab ───────────────────────────────────────────────────────────────

function SubtitleForm({ onSuccess }: { onSuccess: () => void }) {
  const [filePath, setFilePath] = useState("");
  const [language, setLanguage] = useState<SubtitleLanguage>("auto");

  const mutation = useMutation({
    mutationFn: submitSubtitleJob,
    onSuccess: () => {
      setFilePath("");
      onSuccess();
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!filePath.trim()) return;
    mutation.mutate({ filePath: filePath.trim(), language });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
        <div className="sm:col-span-2 space-y-2">
          <Label htmlFor="subtitle-file">File Path</Label>
          <Input
            id="subtitle-file"
            placeholder="/data/videos/recording.mp4"
            value={filePath}
            onChange={(e) => setFilePath(e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="subtitle-lang">Language</Label>
          <Select
            value={language}
            onValueChange={(v) => setLanguage(v as SubtitleLanguage)}
          >
            <SelectTrigger id="subtitle-lang">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Auto Detect</SelectItem>
              <SelectItem value="zh">Chinese (zh)</SelectItem>
              <SelectItem value="en">English (en)</SelectItem>
              <SelectItem value="ja">Japanese (ja)</SelectItem>
              <SelectItem value="ko">Korean (ko)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Send size={14} />
          )}
          Submit Subtitle Job
        </Button>
        {mutation.isError && (
          <span className="text-sm text-destructive flex items-center gap-1">
            <AlertCircle size={14} />
            {(mutation.error as Error).message}
          </span>
        )}
        {mutation.isSuccess && (
          <span className="text-sm text-green-600">
            Job submitted successfully
          </span>
        )}
      </div>
    </form>
  );
}

function SubtitleJobsTable() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["subtitle-jobs"],
    queryFn: fetchSubtitleJobs,
    refetchInterval: 5000,
  });

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-10 bg-muted rounded animate-pulse" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center gap-2 text-destructive py-4">
        <AlertCircle size={16} />
        <span className="text-sm">{(error as Error).message}</span>
      </div>
    );
  }

  if (!data?.items.length) {
    return (
      <p className="text-sm text-muted-foreground py-4">
        No subtitle jobs yet.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>File</TableHead>
          <TableHead>Language</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="hidden md:table-cell">Progress</TableHead>
          <TableHead className="hidden sm:table-cell">Created</TableHead>
          <TableHead className="text-right">Action</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.items.map((job) => (
          <TableRow key={job.id}>
            <TableCell
              className="max-w-[200px] truncate text-sm font-mono"
              title={job.filePath}
            >
              {job.filePath.split("/").pop()}
            </TableCell>
            <TableCell>
              <Badge variant="outline" className="uppercase text-xs">
                {job.language}
              </Badge>
            </TableCell>
            <TableCell>
              <div className="flex flex-col gap-0.5">
                <StatusBadge status={job.status} />
                {job.error && (
                  <span
                    className="text-xs text-destructive truncate max-w-[160px]"
                    title={job.error}
                  >
                    {job.error}
                  </span>
                )}
              </div>
            </TableCell>
            <TableCell className="hidden md:table-cell">
              <JobProgress
                stage={job.stage}
                progressPercent={job.progressPercent}
              />
            </TableCell>
            <TableCell className="hidden sm:table-cell text-xs text-muted-foreground whitespace-nowrap">
              {new Date(job.createdAt).toLocaleString()}
            </TableCell>
            <TableCell className="text-right">
              {job.status === "done" && (
                <Button variant="outline" size="sm" asChild>
                  <a
                    href={getSubtitleDownloadUrl(job.id)}
                    download
                    aria-label="Download SRT file"
                  >
                    <Download size={12} />
                    Download SRT
                  </a>
                </Button>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// ─── Summary Tab ────────────────────────────────────────────────────────────────

function SummaryForm({ onSuccess }: { onSuccess: () => void }) {
  const [filePath, setFilePath] = useState("");
  const [title, setTitle] = useState("");
  const [language, setLanguage] = useState<SummaryLanguage>("auto");

  const mutation = useMutation({
    mutationFn: submitSummaryJob,
    onSuccess: () => {
      setFilePath("");
      setTitle("");
      onSuccess();
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!filePath.trim()) return;
    mutation.mutate({
      filePath: filePath.trim(),
      title: title.trim() || undefined,
      language,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="summary-file">File Path</Label>
          <Input
            id="summary-file"
            placeholder="/data/videos/interview.mp4"
            value={filePath}
            onChange={(e) => setFilePath(e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="summary-title">
            Title <span className="text-muted-foreground font-normal">(optional)</span>
          </Label>
          <Input
            id="summary-title"
            placeholder="Video title or context"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
      </div>
      <div className="flex items-end gap-4">
        <div className="space-y-2">
          <Label htmlFor="summary-lang">Output Language</Label>
          <Select
            value={language}
            onValueChange={(v) => setLanguage(v as SummaryLanguage)}
          >
            <SelectTrigger id="summary-lang" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Auto</SelectItem>
              <SelectItem value="zh">Chinese (zh)</SelectItem>
              <SelectItem value="en">English (en)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Send size={14} />
          )}
          Submit Summary Job
        </Button>
        {mutation.isError && (
          <span className="text-sm text-destructive flex items-center gap-1">
            <AlertCircle size={14} />
            {(mutation.error as Error).message}
          </span>
        )}
      </div>
    </form>
  );
}

function SummaryJobRow({ job }: { job: import("../api/ai").SummaryJob }) {
  const [expanded, setExpanded] = useState(false);
  const hasSummary =
    job.status === "done" && (job.summary || job.keyPoints?.length);

  return (
    <>
      <TableRow
        className={hasSummary ? "cursor-pointer" : undefined}
        onClick={() => hasSummary && setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <TableCell>
          <div className="flex items-center gap-2">
            {hasSummary &&
              (expanded ? (
                <ChevronDown
                  size={14}
                  className="text-muted-foreground flex-shrink-0"
                />
              ) : (
                <ChevronRight
                  size={14}
                  className="text-muted-foreground flex-shrink-0"
                />
              ))}
            <div>
              {job.title && <p className="text-sm font-medium">{job.title}</p>}
              <p
                className="text-xs text-muted-foreground font-mono truncate max-w-[200px]"
                title={job.filePath}
              >
                {job.filePath.split("/").pop()}
              </p>
            </div>
          </div>
        </TableCell>
        <TableCell>
          <Badge variant="outline" className="uppercase text-xs">
            {job.language}
          </Badge>
        </TableCell>
        <TableCell>
          <div className="flex flex-col gap-0.5">
            <StatusBadge status={job.status} />
            {job.error && (
              <span className="text-xs text-destructive" title={job.error}>
                {job.error}
              </span>
            )}
          </div>
        </TableCell>
        <TableCell className="hidden md:table-cell">
          <JobProgress stage={job.stage} progressPercent={job.progressPercent} />
        </TableCell>
        <TableCell className="hidden sm:table-cell text-xs text-muted-foreground whitespace-nowrap">
          {new Date(job.createdAt).toLocaleString()}
        </TableCell>
      </TableRow>

      {expanded && hasSummary && (
        <TableRow className="bg-muted/20">
          <TableCell colSpan={5} className="py-4 px-6">
            <div className="space-y-3 max-w-3xl">
              {job.summary && (
                <div>
                  <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-1">
                    Summary
                  </h4>
                  <p className="text-sm leading-relaxed">{job.summary}</p>
                </div>
              )}
              {job.keyPoints && job.keyPoints.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-1">
                    Key Points
                  </h4>
                  <ul className="space-y-1">
                    {job.keyPoints.map((point, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        <span className="text-primary font-medium mt-0.5">·</span>
                        <span>{point}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function SummaryJobsTable() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["summary-jobs"],
    queryFn: fetchSummaryJobs,
    refetchInterval: 5000,
  });

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-10 bg-muted rounded animate-pulse" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center gap-2 text-destructive py-4">
        <AlertCircle size={16} />
        <span className="text-sm">{(error as Error).message}</span>
      </div>
    );
  }

  if (!data?.items.length) {
    return (
      <p className="text-sm text-muted-foreground py-4">No summary jobs yet.</p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>File / Title</TableHead>
          <TableHead>Language</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="hidden md:table-cell">Progress</TableHead>
          <TableHead className="hidden sm:table-cell">Created</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.items.map((job) => (
          <SummaryJobRow key={job.id} job={job} />
        ))}
      </TableBody>
    </Table>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────────

export function AIJobs() {
  const queryClient = useQueryClient();

  return (
    <div className="space-y-6">
      <Tabs defaultValue="subtitles">
        <TabsList>
          <TabsTrigger value="subtitles">Subtitles</TabsTrigger>
          <TabsTrigger value="summaries">Summaries</TabsTrigger>
        </TabsList>

        <TabsContent value="subtitles" className="space-y-6 mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Generate Subtitles</CardTitle>
              <CardDescription>
                Submit a video or audio file to FUNASR for speech-to-text transcription.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SubtitleForm
                onSuccess={() =>
                  queryClient.invalidateQueries({ queryKey: ["subtitle-jobs"] })
                }
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Subtitle Jobs</CardTitle>
              <CardDescription>
                Auto-refreshes every 5 seconds. Click "Download SRT" when done.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <SubtitleJobsTable />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="summaries" className="space-y-6 mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Generate Summary</CardTitle>
              <CardDescription>
                Submit a file path for LM Studio summarization. Expand completed jobs to view results.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SummaryForm
                onSuccess={() =>
                  queryClient.invalidateQueries({ queryKey: ["summary-jobs"] })
                }
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Summary Jobs</CardTitle>
              <CardDescription>
                Track stage/progress and expand completed jobs to inspect results.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <SummaryJobsTable />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
