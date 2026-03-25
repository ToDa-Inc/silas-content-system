import { Eye, Heart, MessageCircle } from "lucide-react";

type Props = {
  views: number | null | undefined;
  likes: number | null | undefined;
  comments: number | null | undefined;
  className?: string;
};

function fmt(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString();
}

/** Compact views / likes / comments for reel cards (icons only, no labels). */
export function ReelEngagementInline({ views, likes, comments, className }: Props) {
  return (
    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] tabular-nums text-zinc-600 dark:text-app-fg-muted ${className ?? ""}`}
    >
      <span className="inline-flex items-center gap-0.5" title="Views">
        <Eye className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
        {fmt(views)}
      </span>
      <span className="inline-flex items-center gap-0.5" title="Likes">
        <Heart className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
        {fmt(likes)}
      </span>
      <span className="inline-flex items-center gap-0.5" title="Comments">
        <MessageCircle className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
        {fmt(comments)}
      </span>
    </div>
  );
}
