import { useEffect, useRef, useState } from "react";
import { Transformer } from "markmap-lib";
import { Markmap as MarkmapView } from "markmap-view";
import { Toolbar } from "markmap-toolbar";
import "markmap-toolbar/dist/style.css";
import { AlertCircle } from "lucide-react";

// Reuse a single transformer instance — it has internal caches that
// markmap docs explicitly say should be shared across renders.
const transformer = new Transformer();

interface MarkmapProps {
  /** markmap-flavored markdown (nested headings + bullets). */
  source: string;
  /** Pixel height of the rendered SVG container. Default 500. */
  height?: number;
}

export function Markmap({ source, height = 500 }: MarkmapProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!svgRef.current || !source.trim()) return;
    setError(null);
    let mm: MarkmapView | null = null;
    try {
      // Clear any previous SVG content so re-renders don't stack.
      svgRef.current.innerHTML = "";
      const { root } = transformer.transform(source);
      mm = MarkmapView.create(svgRef.current, undefined, root);

      // Mount the markmap toolbar (zoom in/out, recenter, expand all).
      if (toolbarRef.current) {
        toolbarRef.current.innerHTML = "";
        const toolbar = new Toolbar();
        toolbar.attach(mm);
        toolbar.setItems(["zoomIn", "zoomOut", "fit"]);
        toolbarRef.current.appendChild(toolbar.render());
      }
    } catch (e) {
      setError(String((e as Error)?.message || e));
    }
    return () => {
      if (mm) {
        try {
          mm.destroy();
        } catch {
          // markmap.destroy() can throw on already-disposed instances
          // during fast re-renders — silent cleanup is fine.
        }
      }
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
        className="relative bg-muted/40 rounded overflow-hidden"
        style={{ height }}
      >
        <svg ref={svgRef} className="w-full h-full" />
        <div ref={toolbarRef} className="absolute bottom-2 right-2 z-10" />
      </div>
    </div>
  );
}
