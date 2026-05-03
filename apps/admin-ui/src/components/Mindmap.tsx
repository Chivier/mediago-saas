import { useEffect, useRef, useState } from "react";
import mermaid from "mermaid";
import { AlertCircle, Loader2 } from "lucide-react";

mermaid.initialize({
  startOnLoad: false,
  theme: "default",
  securityLevel: "loose",
  // mindmap is one of the diagram types we expect from the LLM
  flowchart: { useMaxWidth: true },
});

let counter = 0;

interface MindmapProps {
  source: string;
}

export function Mindmap({ source }: MindmapProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    if (!ref.current || !source.trim()) {
      setLoading(false);
      return;
    }
    const id = `mermaid-${++counter}`;
    mermaid
      .render(id, source)
      .then(({ svg }) => {
        if (cancelled || !ref.current) return;
        ref.current.innerHTML = svg;
      })
      .catch((e) => {
        if (cancelled) return;
        setError(String(e?.message || e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [source]);

  if (!source.trim()) {
    return (
      <p className="text-sm text-muted-foreground italic">
        No mindmap was generated.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {loading && (
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 size={14} className="animate-spin" />
          Rendering mindmap…
        </div>
      )}
      {error && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-destructive text-sm">
            <AlertCircle size={14} />
            Failed to render mindmap: {error}
          </div>
          <pre className="bg-muted text-xs p-3 rounded overflow-auto max-h-60">
            {source}
          </pre>
        </div>
      )}
      <div
        ref={ref}
        className="overflow-auto bg-muted/40 rounded p-3"
        style={{ minHeight: 200 }}
      />
    </div>
  );
}
