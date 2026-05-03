import { Badge } from "./ui/badge";

type StatusVariant =
  | "queued"
  | "processing"
  | "downloading"
  | "done"
  | "success"
  | "failed"
  | "partial"
  | "paused"
  | string;

interface StatusBadgeProps {
  status: StatusVariant;
  className?: string;
}

const STATUS_MAP: Record<
  string,
  {
    label: string;
    variant:
      | "gray"
      | "info"
      | "success"
      | "destructive"
      | "warning"
      | "secondary";
  }
> = {
  queued: { label: "Queued", variant: "gray" },
  processing: { label: "Processing", variant: "info" },
  downloading: { label: "Downloading", variant: "info" },
  done: { label: "Done", variant: "success" },
  success: { label: "Success", variant: "success" },
  failed: { label: "Failed", variant: "destructive" },
  partial: { label: "Partial", variant: "warning" },
  paused: { label: "Paused", variant: "secondary" },
};

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = STATUS_MAP[status] ?? {
    label: status,
    variant: "secondary" as const,
  };
  return (
    <Badge
      variant={config.variant as Parameters<typeof Badge>[0]["variant"]}
      className={className}
    >
      {config.label}
    </Badge>
  );
}
