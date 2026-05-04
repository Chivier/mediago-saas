import { useEffect, useState } from "react";
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
  QrCode,
  CheckCircle2,
  LogIn,
  LogOut,
  Pencil,
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
  startBiliQrLogin,
  pollBiliQrLogin,
  fetchPlatformLogins,
  savePlatformLogin,
  deletePlatformLogin,
  type Creator,
  type Platform,
  type FollowVideo,
  type QrStart,
  type QrPollStatus,
  type PlatformLogin,
} from "../api/follows";
import { Mindmap } from "../components/Mindmap";

// ─── Bilibili QR scan dialog ────────────────────────────────────────────────────

const QR_POLL_INTERVAL_MS = 2000;

function statusLabel(s: QrPollStatus | "idle"): {
  text: string;
  tone: "muted" | "info" | "success" | "danger";
} {
  switch (s) {
    case "pending":
      return { text: "Waiting for scan…", tone: "muted" };
    case "scanned":
      return { text: "Scanned — confirm on your phone", tone: "info" };
    case "confirmed":
      return { text: "Logged in", tone: "success" };
    case "expired":
      return { text: "QR expired — regenerate to try again", tone: "danger" };
    case "error":
      return { text: "Login failed", tone: "danger" };
    default:
      return { text: "", tone: "muted" };
  }
}

