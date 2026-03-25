/** Shared reel + Silas analysis types (server + client). */

export type ReelAnalysisSummary = {
  id: string;
  total_score: number | null;
  replicability_rating: string | null;
  analyzed_at: string | null;
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
  full_analysis_json: {
    full_text?: string;
    scores?: Record<string, number | null>;
    video_analyzed?: boolean;
  } | null;
  model_used: string | null;
  prompt_version: string | null;
  video_analyzed: boolean | null;
  analyzed_at: string | null;
  created_at: string | null;
};
