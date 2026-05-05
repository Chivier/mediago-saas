import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AlertCircle, Loader2 } from "lucide-react";

import { Mindmap } from "./Mindmap";
import { Markmap } from "./Markmap";

interface MarkdownPreviewProps {
  // URL to fetch the .md file from. We pull at component-mount and
  // render — keeps the parent dialog free of fetching concerns.
  url: string;
}

export function MarkdownPreview({ url }: MarkdownPreviewProps) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setText(null);
    setError(null);
    if (!url) return;
    const ctrl = new AbortController();
    fetch(url, { signal: ctrl.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then(setText)
      .catch((e) => {
        if (e.name !== "AbortError") setError(String(e));
      });
    return () => ctrl.abort();
  }, [url]);

  if (error) {
    return (
      <div className="flex items-center gap-2 text-sm text-destructive">
        <AlertCircle size={14} />
        {error}
      </div>
    );
  }
  if (text === null) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 size={14} className="animate-spin" />
        Loading…
      </div>
    );
  }

  // GitHub-flavoured markdown with custom code-fence handling: ```markmap```
  // blocks render via the markmap.js component; ```mermaid``` blocks keep
  // the legacy mermaid renderer for backward compat with notes.md files
  // produced before the markmap migration.
  return (
    <div className="prose prose-sm max-w-none dark:prose-invert">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code(props) {
            const { className, children } = props;
            const m = /language-(\w+)/.exec(className || "");
            const lang = m?.[1];
            const value = String(children).replace(/\n$/, "");
            const isBlock = (className || "").includes("language-");
            if (isBlock && lang === "markmap") {
              return <Markmap source={value} />;
            }
            if (isBlock && lang === "mermaid") {
              return <Mindmap source={value} />;
            }
            return <code className={className}>{children}</code>;
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
