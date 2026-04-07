/** Comments ÷ views (0–1), primary “conversation rate” signal for reels. */

export function commentViewRatio(row: {
  views?: number | null;
  comments?: number | null;
  comment_view_ratio?: number | null;
}): number | null {
  const baked = row.comment_view_ratio;
  if (baked != null && typeof baked === "number" && !Number.isNaN(baked)) {
    return baked;
  }
  const v = row.views;
  const c = row.comments;
  if (v == null || c == null || v <= 0) return null;
  return c / v;
}

export function formatCommentViewPct(row: Parameters<typeof commentViewRatio>[0]): string {
  const r = commentViewRatio(row);
  if (r == null || Number.isNaN(r)) return "—";
  return `${(r * 100).toFixed(2)}%`;
}