function QrScanButton({
  onSuccess,
  variant = "outline",
}: {
  // Called once with the cookie blob when login confirms. Caller decides
  // whether to drop it into a textarea or save it directly.
  onSuccess: (cookies: string) => void;
  variant?: "outline" | "default" | "ghost";
}) {
  const [open, setOpen] = useState(false);
  const [qr, setQr] = useState<QrStart | null>(null);
  const [status, setStatus] = useState<QrPollStatus | "idle">("idle");
  const [message, setMessage] = useState<string>("");
  const [starting, setStarting] = useState(false);
  // Bumped to re-trigger the lifecycle effect (Regenerate button).
  const [regenToken, setRegenToken] = useState(0);

  // Drive the lifecycle from `open` + `regenToken` so closing the dialog
  // reliably stops the poll loop and Regenerate restarts it. Once status
  // reaches a terminal state the polling chain clears itself.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let timer: number | undefined;

    const poll = async (key: string) => {
      if (cancelled) return;
      try {
        const result = await pollBiliQrLogin(key);
        if (cancelled) return;
        setStatus(result.status);
        setMessage(result.message ?? "");
        if (result.status === "confirmed" && result.cookies) {
          onSuccess(result.cookies);
          // Brief pause so the user sees the success state before close.
          timer = window.setTimeout(() => {
            if (!cancelled) setOpen(false);
          }, 600);
          return;
        }
        const terminal =
          result.status === "expired" || result.status === "error";
        if (!terminal) {
          timer = window.setTimeout(() => poll(key), QR_POLL_INTERVAL_MS);
        }
      } catch (e) {
        if (cancelled) return;
        setStatus("error");
        setMessage((e as Error).message);
      }
    };

    void (async () => {
      setStarting(true);
      setStatus("idle");
      setMessage("");
      setQr(null);
      try {
        const fresh = await startBiliQrLogin();
        if (cancelled) return;
        setQr(fresh);
        setStatus("pending");
        timer = window.setTimeout(
          () => poll(fresh.qrcodeKey),
          QR_POLL_INTERVAL_MS,
        );
      } catch (e) {
        if (cancelled) return;
        setStatus("error");
        setMessage((e as Error).message);
      } finally {
        if (!cancelled) setStarting(false);
      }
    })();

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
    // onSuccess is intentionally excluded — callers pass an inline arrow,
    // and we don't want a re-poll every render. Identity is captured at
    // open-time which is the moment that matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, regenToken]);

  const regenerate = () => setRegenToken((t) => t + 1);

  const label = statusLabel(status);
  const isTerminal =
    status === "confirmed" || status === "expired" || status === "error";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant={variant} size="sm">
          <QrCode size={14} />
          Scan QR
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Bilibili QR login</DialogTitle>
          <DialogDescription>
            Open the Bilibili mobile app → top-left scan icon → point at the
            code. Cookies stay on this server only.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-3 py-2">
          <div className="relative h-56 w-56 rounded-md border bg-white flex items-center justify-center overflow-hidden">
            {starting || !qr ? (
              <Loader2
                size={28}
                className="animate-spin text-muted-foreground"
              />
            ) : (
              <img
                src={`data:image/png;base64,${qr.qrPngB64}`}
                alt="Bilibili login QR"
                className="h-full w-full object-contain"
              />
            )}
            {status === "scanned" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-blue-50/85 text-blue-700">
                <CheckCircle2 size={36} />
                <span className="text-sm font-medium">
                  Confirm on your phone
                </span>
              </div>
            )}
            {status === "confirmed" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-emerald-50/90 text-emerald-700">
                <CheckCircle2 size={36} />
                <span className="text-sm font-medium">Logged in</span>
              </div>
            )}
            {status === "expired" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-muted/90 text-muted-foreground text-sm">
                <AlertCircle size={28} />
                <span>QR expired</span>
              </div>
            )}
          </div>

          <div
            className={
              "text-sm " +
              (label.tone === "success"
                ? "text-emerald-600"
                : label.tone === "danger"
                  ? "text-destructive"
                  : label.tone === "info"
                    ? "text-blue-600"
                    : "text-muted-foreground")
            }
          >
            {label.text}
            {message && status === "error" ? ` — ${message}` : null}
          </div>
        </div>

        <DialogFooter className="gap-2">
          {isTerminal && status !== "confirmed" && (
            <Button type="button" variant="outline" onClick={regenerate}>
              <RefreshCw size={14} />
              Regenerate
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Platform-level login card ─────────────────────────────────────────────────

const PLATFORM_DISPLAY: Record<
  Platform,
  { name: string; supportsQr: boolean; note: string }
> = {
  bilibili: {
    name: "Bilibili",
    supportsQr: true,
    note: "Scan to log in across all Bilibili creators. Required to fetch paid videos and to dodge risk-control on space queries.",
  },
  youtube: {
    name: "YouTube",
    supportsQr: false,
    note: "Most public channels work without auth. Paste a cookies.txt header here only if you need to follow member-only / age-gated channels.",
  },
};

function ManualCookiesDialog({
  platform,
  hasCookies,
  onSaved,
  trigger,
}: {
  platform: Platform;
  hasCookies: boolean;
  onSaved: () => void;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [cookies, setCookies] = useState("");
  const mutation = useMutation({
    mutationFn: (value: string) => savePlatformLogin(platform, value),
    onSuccess: () => {
      setOpen(false);
      setCookies("");
      onSaved();
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!cookies.trim()) return;
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
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {hasCookies ? "Update" : "Set"} {PLATFORM_DISPLAY[platform].name}{" "}
            cookies
          </DialogTitle>
          <DialogDescription>
            Paste a logged-in cookie row from DevTools → Application → Cookies.{" "}
            {platform === "bilibili"
              ? "SESSDATA + bili_jct are the most important fields."
              : "Format: k=v; k=v; ..."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <Textarea
            placeholder={
              hasCookies
                ? "(currently configured — paste a new value to replace)"
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
          <DialogFooter>
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

function PlatformLoginRow({
  login,
  onChange,
}: {
  login: PlatformLogin;
  onChange: () => void;
}) {
  const meta = PLATFORM_DISPLAY[login.platform];
  // Bilibili-only: clicking "Login with QR" runs the QR flow then
  // immediately PUTs the resulting blob to /platform-logins so the row
  // updates without an extra step.
  const qrSaveMut = useMutation({
    mutationFn: (cookies: string) => savePlatformLogin(login.platform, cookies),
    onSuccess: onChange,
  });
  const logoutMut = useMutation({
    mutationFn: () => deletePlatformLogin(login.platform),
    onSuccess: onChange,
  });

  return (
    <div className="flex items-start justify-between gap-4 rounded-md border p-3">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-semibold">{meta.name}</h4>
          {login.hasCookies ? (
            <Badge variant="default" className="text-[10px] uppercase">
              <CheckCircle2 size={10} className="mr-1" />
              Logged in
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[10px] uppercase">
              Not logged in
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground max-w-xl">{meta.note}</p>
        {login.hasCookies && login.updatedAt && (
          <p className="text-[11px] text-muted-foreground">
            Updated {new Date(login.updatedAt).toLocaleString()}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {meta.supportsQr && (
          <QrScanButton
            onSuccess={(cookies) => qrSaveMut.mutate(cookies)}
            variant={login.hasCookies ? "outline" : "default"}
          />
        )}
        <ManualCookiesDialog
          platform={login.platform}
          hasCookies={login.hasCookies}
          onSaved={onChange}
          trigger={
            <Button variant="outline" size="sm">
              {login.hasCookies ? <Pencil size={14} /> : <LogIn size={14} />}
              {login.hasCookies ? "Edit cookies" : "Paste cookies"}
            </Button>
          }
        />
        {login.hasCookies && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (
                confirm(
                  `Log out of ${meta.name}? Per-creator cookies (if any) keep working.`,
                )
              )
                logoutMut.mutate();
            }}
            disabled={logoutMut.isPending}
            className="text-destructive hover:text-destructive"
          >
            {logoutMut.isPending ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <LogOut size={14} />
            )}
            Log out
          </Button>
        )}
      </div>
    </div>
  );
}

function PlatformLoginsCard() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["platform-logins"],
    queryFn: fetchPlatformLogins,
  });
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["platform-logins"] });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Platform logins</CardTitle>
        <CardDescription>
          One login covers all creators on that platform. Per-creator cookies
          (set via the key icon on each row) take precedence when you need a
          different account for a specific UP.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {isError && (
          <div className="flex items-center gap-2 text-destructive text-sm">
            <AlertCircle size={14} />
            {(error as Error).message}
          </div>
        )}
        {isLoading && !data ? (
          <div className="space-y-2">
            <div className="h-16 bg-muted rounded animate-pulse" />
            <div className="h-16 bg-muted rounded animate-pulse" />
          </div>
        ) : (
          (data?.items ?? []).map((login) => (
            <PlatformLoginRow
              key={login.platform}
              login={login}
              onChange={invalidate}
            />
          ))
        )}
      </CardContent>
    </Card>
  );
}

// ─── Add subscription dialog ────────────────────────────────────────────────────

function AddSubscriptionDialog({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [platform, setPlatform] = useState<Platform>("bilibili");
  const [externalId, setExternalId] = useState("");
  const [name, setName] = useState("");
  const [autoDownload, setAutoDownload] = useState(true);

  // Per-creator cookies were intentionally removed: the platform-level
  // login at the top of the page covers every creator on that platform.
  // Anyone needing platform-specific overrides can patch the row via the
  // API directly.

  const mutation = useMutation({
    mutationFn: addCreator,
    onSuccess: () => {
      setOpen(false);
      setExternalId("");
      setName("");
      setAutoDownload(true);
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
          {/* Per-creator cookies removed — the Bilibili / YouTube
              platform-level login at the top of this page applies to
              every creator without further input. */}
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
  const hasEntities =
    !!notes.entities &&
    Object.values(notes.entities).some(
      (arr) => Array.isArray(arr) && arr.length > 0,
    );
  return (
    <Tabs defaultValue="summary" className="w-full">
      <TabsList>
        <TabsTrigger value="summary">Summary</TabsTrigger>
        <TabsTrigger value="sections">Sections</TabsTrigger>
        <TabsTrigger value="mindmap">Mindmap</TabsTrigger>
        {hasEntities && <TabsTrigger value="entities">Entities</TabsTrigger>}
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

      {hasEntities && (
        <TabsContent value="entities" className="space-y-3 pt-2">
          {(
            [
              ["people", "人物"],
              ["works", "作品"],
              ["terms", "术语"],
              ["places", "地点"],
              ["events", "事件"],
            ] as const
          ).map(([key, label]) => {
            const items = (notes.entities ?? {})[key] ?? [];
            if (!items.length) return null;
            return (
              <div key={key}>
                <h5 className="text-xs font-semibold uppercase text-muted-foreground mb-1">
                  {label}
                </h5>
                <ul className="space-y-1">
                  {items.map((e, i) => (
                    <li key={i} className="text-sm">
                      <span className="font-medium">{e.name}</span>
                      {e.note ? (
                        <span className="text-muted-foreground">
                          {" "}
                          — {e.note}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          {notes.polish_notes && (
            <div className="border-t pt-3 mt-3">
              <h5 className="text-xs font-semibold uppercase text-muted-foreground mb-1">
                Polish notes
              </h5>
              <p className="text-xs text-muted-foreground whitespace-pre-wrap">
                {notes.polish_notes}
              </p>
            </div>
          )}
        </TabsContent>
      )}

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
            {video.isPaidPreview && (
              <Badge
                variant="destructive"
                className="text-[10px] uppercase w-fit"
                title={
                  video.actualDurationSeconds
                    ? `Only got ${Math.round(video.actualDurationSeconds / 60)}min of an expected ${video.duration} clip`
                    : "Paid / member-only — preview clip only"
                }
              >
                Paid preview
              </Badge>
            )}
            {video.notes?.polished && (
              <Badge
                variant="outline"
                className="text-[10px] uppercase w-fit"
                title="Final notes were validated by GPT-5.4"
              >
                ✦ polished
              </Badge>
            )}
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

// Inline tag editor: pencil button → dialog with comma-separated input.
// Comma-separated keeps the implementation tiny without sacrificing the
// per-tag mental model — paste in "电影解说, 哲学, 财经" and you get
// three chips back.
function TagsEditor({
  creator,
  onSaved,
}: {
  creator: Creator;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState((creator.tags ?? []).join(", "));

  const mutation = useMutation({
    mutationFn: (tags: string[]) => patchCreator(creator.id, { tags }),
    onSuccess: () => {
      setOpen(false);
      onSaved();
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const tags = text
      .split(/[,，]/)
      .map((t) => t.trim())
      .filter(Boolean);
    mutation.mutate(tags);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) setText((creator.tags ?? []).join(", "));
        else mutation.reset();
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Edit tags"
          title="Edit tags"
        >
          <Pencil size={14} />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tags for {creator.name}</DialogTitle>
          <DialogDescription>
            用逗号分隔多个标签，例如 <code>电影解说, 财经, 哲学</code>。
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <Input
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="电影解说, 哲学, ..."
          />
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
              ) : null}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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
            {creator.tags?.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {creator.tags.map((t) => (
                  <Badge
                    key={t}
                    variant="secondary"
                    className="text-[10px] py-0"
                  >
                    {t}
                  </Badge>
                ))}
              </div>
            )}
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
            {/* Per-creator cookie editor removed — the platform-level
                login card at the top of the Subscriptions page covers
                every creator. */}
            <TagsEditor creator={creator} onSaved={onChange} />
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
      <PlatformLoginsCard />
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
