import { useQuery } from "@tanstack/react-query";
import {
  Server,
  BrainCircuit,
  Download,
  CheckCircle,
  XCircle,
  Clock,
  Cpu,
  HardDrive,
  TrendingDown,
  type LucideIcon,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import { Progress } from "../components/ui/progress";
import { StatusBadge } from "../components/StatusBadge";
import { fetchAllHealth } from "../api/health";
import { fetchDownloads, fetchDownloadStats } from "../api/downloads";
import { cn } from "../components/ui/utils";

function StatCard({
  title,
  value,
  icon: Icon,
  description,
  className,
}: {
  title: string;
  value: string | number;
  icon: LucideIcon;
  description?: string;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon size={16} className="text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {description && (
          <p className="text-xs text-muted-foreground mt-1">{description}</p>
        )}
      </CardContent>
    </Card>
  );
}

function ServiceHealthCard({
  name,
  ok,
  detail,
  icon: Icon,
}: {
  name: string;
  ok: boolean;
  detail?: string;
  icon: LucideIcon;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
        <CardTitle className="text-sm font-medium">{name}</CardTitle>
        <Icon size={16} className="text-muted-foreground" />
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "h-2.5 w-2.5 rounded-full",
              ok ? "bg-green-500" : "bg-red-500",
            )}
          />
          <span className="text-sm font-semibold">
            {ok ? "Online" : "Offline"}
          </span>
        </div>
        {detail && <p className="text-xs text-muted-foreground">{detail}</p>}
      </CardContent>
    </Card>
  );
}

export function Dashboard() {
  const { data: health, isLoading: healthLoading } = useQuery({
    queryKey: ["health"],
    queryFn: fetchAllHealth,
    refetchInterval: 10000,
  });

  const { data: stats } = useQuery({
    queryKey: ["download-stats"],
    queryFn: fetchDownloadStats,
    refetchInterval: 5000,
  });

  const { data: recentDownloads, isLoading: downloadsLoading } = useQuery({
    queryKey: ["downloads", { page: 1, pageSize: 10 }],
    queryFn: () => fetchDownloads({ page: 1, pageSize: 10 }),
    refetchInterval: 5000,
  });

  const gpuData = health?.ai.data;
  const gpuPercent =
    gpuData?.gpu_memory_used != null && gpuData?.gpu_memory_total != null
      ? Math.round((gpuData.gpu_memory_used / gpuData.gpu_memory_total) * 100)
      : null;

  return (
    <div className="space-y-6">
      {/* Service health */}
      <section aria-label="Service health">
        <h2 className="text-sm font-medium text-muted-foreground mb-3">
          Service Health
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {healthLoading ? (
            <>
              {[1, 2].map((i) => (
                <Card key={i} className="animate-pulse">
                  <CardHeader className="pb-2">
                    <div className="h-4 bg-muted rounded w-24" />
                  </CardHeader>
                  <CardContent>
                    <div className="h-5 bg-muted rounded w-16" />
                  </CardContent>
                </Card>
              ))}
            </>
          ) : (
            <>
              <ServiceHealthCard
                name="Go Download Backend"
                ok={health?.go.ok ?? false}
                detail={`Port 8080${health?.go.data?.version ? ` · v${health.go.data.version}` : ""}`}
                icon={Server}
              />
              <ServiceHealthCard
                name="AI Service"
                ok={health?.ai.ok ?? false}
                detail={
                  health?.ai.data?.gpu_name
                    ? `GPU: ${health.ai.data.gpu_name}`
                    : health?.ai.ok
                      ? "Port 8899"
                      : "Port 8899 · unreachable"
                }
                icon={BrainCircuit}
              />
              {gpuPercent != null && (
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                    <CardTitle className="text-sm font-medium">
                      GPU Memory
                    </CardTitle>
                    <Cpu size={16} className="text-muted-foreground" />
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="text-2xl font-bold">{gpuPercent}%</div>
                    <Progress value={gpuPercent} className="h-2" />
                    <p className="text-xs text-muted-foreground">
                      {gpuData?.gpu_memory_used} / {gpuData?.gpu_memory_total}{" "}
                      MB
                    </p>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </div>
      </section>

      {/* Download stats */}
      <section aria-label="Download statistics">
        <h2 className="text-sm font-medium text-muted-foreground mb-3">
          Download Statistics
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCard
            title="Total Downloads"
            value={stats?.total ?? "—"}
            icon={HardDrive}
          />
          <StatCard
            title="Active"
            value={stats?.active ?? "—"}
            icon={Download}
            description="currently downloading"
          />
          <StatCard
            title="Completed"
            value={stats?.completed ?? "—"}
            icon={CheckCircle}
          />
          <StatCard
            title="Failed"
            value={stats?.failed ?? "—"}
            icon={XCircle}
          />
        </div>
      </section>

      {/* Recent downloads */}
      <section aria-label="Recent downloads">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">Recent Downloads</CardTitle>
                <CardDescription>Last 10 download tasks</CardDescription>
              </div>
              <TrendingDown size={16} className="text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {downloadsLoading ? (
              <div className="p-6 space-y-3">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="h-8 bg-muted rounded animate-pulse" />
                ))}
              </div>
            ) : !recentDownloads?.items.length ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <Clock size={32} className="mb-2 opacity-50" />
                <p className="text-sm">No downloads yet</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead className="hidden md:table-cell">Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden sm:table-cell">
                      Created
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentDownloads.items.map((dl) => (
                    <TableRow key={dl.id}>
                      <TableCell
                        className="font-medium max-w-[200px] truncate"
                        title={dl.title}
                      >
                        {dl.title || dl.url}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <Badge variant="outline" className="capitalize">
                          {dl.type}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={dl.status} />
                      </TableCell>
                      <TableCell className="hidden sm:table-cell text-muted-foreground text-xs">
                        {new Date(dl.createdAt).toLocaleDateString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
