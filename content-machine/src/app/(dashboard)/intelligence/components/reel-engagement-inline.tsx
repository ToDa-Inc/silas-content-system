import { Eye, MessageCircle } from "lucide-react";
import { formatViewsToComments } from "@/lib/reel-comment-view";

type Props = {
  views: number | null | undefined;
  comments: number | null | undefined;
  comment_view_ratio?: number | null;
  className?: string;
};

function fmt(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString();
}

/** Compact views / comments / views÷comments (e.g. 20:1) for reel cards. */
export function ReelEngagementInline({ views, comments, comment_view_ratio, className }: Props) {
  const cvRow = { views, comments, comment_view_ratio };
  return (
    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] tabular-nums text-zinc-600 dark:text-app-fg-muted ${className ?? ""}`}
    >
      <span className="inline-flex items-center gap-0.5" title="Views">
        <Eye className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
        {fmt(views)}
      </span>
      <span className="inline-flex items-center gap-0.5" title="Comments">
        <MessageCircle className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
        {fmt(comments)}
      </span>
      <span
        className="font-medium text-zinc-800 dark:text-app-fg-secondary"
        title="Comments ÷ views — conversation rate (higher % = more discussion per view)"
      >
        {formatViewsToComments(cvRow)}
      </span>
    </div>
  );
}
