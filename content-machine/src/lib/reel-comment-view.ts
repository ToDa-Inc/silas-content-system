/** Views ÷ comments — vistas por cada comentario (p. ej. 20 → "20:1"). */

export function viewsToCommentsRatio(row: {
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
  if (v == null || c == null || c <= 0) return null;
  return v / c;
}

export function formatViewsToCommentsValue(r: number): string {
  if (!Number.isFinite(r) || r <= 0) return "—";
  return `${Math.round(r)}:1`;
}

export function formatViewsToComments(row: Parameters<typeof viewsToCommentsRatio>[0]): string {
  const r = viewsToCommentsRatio(row);
  if (r == null || Number.isNaN(r)) return "—";
  return formatViewsToCommentsValue(r);
}
