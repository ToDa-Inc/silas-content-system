import { replicabilityLabel } from "@/lib/replicability-label";

/** True when we should show Silas v2 weighted /100 (persisted + v2 prompt). */
export function isSilasV2WeightedDisplay(a: {
  weighted_total?: number | null;
  prompt_version?: string | null;
}): boolean {
  return (
    a.weighted_total != null &&
    typeof a.prompt_version === "string" &&
    a.prompt_version.startsWith("silas_v2")
  );
}

export function formatSilasScoreSummary(a: {
  total_score?: number | null;
  replicability_rating?: string | null;
  weighted_total?: number | null;
  silas_rating?: string | null;
  /** Job completion payload uses `rating` (human-readable). */
  rating?: string | null;
  prompt_version?: string | null;
}): { scoreText: string; maxSuffix: string; ratingText: string | null } {
  if (isSilasV2WeightedDisplay(a)) {
    const n = Number(a.weighted_total);
    const rounded = Number.isFinite(n) ? Math.round(n) : null;
    const ratingText =
      (a.silas_rating && a.silas_rating.trim()) ||
      (a.rating && a.rating.trim()) ||
      (a.replicability_rating ? replicabilityLabel(a.replicability_rating) : null);
    return {
      scoreText: rounded != null ? String(rounded) : "—",
      maxSuffix: "/100",
      ratingText,
    };
  }
  const ratingText = a.replicability_rating ? replicabilityLabel(a.replicability_rating) : null;
  return {
    scoreText: a.total_score != null ? String(a.total_score) : "—",
    maxSuffix: "/50",
    ratingText,
  };
}

/** Sort key for Silas score column (v2 uses weighted /100, else legacy /50). */
export function analysisSortScore(a: {
  analysis?: {
    total_score?: number | null;
    weighted_total?: number | null;
    prompt_version?: string | null;
  } | null;
}): number {
  const x = a.analysis;
  if (!x) return NaN;
  if (isSilasV2WeightedDisplay(x) && x.weighted_total != null) {
    return Number(x.weighted_total);
  }
  if (x.total_score != null) return x.total_score;
  return NaN;
}
