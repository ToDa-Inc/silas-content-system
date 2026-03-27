/** Shared reel + Silas analysis types (server + client). */

/** GET …/reels/metrics — snapshot time series for own reels. */
export type OwnReelsMetricPoint = {
  scraped_at: string;
  views?: number | null;
  likes?: number | null;
  comments?: number | null;
};

export type OwnReelsMetricsSeries = {
  reel_id: string;
  post_url?: string | null;
  thumbnail_url?: string | null;
  hook_text?: string | null;
  points: OwnReelsMetricPoint[];
};

export type OwnReelsMetricsResponse = {
  reels: OwnReelsMetricsSeries[];
};

export type ReelAnalysisSummary = {
  id: string;
  total_score: number | null;
  replicability_rating: string | null;
  analyzed_at: string | null;
  prompt_version?: string | null;
  weighted_total?: number | null;
  silas_rating?: string | null;
};

export type ReelAnalysisStructuredSummary = {
  content_summary?: string | null;
  format?: Record<string, string>;
  replicable_elements?: Record<string, string> | null;
  suggested_adaptation?: string | null;
};

export type ReelAnalysisDetail = {
  id: string;
  client_id: string;
  reel_id: string | null;
  analysis_job_id: string | null;
  source: string;
  post_url: string;
  owner_username: string | null;
  instant_hook_score: number | null;
  relatability_score: number | null;
  cognitive_tension_score: number | null;
  clear_value_score: number | null;
  comment_trigger_score: number | null;
  total_score: number | null;
  replicability_rating: string | null;
  hook_type?: string | null;
  emotional_trigger?: string | null;
  content_angle?: string | null;
  caption_structure?: string | null;
  why_it_worked?: string | null;
  replicable_elements?: Record<string, string> | null;
  suggested_adaptations?: unknown;
  full_analysis_json: {
    full_text?: string;
    scores?: Record<string, number | null>;
    video_analyzed?: boolean;
    structured_summary?: ReelAnalysisStructuredSummary | null;
    rating?: string | null;
    weighted_total?: number | null;
    weighted_scores?: Record<string, number | null>;
    raw_scores?: Record<string, number | null>;
  } | null;
  model_used: string | null;
  prompt_version: string | null;
  video_analyzed: boolean | null;
  analyzed_at: string | null;
  created_at: string | null;
};
