import { useQuery } from "@tanstack/react-query";
import {
  Server,
  BrainCircuit,
  Database,
  Info,
  CheckCircle,
  XCircle,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Badge } from "../components/ui/badge";
import { Separator } from "../components/ui/separator";
import { fetchGoHealth, fetchAiHealth } from "../api/health";
import { GO_API_URL, RESTFUL_API_URL, AI_API_URL } from "../api/client";

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-muted-foreground text-xs uppercase tracking-wide">
        {label}
      </Label>
      <Input
        value={value}
        readOnly
        className="font-mono text-sm bg-muted cursor-default"
        aria-label={label}
      />
    </div>
  );
}

function StatusIndicator({ ok }: { ok: boolean | undefined }) {
  if (ok === undefined) {
    return <Badge variant="gray">Checking...</Badge>;
  }
  return ok ? (
    <Badge variant="success" className="flex items-center gap-1">
      <CheckCircle size={10} />
      Online
    </Badge>
  ) : (
    <Badge variant="destructive" className="flex items-center gap-1">
      <XCircle size={10} />
      Offline
    </Badge>
  );
}

export function Settings() {
  const { data: goHealth, isLoading: goLoading } = useQuery({
    queryKey: ["go-health"],
    queryFn: fetchGoHealth,
    retry: 1,
  });

  const { data: aiHealth, isLoading: aiLoading } = useQuery({
    queryKey: ["ai-health"],
    queryFn: fetchAiHealth,
    retry: 1,
  });

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Environment info */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Info size={16} className="text-muted-foreground" />
            <CardTitle className="text-base">Environment</CardTitle>
          </div>
          <CardDescription>Read-only environment configuration</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ReadOnlyField label="Admin UI Version" value="0.1.0" />
          <ReadOnlyField label="Build Mode" value={import.meta.env.MODE} />
          <ReadOnlyField
            label="Node Environment"
            value={import.meta.env.DEV ? "development" : "production"}
          />
        </CardContent>
      </Card>

      {/* Go Backend */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Server size={16} className="text-muted-foreground" />
              <CardTitle className="text-base">Go Download Backend</CardTitle>
            </div>
            <StatusIndicator
              ok={goLoading ? undefined : goHealth !== undefined}
            />
          </div>
          <CardDescription>
            Core download service. Configure via{" "}
            <code className="text-xs bg-muted px-1 py-0.5 rounded">
              VITE_GO_API_URL
            </code>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ReadOnlyField label="Base URL" value={GO_API_URL} />

          {goHealth && (
            <>
              <Separator />
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground text-xs mb-1">Status</p>
                  <p className="font-medium">{goHealth.status}</p>
                </div>
                {goHealth.version && (
                  <div>
                    <p className="text-muted-foreground text-xs mb-1">
                      Version
                    </p>
                    <p className="font-medium font-mono">{goHealth.version}</p>
                  </div>
                )}
                {goHealth.activeDownloads != null && (
                  <div>
                    <p className="text-muted-foreground text-xs mb-1">
                      Active Downloads
                    </p>
                    <p className="font-medium">{goHealth.activeDownloads}</p>
                  </div>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Restful API */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Database size={16} className="text-muted-foreground" />
            <CardTitle className="text-base">Restful API Service</CardTitle>
          </div>
          <CardDescription>
            Koa-based batch task and yuqing API. Configure via{" "}
            <code className="text-xs bg-muted px-1 py-0.5 rounded">
              VITE_RESTFUL_API_URL
            </code>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ReadOnlyField label="Base URL" value={RESTFUL_API_URL} />
        </CardContent>
      </Card>

      {/* AI Service */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BrainCircuit size={16} className="text-muted-foreground" />
              <CardTitle className="text-base">AI Service</CardTitle>
            </div>
            <StatusIndicator
              ok={aiLoading ? undefined : aiHealth !== undefined}
            />
          </div>
          <CardDescription>
            FastAPI service for FUNASR subtitles and LM Studio summarization.
            Configure via{" "}
            <code className="text-xs bg-muted px-1 py-0.5 rounded">
              VITE_AI_API_URL
            </code>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ReadOnlyField label="Base URL" value={AI_API_URL} />

          {aiHealth && (
            <>
              <Separator />
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground text-xs mb-1">Status</p>
                  <p className="font-medium">{aiHealth.status}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs mb-1">
                    GPU Available
                  </p>
                  <p className="font-medium">
                    {aiHealth.gpu_available ? "Yes" : "No"}
                  </p>
                </div>
                {aiHealth.gpu_name && (
                  <div className="col-span-2">
                    <p className="text-muted-foreground text-xs mb-1">
                      GPU Model
                    </p>
                    <p className="font-medium font-mono text-xs">
                      {aiHealth.gpu_name}
                    </p>
                  </div>
                )}
                {aiHealth.gpu_memory_total != null && (
                  <div>
                    <p className="text-muted-foreground text-xs mb-1">
                      GPU Memory
                    </p>
                    <p className="font-medium">
                      {aiHealth.gpu_memory_used ?? 0} /{" "}
                      {aiHealth.gpu_memory_total} MB
                    </p>
                  </div>
                )}
                <div>
                  <p className="text-muted-foreground text-xs mb-1">
                    FUNASR Loaded
                  </p>
                  <p className="font-medium">
                    {aiHealth.funasr_loaded ? "Yes" : "No"}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs mb-1">
                    LM Studio Loaded
                  </p>
                  <p className="font-medium">
                    {aiHealth.model_loaded ? "Yes" : "No"}
                  </p>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Env variables hint */}
      <Card className="border-dashed">
        <CardHeader>
          <CardTitle className="text-sm text-muted-foreground">
            Configuring Service URLs
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-3">
            Create a{" "}
            <code className="bg-muted px-1 py-0.5 rounded text-xs">
              .env.local
            </code>{" "}
            file in{" "}
            <code className="bg-muted px-1 py-0.5 rounded text-xs">
              apps/admin-ui/
            </code>{" "}
            to override defaults:
          </p>
          <pre className="bg-muted rounded-md p-4 text-xs font-mono overflow-x-auto leading-relaxed">
            {`VITE_GO_API_URL=http://localhost:8080
VITE_RESTFUL_API_URL=http://localhost:8898
VITE_AI_API_URL=http://localhost:8899`}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}
