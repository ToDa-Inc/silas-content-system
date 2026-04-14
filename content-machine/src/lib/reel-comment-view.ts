type ReelRatioRow = {
  views?: number | null;
  comments?: number | null;
  /**
   * Backend stores this as views ÷ comments (e.g. 20 = 20 views per comment).
   * Only used as fallback when raw counts are unavailable.
   */
  comment_view_ratio?: number | null;
};

/**
 * Comments ÷ views — conversation rate (0–1).
 * Always prefers computing from raw counts when both are present.
 * Falls back to inverting the baked V/C ratio when raw counts are missing.
 */
export function commentViewRatio(row: ReelRatioRow): number | null {
  const v = row.views;
  const c = row.comments;
  if (v != null && c != null && Number(v) > 0) {
    return Number(c) / Number(v);
  }
  // Baked value is V/C — invert it to get C/V
  const baked = row.comment_view_ratio;
  if (baked != null && typeof baked === "number" && !Number.isNaN(baked) && baked > 0) {
    return 1 / baked;
  }
  return null;
}

/** "0.42%" display for C/V ratio. */
export function formatCommentViewPct(row: ReelRatioRow): string {
  const r = commentViewRatio(row);
  if (r == null || Number.isNaN(r)) return "—";
  return `${(r * 100).toFixed(2)}%`;
}

/** Alias kept for callers that haven't been migrated yet. */
export const viewsToCommentsRatio = commentViewRatio;

/** Formats as percentage string. */
export function formatViewsToComments(row: ReelRatioRow): string {
  return formatCommentViewPct(row);
}

/** Used in generate/page.tsx for format digest avg display (value already 0–1). */
export function formatViewsToCommentsValue(r: number): string {
  if (!Number.isFinite(r) || r <= 0) return "—";
  return `${(r * 100).toFixed(2)}%`;
}
