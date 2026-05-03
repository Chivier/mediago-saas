import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Trash2,
  RefreshCw,
  AlertCircle,
  Loader2,
  ChevronDown,
  ChevronRight,
  Download as DownloadIcon,
  X as XIcon,
  ExternalLink,
  KeyRound,
} from "lucide-react";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import {
  fetchCreators,
  addCreator,
  patchCreator,
  deleteCreator,
  refreshCreator,
  fetchCreatorVideos,
  queueVideo,
  skipVideo,
  type Creator,
  type Platform,
  type FollowVideo,
} from "../api/follows";
import { Mindmap } from "../components/Mindmap";

// ─── Add subscription dialog ────────────────────────────────────────────────────

function AddSubscriptionDialog({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [platform, setPlatform] = useState<Platform>("bilibili");
  const [externalId, setExternalId] = useState("");
  const [name, setName] = useState("");
  const [autoDownload, setAutoDownload] = useState(true);
  const [cookies, setCookies] = useState("");

  const mutation = useMutation({
    mutationFn: addCreator,
    onSuccess: () => {
      setOpen(false);
      setExternalId("");
      setName("");
      setAutoDownload(true);
      setCookies("");
      onAdded();
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedExternal = externalId.trim();
    const trimmedName = name.trim();
    if (!trimmedExternal && !trimmedName) return;
    mutation.mutate({
      platform,
      externalId: trimmedExternal || undefined,
      name: trimmedName || undefined,
      autoDownload,
      cookies: cookies.trim() || undefined,
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
          Add subscription
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Follow a new creator</DialogTitle>
          <DialogDescription>
            Bilibili: provide the UP's mid OR the display name (we'll resolve
            via search). YouTube: provide the channel id (UCxxxx…).
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="sub-platform">Platform</Label>
              <Select
                value={platform}
                onValueChange={(v) => setPlatform(v as Platform)}
              >
                <SelectTrigger id="sub-platform">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bilibili">Bilibili</SelectItem>
                  <SelectItem value="youtube">YouTube</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="sub-external">
                {platform === "bilibili" ? "mid (optional)" : "channel_id"}
              </Label>
              <Input
                id="sub-external"
                placeholder={
                  platform === "bilibili" ? "9964762" : "UCxxxxxxxxxxxxx"
                }
                value={externalId}
                onChange={(e) => setExternalId(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="sub-name">
              {platform === "bilibili"
                ? "Display name (or use as search keyword)"
                : "Display name"}
            </Label>
            <Input
              id="sub-name"
              placeholder={
                platform === "bilibili" ? "五道口纳什" : "channel display name"
              }
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              id="sub-auto"
              type="checkbox"
              checked={autoDownload}
              onChange={(e) => setAutoDownload(e.target.checked)}
            />
            <Label htmlFor="sub-auto" className="cursor-pointer text-sm">
              Auto-queue new uploads at mediago-core
            </Label>
          </div>
          {platform === "bilibili" && (
            <div className="space-y-2">
              <Label htmlFor="sub-cookies">
                Cookies{" "}
                <span className="font-normal text-muted-foreground">
                  (optional — needed for risk-control bypass and paid videos)
                </span>
              </Label>
              <Textarea
                id="sub-cookies"
                placeholder="SESSDATA=xxx; bili_jct=yyy; buvid3=zzz; ..."
                rows={3}
                value={cookies}
                onChange={(e) => setCookies(e.target.value)}
                className="font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground">
                Open bilibili.com in a logged-in browser → DevTools →
                Application → Cookies → copy the whole row as
                <code className="mx-1 rounded bg-muted px-1">
                  k=v; k=v; ...
                </code>
                . SESSDATA + bili_jct are the most important.
              </p>
            </div>
          )}
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
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Plus size={14} />
              )}
              Add
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Per-creator cookies editor ────────────────────────────────────────────────

function EditCookiesDialog({
  creator,
  onSaved,
}: {
  creator: Creator;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  // We never load existing cookies from the server (the API doesn't echo
  // them back). Empty input on open means "leave alone unless I type
  // something or hit Clear".
  const [cookies, setCookies] = useState("");

  const mutation = useMutation({
    mutationFn: (value: string) => patchCreator(creator.id, { cookies: value }),
    onSuccess: () => {
      setOpen(false);
      setCookies("");
      onSaved();
    },
  });

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    mutation.mutate(cookies.trim());
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) {
          mutation.reset();
          setCookies("");
        }
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Edit cookies"
          title={
            creator.hasCookies
              ? "Cookies configured — click to update"
              : "Set cookies (needed for paid videos / risk-control bypass)"
          }
        >
          <KeyRound
            size={14}
            className={creator.hasCookies ? "text-emerald-600" : ""}
          />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cookies for {creator.name}</DialogTitle>
          <DialogDescription>
            {creator.platform === "bilibili"
              ? "Paste a logged-in cookie row (SESSDATA + bili_jct minimum). Required to download paid/member-only videos and to dodge risk-control on space queries."
              : "Auth cookies for this creator's source platform."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="space-y-3">
          <Textarea
            placeholder={
              creator.hasCookies
                ? "(currently configured — paste a new value to replace, or leave empty + click Clear to remove)"
                : "SESSDATA=xxx; bili_jct=yyy; buvid3=zzz; ..."
            }
            rows={5}
            value={cookies}
            onChange={(e) => setCookies(e.target.value)}
            className="font-mono text-xs"
            autoFocus
          />
          {mutation.isError && (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertCircle size={14} />
              {(mutation.error as Error).message}
            </div>
          )}
          <DialogFooter className="gap-2">
            {creator.hasCookies && (
              <Button
                type="button"
                variant="outline"
                onClick={() => mutation.mutate("")}
                disabled={mutation.isPending}
                className="text-destructive"
              >
                Clear cookies
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={mutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={mutation.isPending || !cookies.trim()}
            >
              {mutation.isPending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : null}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Per-creator video panel + notes viewer ────────────────────────────────────

function VideoNotesPanel({ video }: { video: FollowVideo }) {
  const notes = video.notes;
  if (!notes) {
    return (
      <p className="text-sm text-muted-foreground italic px-2">
        AI notes not yet available ({video.aiStatus ?? "not started"}).
      </p>
    );
  }
  return (
    <Tabs defaultValue="summary" className="w-full">
      <TabsList>
        <TabsTrigger value="summary">Summary</TabsTrigger>
        <TabsTrigger value="sections">Sections</TabsTrigger>
        <TabsTrigger value="mindmap">Mindmap</TabsTrigger>
        <TabsTrigger value="transcript">Transcript</TabsTrigger>
      </TabsList>

      <TabsContent value="summary" className="space-y-3 pt-2">
        {notes.summary && (
          <div className="text-sm leading-relaxed whitespace-pre-wrap">
            {notes.summary}
          </div>
        )}
        {notes.key_topics && notes.key_topics.length > 0 && (
          <div>
            <h5 className="text-xs font-semibold uppercase text-muted-foreground mb-1">
              Key topics
            </h5>
            <div className="flex flex-wrap gap-1">
              {notes.key_topics.map((t, i) => (
                <Badge key={i} variant="outline" className="text-xs">
                  {t}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </TabsContent>

      <TabsContent value="sections" className="space-y-3 pt-2">
        {!notes.sections?.length ? (
          <p className="text-sm text-muted-foreground italic">
            No section breakdown.
          </p>
        ) : (
          notes.sections.map((sec, i) => (
            <div key={i} className="border-l-2 pl-3 space-y-1">
              <div className="flex items-baseline gap-2">
                <h5 className="text-sm font-semibold">
                  {sec.title || `Section ${i + 1}`}
                </h5>
                {sec.timestamp && (
                  <span className="text-xs text-muted-foreground font-mono">
                    {sec.timestamp}
                  </span>
                )}
              </div>
              {sec.summary && <p className="text-xs italic">{sec.summary}</p>}
              {sec.details && (
                <p className="text-sm whitespace-pre-wrap">{sec.details}</p>
              )}
              {sec.key_points && sec.key_points.length > 0 && (
                <ul className="space-y-0.5 mt-1">
                  {sec.key_points.map((p, j) => (
                    <li key={j} className="text-sm flex gap-1">
                      <span className="text-primary">·</span>
                      <span>{p}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))
        )}
      </TabsContent>

      <TabsContent value="mindmap" className="pt-2">
        <Mindmap source={notes.mindmap || ""} />
      </TabsContent>

      <TabsContent value="transcript" className="pt-2">
        {notes.transcript ? (
          <pre className="text-xs whitespace-pre-wrap bg-muted/50 rounded p-3 max-h-96 overflow-auto">
            {notes.transcript}
          </pre>
        ) : (
          <p className="text-sm text-muted-foreground italic">
            No transcript available.
          </p>
        )}
      </TabsContent>
    </Tabs>
  );
}

function VideoRow({
  video,
  onAfterAction,
}: {
  video: FollowVideo;
  onAfterAction: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const queueMut = useMutation({
    mutationFn: queueVideo,
    onSuccess: onAfterAction,
  });
  const skipMut = useMutation({
    mutationFn: skipVideo,
    onSuccess: onAfterAction,
  });
  const aiBadge = video.aiStatus ? (
    <Badge variant="outline" className="text-[10px] uppercase">
      AI {video.aiStatus}
    </Badge>
  ) : null;

  return (
    <>
      <TableRow
        className="cursor-pointer"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <TableCell className="w-6">
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </TableCell>
        <TableCell>
          <div className="max-w-[420px]">
            <p className="text-sm font-medium truncate" title={video.title}>
              {video.title}
            </p>
            <p
              className="text-xs text-muted-foreground font-mono truncate"
              title={video.url}
            >
              {video.externalId} · {video.pubDate ?? "—"}
            </p>
          </div>
        </TableCell>
        <TableCell>
          <div className="flex flex-col gap-1">
            <Badge
              variant={
                video.status === "succeeded"
                  ? "default"
                  : video.status === "failed"
                    ? "destructive"
                    : "outline"
              }
              className="text-xs uppercase w-fit"
            >
              {video.status}
            </Badge>
            {aiBadge}
          </div>
        </TableCell>
        <TableCell className="text-right">
          <div
            className="flex items-center justify-end gap-1"
            onClick={(e) => e.stopPropagation()}
          >
            {(video.status === "discovered" ||
              video.status === "skipped" ||
              video.status === "failed") && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => queueMut.mutate(video.id)}
                disabled={queueMut.isPending}
                aria-label="Queue download"
                title="Queue this video for download"
              >
                <DownloadIcon size={14} />
              </Button>
            )}
            {video.status === "discovered" && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => skipMut.mutate(video.id)}
                disabled={skipMut.isPending}
                aria-label="Skip"
                title="Mark as skipped"
              >
                <XIcon size={14} />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              asChild
              aria-label="Open on platform"
              title="Open on the source platform"
            >
              <a href={video.url} target="_blank" rel="noreferrer">
                <ExternalLink size={14} />
              </a>
            </Button>
          </div>
        </TableCell>
      </TableRow>
      {expanded && (
        <TableRow className="bg-muted/20">
          <TableCell colSpan={4} className="py-4 px-6">
            <VideoNotesPanel video={video} />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function CreatorVideosPanel({ creator }: { creator: Creator }) {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["follow-videos", creator.id],
    queryFn: () => fetchCreatorVideos(creator.id),
    refetchInterval: 15000,
  });

  if (isLoading)
    return (
      <p className="text-sm text-muted-foreground p-4">
        <Loader2 size={14} className="inline mr-2 animate-spin" />
        Loading videos…
      </p>
    );
  if (isError)
    return (
      <div className="flex items-center gap-2 p-4 text-destructive text-sm">
        <AlertCircle size={14} />
        {(error as Error).message}
      </div>
    );
  if (!data?.items.length)
    return (
      <p className="text-sm text-muted-foreground p-4 italic">
        No videos discovered yet — try refreshing the creator above.
      </p>
    );

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["follow-videos", creator.id] });

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-6"></TableHead>
          <TableHead>Title / id</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.items.map((v) => (
          <VideoRow key={v.id} video={v} onAfterAction={invalidate} />
        ))}
      </TableBody>
    </Table>
  );
}

function CreatorRow({
  creator,
  expanded,
  onToggle,
  onChange,
}: {
  creator: Creator;
  expanded: boolean;
  onToggle: () => void;
  onChange: () => void;
}) {
  const refreshMut = useMutation({
    mutationFn: () => refreshCreator(creator.id),
    onSuccess: onChange,
  });
  const patchMut = useMutation({
    mutationFn: (auto: boolean) =>
      patchCreator(creator.id, { autoDownload: auto }),
    onSuccess: onChange,
  });
  const deleteMut = useMutation({
    mutationFn: () => deleteCreator(creator.id),
    onSuccess: onChange,
  });

  return (
    <>
      <TableRow
        className="cursor-pointer"
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <TableCell className="w-6">
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </TableCell>
        <TableCell>
          <div>
            <p className="text-sm font-medium">{creator.name}</p>
            <p className="text-xs text-muted-foreground font-mono">
              {creator.platform} · {creator.externalId}
            </p>
            {creator.lastError && (
              <p
                className="text-xs text-destructive mt-0.5"
                title={creator.lastError}
              >
                last error: {creator.lastError.slice(0, 80)}
              </p>
            )}
          </div>
        </TableCell>
        <TableCell className="text-sm text-muted-foreground">
          {creator.videoCount}
        </TableCell>
        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
          {creator.lastCheckedAt
            ? new Date(creator.lastCheckedAt).toLocaleString()
            : "never"}
        </TableCell>
        <TableCell>
          <div onClick={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              checked={creator.autoDownload}
              onChange={(e) => patchMut.mutate(e.target.checked)}
              aria-label="Auto-download toggle"
            />
          </div>
        </TableCell>
        <TableCell className="text-right">
          <div
            className="flex items-center justify-end gap-1"
            onClick={(e) => e.stopPropagation()}
          >
            {creator.platform === "bilibili" && (
              <EditCookiesDialog creator={creator} onSaved={onChange} />
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => refreshMut.mutate()}
              disabled={refreshMut.isPending}
              aria-label="Refresh"
              title="Run refresh now"
            >
              {refreshMut.isPending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <RefreshCw size={14} />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                if (confirm(`Remove ${creator.name}?`)) deleteMut.mutate();
              }}
              disabled={deleteMut.isPending}
              className="text-destructive hover:text-destructive"
              aria-label="Delete"
            >
              <Trash2 size={14} />
            </Button>
          </div>
        </TableCell>
      </TableRow>
      {expanded && (
        <TableRow className="bg-muted/10">
          <TableCell colSpan={6} className="p-0">
            <CreatorVideosPanel creator={creator} />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

// ─── Main page ──────────────────────────────────────────────────────────────────

export function Subscriptions() {
  const queryClient = useQueryClient();
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["follow-creators"],
    queryFn: fetchCreators,
    refetchInterval: 30000,
  });

  const invalidateCreators = () =>
    queryClient.invalidateQueries({ queryKey: ["follow-creators"] });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base">Tracked creators</CardTitle>
            <CardDescription>
              Refreshed every 6h by the scheduler. Click a row to expand its
              videos and (when ready) the AI-generated notes.
            </CardDescription>
          </div>
          <AddSubscriptionDialog onAdded={invalidateCreators} />
        </CardHeader>
        <CardContent className="p-0">
          {isError && (
            <div className="flex items-center gap-2 p-6 text-destructive text-sm">
              <AlertCircle size={16} />
              {(error as Error).message}
            </div>
          )}
          {isLoading && !data ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-10 bg-muted rounded animate-pulse" />
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-6"></TableHead>
                  <TableHead>Creator</TableHead>
                  <TableHead>Videos</TableHead>
                  <TableHead>Last checked</TableHead>
                  <TableHead>Auto</TableHead>
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
                      No subscriptions yet — add one to start tracking.
                    </TableCell>
                  </TableRow>
                ) : (
                  data.items.map((c) => (
                    <CreatorRow
                      key={c.id}
                      creator={c}
                      expanded={expandedId === c.id}
                      onToggle={() =>
                        setExpandedId(expandedId === c.id ? null : c.id)
                      }
                      onChange={invalidateCreators}
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
