"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Trash2,
} from "lucide-react";
import { ReelThumbnail } from "@/components/reel-thumbnail";
import { useToast } from "@/components/ui/toast-provider";
import type { ScrapedReelRow } from "@/lib/api";
import { formatCommentViewPct } from "@/lib/reel-comment-view";
import {
  clientApiContext,
  fetchAdaptPreviewReels,
  fetchFormatDigests,
  generationChooseAngle,
  generationDeleteSession,
  generationGenerateThumbnail,
  generationGetSession,
  generationListSessions,
  generationRegenerate,
  generationSetStatus,
  generationStart,
  recommendFormatForIdea,
  type FormatDigestSummary,
  type FormatRecommendation,
  type GenerationSession,
} from "@/lib/api-client";

type Step = "source" | "angles" | "content";

type SourceMode = "format_pick" | "idea_match" | "url_adapt" | "script_adapt";

function str(v: unknown): string {
  return typeof v === "string" ? v : v != null ? String(v) : "";
}

function formatSessionDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

function sessionAngleSummary(s: GenerationSession): string {
  const idx = s.chosen_angle_index;
  const ang = Array.isArray(s.angles) ? s.angles : [];
  if (typeof idx === "number" && idx >= 0 && idx < ang.length) {
    const raw = ang[idx];
    if (raw && typeof raw === "object" && "title" in raw) {
      const t = (raw as { title?: unknown }).title;
      if (typeof t === "string" && t.trim()) return t.trim();
    }
  }
  return "Angles pending";
}

function getChosenAngleRecord(session: GenerationSession): Record<string, unknown> | null {
  const angles = Array.isArray(session.angles) ? session.angles : [];
  const rawIdx = session.chosen_angle_index;
  let idx: number;
  if (rawIdx == null) {
    idx = Number.NaN;
  } else if (typeof rawIdx === "number" && Number.isInteger(rawIdx)) {
    idx = rawIdx;
  } else {
    const parsed = Number.parseInt(String(rawIdx).trim(), 10);
    idx = Number.isNaN(parsed) ? Number.NaN : parsed;
  }
  if (!Number.isInteger(idx) || idx < 0 || idx >= angles.length) {
    if (angles.length === 1 && angles[0] && typeof angles[0] === "object") {
      return angles[0] as Record<string, unknown>;
    }
    return null;
  }
  const a = angles[idx];
  return a && typeof a === "object" ? (a as Record<string, unknown>) : null;
}

function sourceTypeLabel(t: string): string {
  if (t === "format_pick") return "Format";
  if (t === "idea_match") return "Idea";
  if (t === "url_adapt") return "Adapt URL";
  if (t === "script_adapt") return "Adapt script";
  if (t === "patterns") return "Patterns";
  if (t === "outlier") return "Selected";
  if (t === "manual") return "Manual";
  return t;
}

/** Sessions where angle 0 is the faithful blueprint (backend sets angle_role). */
function sessionUsesBlueprintFirstAngle(s: GenerationSession): boolean {
  if (s.source_type === "url_adapt" || s.source_type === "script_adapt") return true;
  if (
    s.source_type === "outlier" &&
    Array.isArray(s.source_analysis_ids) &&
    s.source_analysis_ids.filter((x) => String(x).trim()).length === 1
  ) {
    return true;
  }
  return false;
}

function angleIsBlueprint(raw: unknown, index: number, session: GenerationSession): boolean {
  if (raw && typeof raw === "object" && "angle_role" in raw) {
    const r = String((raw as { angle_role?: unknown }).angle_role || "").toLowerCase();
    if (r === "blueprint") return true;
    if (r === "variant") return false;
  }
  return sessionUsesBlueprintFirstAngle(session) && index === 0;
}

function formatKeyLabel(key: string): string {
  if (!key.trim()) return "—";
  return key.replace(/_/g, " ");
}

const VISUAL_FOR_CREATE = new Set(["text_overlay", "b_roll_reel", "carousel"]);

/** Match backend canonicalize_stored_format_key (legacy b_roll → b_roll_reel). */
function canonicalFormatKey(key: string | null | undefined): string {
  const k = (key || "").trim();
  if (k === "b_roll") return "b_roll_reel";
  return k;
}

function sessionEligibleForCreate(s: GenerationSession): boolean {
  if (s.status !== "content_ready" && s.status !== "approved") return false;
  const fk = canonicalFormatKey(s.source_format_key);
  if (VISUAL_FOR_CREATE.has(fk)) return true;
  // Matches backend: approved URL-adapt rows may omit source_format_key but use text-overlay Create pipeline
  if (s.source_type === "url_adapt" && !fk) return true;
  return false;
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case "approved":
      return "bg-emerald-500/20 text-emerald-400";
    case "rejected":
      return "bg-red-500/20 text-red-400";
    case "content_ready":
      return "bg-sky-500/15 text-sky-400";
    case "angles_ready":
    default:
      return "bg-amber-500/15 text-amber-400";
  }
}

function parseScriptSections(text: string): { heading: string; body: string }[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (!trimmed.startsWith("##")) {
    return [{ heading: "Script", body: trimmed }];
  }
  const parts = trimmed.split(/\n(?=##\s)/);
  return parts
    .map((part) => {
      const m = part.match(/^##\s+([^\n]+)\n?([\s\S]*)$/);
      if (m) return { heading: m[1].trim(), body: m[2].trim() };
      return { heading: "", body: part.trim() };
    })
    .filter((s) => s.heading || s.body);
}

type NamedDesc = { name?: unknown; description?: unknown; example_from_data?: unknown };

function SynthesizedPatternsView({ patterns }: { patterns: Record<string, unknown> }) {
  const hookPatterns = patterns.hook_patterns;
  const tension = patterns.tension_mechanisms;
  const valueFormats = patterns.value_delivery_formats;
  const avoid = patterns.patterns_to_avoid;
  const summary = patterns.one_paragraph_synthesis;
  const perfSummary = patterns.performance_summary;
  const fiRaw = patterns.format_insights;
  const formatInsights =
    fiRaw && typeof fiRaw === "object" && !Array.isArray(fiRaw) ? (fiRaw as Record<string, unknown>) : null;

  return (
    <div className="max-h-[28rem] space-y-4 overflow-y-auto pr-1">
      <p className="text-[11px] leading-relaxed text-app-fg-muted">
        Snapshot from when this run started: your team&apos;s{" "}
        <span className="text-app-fg-secondary">format digest</span> (competitor reels → stats + one AI pass).
        If the AI step failed (network, quota), sections below may be empty even though the digest row still
        exists — use <strong className="font-semibold text-app-fg-muted">Refresh format digests</strong> on
        Source to retry.
      </p>

      {formatInsights &&
      [
        formatInsights.dominant_type,
        formatInsights.optimal_duration,
        formatInsights.engagement_drivers,
      ].some((x) => typeof x === "string" && x.trim()) ? (
        <div className="rounded-xl border border-app-divider bg-app-chip-bg/40 p-4">
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-app-fg-subtle">
            Format snapshot
          </h3>
          <dl className="space-y-2 text-xs text-app-fg-muted">
            {typeof formatInsights.dominant_type === "string" && formatInsights.dominant_type.trim() ? (
              <div>
                <dt className="font-semibold text-app-fg-subtle">What this format looks like</dt>
                <dd className="mt-0.5 leading-relaxed">{formatInsights.dominant_type}</dd>
              </div>
            ) : null}
            {typeof formatInsights.optimal_duration === "string" && formatInsights.optimal_duration.trim() ? (
              <div>
                <dt className="font-semibold text-app-fg-subtle">Typical length (from data)</dt>
                <dd className="mt-0.5 leading-relaxed">{formatInsights.optimal_duration}</dd>
              </div>
            ) : null}
            {typeof formatInsights.engagement_drivers === "string" &&
            formatInsights.engagement_drivers.trim() ? (
              <div>
                <dt className="font-semibold text-app-fg-subtle">What tends to drive discussion</dt>
                <dd className="mt-0.5 leading-relaxed">{formatInsights.engagement_drivers}</dd>
              </div>
            ) : null}
          </dl>
        </div>
      ) : null}

      {perfSummary != null && String(perfSummary).trim() ? (
        <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-4">
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-app-fg-subtle">
            Performance summary
          </h3>
          <p className="text-sm leading-relaxed text-app-fg">{str(perfSummary)}</p>
        </div>
      ) : null}
      {Array.isArray(hookPatterns) && hookPatterns.length > 0 ? (
        <div className="rounded-xl border border-app-divider bg-app-chip-bg/40 p-4">
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-app-fg-subtle">
            Hook patterns
          </h3>
          <ul className="space-y-3">
            {hookPatterns.map((item, i) => {
              const o = item && typeof item === "object" ? (item as NamedDesc) : {};
              return (
                <li key={i} className="text-sm">
                  <p className="font-semibold text-app-fg">{str(o.name) || "—"}</p>
                  <p className="mt-1 text-xs leading-relaxed text-app-fg-muted">{str(o.description)}</p>
                  {o.example_from_data != null && String(o.example_from_data).trim() ? (
                    <p className="mt-1 text-[11px] italic text-app-fg-subtle">
                      &ldquo;{str(o.example_from_data)}&rdquo;
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {Array.isArray(tension) && tension.length > 0 ? (
        <div className="rounded-xl border border-app-divider bg-app-chip-bg/40 p-4">
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-app-fg-subtle">
            Tension mechanisms
          </h3>
          <ul className="space-y-2">
            {tension.map((item, i) => {
              const o = item && typeof item === "object" ? (item as NamedDesc) : {};
              return (
                <li key={i} className="text-sm">
                  <span className="font-semibold text-app-fg">{str(o.name) || "—"}</span>
                  <span className="mt-0.5 block text-xs text-app-fg-muted">{str(o.description)}</span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {Array.isArray(valueFormats) && valueFormats.length > 0 ? (
        <div className="rounded-xl border border-app-divider bg-app-chip-bg/40 p-4">
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-app-fg-subtle">
            Value delivery formats
          </h3>
          <ul className="space-y-2">
            {valueFormats.map((item, i) => {
              const o = item && typeof item === "object" ? (item as NamedDesc) : {};
              return (
                <li key={i} className="text-sm">
                  <span className="font-semibold text-app-fg">{str(o.name) || "—"}</span>
                  <span className="mt-0.5 block text-xs text-app-fg-muted">{str(o.description)}</span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {Array.isArray(avoid) && avoid.length > 0 ? (
        <div className="rounded-xl border border-app-divider bg-app-chip-bg/40 p-4">
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-app-fg-subtle">
            Patterns to avoid
          </h3>
          <ul className="list-inside list-disc space-y-1 text-sm text-app-fg-muted">
            {avoid.map((x, i) => (
              <li key={i}>{str(x)}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {Array.isArray(patterns.top_performer_features) && patterns.top_performer_features.length > 0 ? (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-app-fg-subtle">
            Top performer signals
          </h3>
          <ul className="list-inside list-disc space-y-1 text-sm text-app-fg-muted">
            {(patterns.top_performer_features as unknown[]).map((x, i) => (
              <li key={i}>{str(x)}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {Array.isArray(patterns.weak_performer_issues) && patterns.weak_performer_issues.length > 0 ? (
        <div className="rounded-xl border border-app-divider bg-app-chip-bg/40 p-4">
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-app-fg-subtle">
            Underperformer patterns
          </h3>
          <ul className="list-inside list-disc space-y-1 text-sm text-app-fg-muted">
            {(patterns.weak_performer_issues as unknown[]).map((x, i) => (
              <li key={i}>{str(x)}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {summary != null && String(summary).trim() ? (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-app-fg-subtle">
            Summary
          </h3>
          <p className="text-sm leading-relaxed text-app-fg">{str(summary)}</p>
        </div>
      ) : null}
    </div>
  );
}

/** Compact context for url_adapt sessions — source link + why-it-worked + format line from synthesized_patterns. */
function UrlAdaptReferenceCard({
  sourceUrl,
  patterns,
}: {
  sourceUrl: string | null | undefined;
  patterns: Record<string, unknown> | null | undefined;
}) {
  const u = (sourceUrl ?? "").trim();
  const summaryRaw = patterns?.performance_summary;
  const summary =
    summaryRaw != null && String(summaryRaw).trim() ? String(summaryRaw).trim() : "";
  const fi = patterns?.format_insights;
  const fiObj =
    fi && typeof fi === "object" && !Array.isArray(fi) ? (fi as Record<string, unknown>) : null;
  const bits: string[] = [];
  const dt = fiObj?.dominant_type;
  const od = fiObj?.optimal_duration;
  if (typeof dt === "string" && dt.trim()) bits.push(dt.trim());
  if (typeof od === "string" && od.trim()) bits.push(od.trim());
  const formatLine = bits.join(" · ");

  if (!u && !summary && !formatLine) return null;

  return (
    <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.07] p-4">
      <p className="text-[10px] font-bold uppercase tracking-wider text-app-fg-subtle">
        Reference reel (URL adapt)
      </p>
      {u ? (
        <p className="mt-2 text-xs">
          <a
            href={u}
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-amber-600 underline-offset-2 hover:underline dark:text-amber-400"
          >
            Open original on Instagram ↗
          </a>
        </p>
      ) : null}
      {summary ? (
        <p className="mt-2 text-xs leading-relaxed text-app-fg-secondary">
          <span className="font-semibold text-app-fg-muted">Why it worked: </span>
          {summary}
        </p>
      ) : null}
      {formatLine ? (
        <p className="mt-2 text-[11px] text-app-fg-muted">
          <span className="font-semibold text-app-fg-subtle">Format: </span>
          {formatLine}
        </p>
      ) : null}
    </div>
  );
}

/** Source English script for script_adapt — excerpt + synthesis summary from patterns. */
function ScriptAdaptReferenceCard({
  sourceScript,
  patterns,
}: {
  sourceScript: string | null | undefined;
  patterns: Record<string, unknown> | null | undefined;
}) {
  const raw = (sourceScript ?? "").trim();
  const summaryRaw = patterns?.performance_summary;
  const summary =
    summaryRaw != null && String(summaryRaw).trim() ? String(summaryRaw).trim() : "";
  const syn = patterns?.one_paragraph_synthesis;
  const synStr = syn != null && String(syn).trim() ? String(syn).trim() : "";

  if (!raw && !summary && !synStr) return null;

  return (
    <div className="rounded-xl border border-sky-500/25 bg-sky-500/[0.07] p-4">
      <p className="text-[10px] font-bold uppercase tracking-wider text-app-fg-subtle">
        Source script (English)
      </p>
      {raw ? (
        <pre className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-app-divider bg-app-chip-bg/40 p-3 font-mono text-[11px] leading-relaxed text-app-fg-muted">
          {raw}
        </pre>
      ) : null}
      {synStr ? (
        <p className="mt-2 text-xs leading-relaxed text-app-fg-secondary">
          <span className="font-semibold text-app-fg-muted">Structure note: </span>
          {synStr}
        </p>
      ) : null}
      {summary ? (
        <p className="mt-2 text-xs leading-relaxed text-app-fg-secondary">
          <span className="font-semibold text-app-fg-muted">Performance read: </span>
          {summary}
        </p>
      ) : null}
    </div>
  );
}

const TIER_GROUPS: { tier: 1 | 2 | 3; title: string; subtitle: string }[] = [
  { tier: 1, title: "Tier 1 — Direct relatable question", subtitle: "Opens with a question the viewer feels." },
  { tier: 2, title: "Tier 2 — Tension / insight", subtitle: "Contrast, stakes, or a sharp insight." },
  { tier: 3, title: "Tier 3 — Concrete script / list", subtitle: "Specific lines, lists, or say-this-out-loud hooks." },
];

export default function GeneratePage() {
  const { show } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionIdFromUrl = searchParams.get("session");
  const modeFromUrl = searchParams.get("mode") as SourceMode | null;
  const urlFromUrl = searchParams.get("url");
  const [step, setStep] = useState<Step>("source");
  const [sourceMode, setSourceMode] = useState<SourceMode>(
    modeFromUrl === "url_adapt" || modeFromUrl === "idea_match" || modeFromUrl === "script_adapt"
      ? modeFromUrl
      : "format_pick",
  );
  const [extraInstruction, setExtraInstruction] = useState("");
  const [formatDigests, setFormatDigests] = useState<FormatDigestSummary[]>([]);
  const [selectedFormatKey, setSelectedFormatKey] = useState<string | null>(null);
  const [ideaText, setIdeaText] = useState("");
  const [formatRecommendations, setFormatRecommendations] = useState<FormatRecommendation[]>([]);
  const [adaptUrl, setAdaptUrl] = useState(urlFromUrl?.trim() ?? "");
  const [scriptAdaptText, setScriptAdaptText] = useState("");
  const [adaptPreviewRows, setAdaptPreviewRows] = useState<ScrapedReelRow[]>([]);
  const [adaptPreviewLoading, setAdaptPreviewLoading] = useState(false);
  const [adaptPreviewError, setAdaptPreviewError] = useState<string | null>(null);
  const [session, setSession] = useState<GenerationSession | null>(null);
  const [sessions, setSessions] = useState<GenerationSession[]>([]);
  const [loading, setLoading] = useState(false);
  /** Index of angle being submitted (content generation); other angle cards stay visible but dimmed. */
  const [choosingAngleIndex, setChoosingAngleIndex] = useState<number | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [patternsOpen, setPatternsOpen] = useState(false);
  const [clientSlug, setClientSlug] = useState("");
  const [orgSlug, setOrgSlug] = useState("");
  const [regenScope, setRegenScope] = useState<"all" | "hooks" | "script" | "caption" | "story">("all");
  const [regenFeedback, setRegenFeedback] = useState("");
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [thumbnailLoading, setThumbnailLoading] = useState(false);  const [coverText, setCoverText] = useState<string>("");

  const refreshSessions = useCallback(async () => {
    if (!clientSlug || !orgSlug) return;
    const lr = await generationListSessions(clientSlug, orgSlug, 15);
    if (lr.ok) setSessions(lr.data);
  }, [clientSlug, orgSlug]);

  const refreshContext = useCallback(async () => {
    const ctx = await clientApiContext();
    setClientSlug(ctx.clientSlug);
    setOrgSlug(ctx.orgSlug);
    return ctx;
  }, []);

  const loadFormatDigests = useCallback(
    async (refresh: boolean) => {
      if (!clientSlug || !orgSlug) return;
      setLoadingList(true);
      try {
        const res = await fetchFormatDigests(clientSlug, orgSlug, refresh);
        if (res.ok) {
          setFormatDigests(res.data);
          if (refresh) show("Styles list updated.", "success");
        } else {
          show(res.error, "error");
          if (!refresh) setFormatDigests([]);
        }
      } finally {
        setLoadingList(false);
      }
    },
    [clientSlug, orgSlug, show],
  );

  useEffect(() => {
    void (async () => {
      const ctx = await refreshContext();
      if (!ctx.clientSlug || !ctx.orgSlug) return;
      setLoadingList(true);
      try {
        const [listRes, digRes] = await Promise.all([
          generationListSessions(ctx.clientSlug, ctx.orgSlug, 15),
          fetchFormatDigests(ctx.clientSlug, ctx.orgSlug, false),
        ]);
        if (listRes.ok) setSessions(listRes.data);
        if (digRes.ok) {
          setFormatDigests(digRes.data);
        } else {
          show(digRes.error, "error");
        }
      } finally {
        setLoadingList(false);
      }
    })();
  }, [refreshContext]);

  /** Top competitor reels by comments÷views — URL adapt quick picks. */
  useEffect(() => {
    if (!clientSlug || !orgSlug || sourceMode !== "url_adapt") return;
    let cancelled = false;
    setAdaptPreviewLoading(true);
    setAdaptPreviewError(null);
    void fetchAdaptPreviewReels(clientSlug, orgSlug).then((res) => {
      if (cancelled) return;
      setAdaptPreviewLoading(false);
      if (res.ok) setAdaptPreviewRows(res.data);
      else {
        setAdaptPreviewRows([]);
        setAdaptPreviewError(res.error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [clientSlug, orgSlug, sourceMode]);

  /** Open session from Intelligence “Recreate” flow (`/generate?session=…`). */
  useEffect(() => {
    const raw = sessionIdFromUrl?.trim();
    if (!raw || !clientSlug.trim() || !orgSlug.trim()) return;
    let cancelled = false;
    void (async () => {
      const res = await generationGetSession(clientSlug, orgSlug, raw);
      if (cancelled) return;
      router.replace("/generate", { scroll: false });
      if (!res.ok) {
        show(res.error, "error");
        return;
      }
      setSession(res.data);
      const st = res.data.status;
      setStep(st === "content_ready" || st === "approved" ? "content" : "angles");
      await refreshSessions();
      show("Session loaded — pick an angle or continue to script.", "success");
    })();
    return () => {
      cancelled = true;
    };
  }, [clientSlug, orgSlug, sessionIdFromUrl, router, show, refreshSessions]);

  const onDeleteSession = useCallback(
    async (id: string) => {
      if (!clientSlug || !orgSlug) return;
      if (!window.confirm("Delete this generation session? This cannot be undone.")) return;
      setLoading(true);
      try {
        const res = await generationDeleteSession(clientSlug, orgSlug, id);
        if (!res.ok) {
          show(res.error, "error");
          return;
        }
        show("Session deleted.", "success");
        if (session?.id === id) {
          setSession(null);
          setStep("source");
        }
        await refreshSessions();
      } finally {
        setLoading(false);
      }
    },
    [clientSlug, orgSlug, refreshSessions, session?.id, show],
  );

  const onSuggestFormats = useCallback(async () => {
    const ctx = await refreshContext();
    if (!ctx.clientSlug || !ctx.orgSlug) {
      show("No workspace client — finish onboarding.", "error");
      return;
    }
    const idea = ideaText.trim();
    if (idea.length < 3) {
      show("Describe your idea in a few words (at least 3 characters).", "error");
      return;
    }
    setLoadingList(true);
    try {
      const res = await recommendFormatForIdea(ctx.clientSlug, ctx.orgSlug, idea);
      if (!res.ok) {
        show(res.error, "error");
        setFormatRecommendations([]);
        return;
      }
      setFormatRecommendations(res.data);
      if (res.data.length === 0) show("No recommendations returned — try refreshing digests.", "error");
    } finally {
      setLoadingList(false);
    }
  }, [ideaText, refreshContext, show]);

  const onStart = useCallback(async () => {
    const ctx = await refreshContext();
    if (!ctx.clientSlug || !ctx.orgSlug) {
      show("No workspace client — finish onboarding.", "error");
      return;
    }
    if (sourceMode === "format_pick") {
      if (!selectedFormatKey) {
        show("Select a format.", "error");
        return;
      }
    }
    if (sourceMode === "idea_match") {
      if (!ideaText.trim()) {
        show("Enter what you want to communicate in the video.", "error");
        return;
      }
      if (!selectedFormatKey) {
        show("Pick a suggested format or select one from the list.", "error");
        return;
      }
    }
    if (sourceMode === "url_adapt") {
      const u = adaptUrl.trim();
      if (!u || !u.includes("instagram.com")) {
        show("Paste a valid Instagram reel URL.", "error");
        return;
      }
    }
    if (sourceMode === "script_adapt") {
      if (scriptAdaptText.trim().length < 40) {
        show("Paste the English script — at least a few sentences (40+ characters).", "error");
        return;
      }
    }
    setLoading(true);
    try {
      let body: Parameters<typeof generationStart>[2];
      if (sourceMode === "format_pick") {
        body = {
          source_type: "format_pick",
          format_key: selectedFormatKey!,
          extra_instruction: extraInstruction.trim() || undefined,
        };
      } else if (sourceMode === "idea_match") {
        body = {
          source_type: "idea_match",
          format_key: selectedFormatKey!,
          idea_text: ideaText.trim(),
          extra_instruction: extraInstruction.trim() || undefined,
        };
      } else if (sourceMode === "script_adapt") {
        body = {
          source_type: "script_adapt",
          source_script: scriptAdaptText.trim(),
          extra_instruction: extraInstruction.trim() || undefined,
        };
      } else {
        body = {
          source_type: "url_adapt",
          url: adaptUrl.trim(),
          extra_instruction: extraInstruction.trim() || undefined,
        };
      }
      const res = await generationStart(ctx.clientSlug, ctx.orgSlug, body);
      if (!res.ok) {
        show(res.error, "error");
        return;
      }
      setSession(res.data);
      setThumbnailUrl(null);
      setCoverText("");
      setStep("angles");
      show("Angles ready — pick one.", "success");
      const lr = await generationListSessions(ctx.clientSlug, ctx.orgSlug, 15);
      if (lr.ok) setSessions(lr.data);
    } finally {
      setLoading(false);
    }
  }, [
    adaptUrl,
    scriptAdaptText,
    extraInstruction,
    ideaText,
    refreshContext,
    selectedFormatKey,
    show,
    sourceMode,
  ]);

  const onChooseAngle = useCallback(
    async (index: number) => {
      if (!session || !clientSlug || !orgSlug) return;
      setChoosingAngleIndex(index);
      try {
        const res = await generationChooseAngle(clientSlug, orgSlug, session.id, index);
        if (!res.ok) {
          show(res.error, "error");
          return;
        }
        setSession(res.data);
        setStep("content");
        show("Script and captions generated.", "success");
      } finally {
        setChoosingAngleIndex(null);
      }
    },
    [clientSlug, orgSlug, session, show],
  );

  const onRegenerate = useCallback(async () => {
    if (!session?.id?.trim() || !clientSlug.trim() || !orgSlug.trim()) {
      show("Workspace or session is missing. Reload the page and try again.", "error");
      return;
    }
    setLoading(true);
    try {
      const res = await generationRegenerate(clientSlug, orgSlug, session.id, {
        scope: regenScope,
        feedback: regenFeedback.trim() || undefined,
      });
      if (!res.ok) {
        show(res.error, "error");
        return;
      }
      setSession(res.data);
      setRegenFeedback("");
      show("Regenerated.", "success");
    } finally {
      setLoading(false);
    }
  }, [clientSlug, orgSlug, regenFeedback, regenScope, session, show]);

  const onApprove = useCallback(async () => {
    if (!session || !clientSlug || !orgSlug) return;
    setLoading(true);
    try {
      const res = await generationSetStatus(clientSlug, orgSlug, session.id, "approve");
      if (!res.ok) {
        show(res.error, "error");
        return;
      }
      const next = res.data;
      setSession(next);
      if (sessionEligibleForCreate(next)) {
        show(
          "Approved. Open Create — this session appears in the left list for backgrounds and video render.",
          "success",
        );
      } else {
        show(
          "Approved. Create only lists text overlay, B-roll reel, and carousel — keep copying hooks and script on this page.",
          "success",
        );
      }
    } finally {
      setLoading(false);
    }
  }, [clientSlug, orgSlug, session, show]);

  const onReject = useCallback(async () => {
    if (!session || !clientSlug || !orgSlug) return;
    setLoading(true);
    try {
      const res = await generationSetStatus(clientSlug, orgSlug, session.id, "reject");
      if (!res.ok) {
        show(res.error, "error");
        return;
      }
      setSession(res.data);
      show("Marked rejected.", "success");
    } finally {
      setLoading(false);
    }
  }, [clientSlug, orgSlug, session, show]);

  const onGenerateThumbnail = useCallback(async (textOverride?: string) => {
    if (!session?.id || !clientSlug || !orgSlug) return;
    setThumbnailLoading(true);
    try {
      const text = (textOverride ?? coverText).trim() || undefined;
      const res = await generationGenerateThumbnail(clientSlug, orgSlug, session.id, text);
      if (!res.ok) {
        show(res.error, "error");
        return;
      }
      setThumbnailUrl(res.data.thumbnail_url);
      show("Cover generated.", "success");
    } finally {
      setThumbnailLoading(false);
    }
  }, [clientSlug, orgSlug, coverText, session, show]);

  const copyText = useCallback(
    async (label: string, text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        show(`Copied ${label}.`, "success");
      } catch {
        show("Copy failed.", "error");
      }
    },
    [show],
  );

  const loadSessionById = useCallback(
    async (id: string) => {
      if (!clientSlug || !orgSlug) return;
      setLoading(true);
      try {
        const res = await generationGetSession(clientSlug, orgSlug, id);
        if (!res.ok) {
          show(res.error, "error");
          return;
        }
        const s = res.data;
        setSession(s);
        const hasPackage = Boolean(s.hooks?.length || (s.script && s.script.trim()));
        setStep(s.status === "angles_ready" && !hasPackage ? "angles" : "content");
      } finally {
        setLoading(false);
      }
    },
    [clientSlug, orgSlug, show],
  );

  const angles = Array.isArray(session?.angles) ? session!.angles! : [];

  const hooksByTier = useMemo(() => {
    const hooks = session?.hooks ?? [];
    const m: Record<1 | 2 | 3, { tier: number; text: string }[]> = { 1: [], 2: [], 3: [] };
    for (const h of hooks) {
      let t = h.tier;
      if (t !== 2 && t !== 3) t = 1;
      m[t as 1 | 2 | 3].push(h);
    }
    return m;
  }, [session?.hooks]);

  const allHooksText = useMemo(() => {
    const hooks = session?.hooks ?? [];
    return hooks.map((h) => h.text).join("\n\n");
  }, [session?.hooks]);

  const scriptSections = useMemo(
    () => parseScriptSections(session?.script ?? ""),
    [session?.script],
  );

  const synthesizedPatterns =
    session?.synthesized_patterns && typeof session.synthesized_patterns === "object"
      ? (session.synthesized_patterns as Record<string, unknown>)
      : null;

  const chosenAngle = session ? getChosenAngleRecord(session) : null;

  return (
    <main className="mx-auto max-w-[1400px] p-4 pb-16 pt-6 md:p-8 md:pt-10 lg:p-12">
      <header className="mb-8 md:mb-10">
        <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-app-fg-subtle">
          Generate
        </span>
        <h1 className="mb-2 max-w-2xl text-lg font-semibold text-app-fg">Outlier-driven copy</h1>
        <p className="max-w-2xl text-xs leading-relaxed text-app-fg-muted">
          Format intelligence from mature competitor reels → five angles → hooks, script, caption, and story
          lines in your client&apos;s voice (client DNA). Digests use reels posted 7+ days ago for reliable
          performance signals.
        </p>
      </header>

      {!clientSlug && (
        <p className="mb-6 text-sm text-amber-600 dark:text-amber-400">
          No active client in workspace — complete onboarding or switch client.
        </p>
      )}

      {step === "source" && (
        <div className="flex flex-col gap-8 lg:gap-10">
          <section className="glass w-full rounded-2xl border border-app-divider/80 p-6 shadow-sm md:p-8 lg:p-10">
            <div className="mx-auto max-w-5xl space-y-8">

              {/* ── Mode tabs ── */}
              <div>
                <h2 className="mb-1 text-sm font-semibold uppercase tracking-wider text-app-fg-subtle">
                  How do you want to start?
                </h2>
                <p className="mb-4 max-w-2xl text-sm text-app-fg-muted">
                  Choose one starting point below. Each path produces five angles in your client&apos;s voice.
                </p>
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      {
                        mode: "format_pick" as SourceMode,
                        label: "Pick a content style",
                        sub: "Choose a style we've already seen work in your niche",
                      },
                      {
                        mode: "idea_match" as SourceMode,
                        label: "Start from an idea",
                        sub: "Describe what you want to say; we find the best style for it",
                      },
                      {
                        mode: "url_adapt" as SourceMode,
                        label: "Adapt a competitor reel",
                        sub: "Paste an Instagram URL; we reverse-engineer it for your client",
                      },
                      {
                        mode: "script_adapt" as SourceMode,
                        label: "Adapt an English script",
                        sub: "Paste a talking-head script; we extract structure and write in your client language",
                      },
                    ] as { mode: SourceMode; label: string; sub: string }[]
                  ).map(({ mode, label, sub }) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setSourceMode(mode)}
                      className={`flex-1 min-w-[200px] rounded-xl border p-3 text-left transition-colors ${
                        sourceMode === mode
                          ? "border-amber-500/50 bg-amber-500/10"
                          : "border-app-divider bg-app-chip-bg/40 hover:bg-app-chip-bg/70"
                      }`}
                    >
                      <span className="block text-sm font-semibold text-app-fg">{label}</span>
                      <span className="mt-0.5 block text-xs leading-relaxed text-app-fg-muted">{sub}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* ── Content styles (format_pick) ── */}
              {sourceMode === "format_pick" ? (
                <div>
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-semibold text-app-fg">
                        Content styles from your niche
                      </h3>
                      <p className="mt-0.5 text-xs text-app-fg-muted">
                        These are the video styles we found in your competitors&apos; analyzed reels. Pick one to
                        generate angles in that style.{" "}
                        <span className="text-app-fg-subtle">
                          Numbers = how many reels we analyzed · avg comments/views · typical length.
                        </span>
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={loadingList || !clientSlug}
                      onClick={() => void loadFormatDigests(true)}
                      title="Recompute style summaries from your latest scraped reels. Run this after syncing new competitors in Intelligence."
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-app-divider px-3 py-1.5 text-xs font-semibold text-app-fg hover:bg-white/5 disabled:opacity-50"
                    >
                      <RefreshCw className={`size-3.5 ${loadingList ? "animate-spin" : ""}`} />
                      Refresh styles
                    </button>
                  </div>

                  {loadingList ? (
                    <div className="flex justify-center py-10">
                      <Loader2 className="size-6 animate-spin text-app-fg-subtle" />
                    </div>
                  ) : formatDigests.length === 0 ? (
                    <div className="rounded-xl border border-app-divider bg-app-chip-bg/25 px-5 py-8 text-center">
                      <p className="text-sm font-semibold text-app-fg">No styles yet</p>
                      <p className="mt-1 max-w-sm mx-auto text-xs leading-relaxed text-app-fg-muted">
                        Go to <strong className="text-app-fg-secondary">Intelligence → Reels</strong>, sync
                        competitors, run Silas analysis on a few reels, then come back and hit{" "}
                        <strong className="text-app-fg-secondary">Refresh styles</strong> above. First run takes
                        1–3 minutes.
                      </p>
                    </div>
                  ) : (
                    <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {formatDigests.map((d) => (
                        <li key={d.format_key}>
                          <button
                            type="button"
                            onClick={() => setSelectedFormatKey(d.format_key)}
                            className={`w-full rounded-xl border px-4 py-3 text-left transition-colors ${
                              selectedFormatKey === d.format_key
                                ? "border-amber-500/50 bg-amber-500/10"
                                : "border-app-divider hover:bg-white/[0.04]"
                            }`}
                          >
                            <span className="block font-semibold capitalize text-app-fg">
                              {formatKeyLabel(d.format_key)}
                            </span>
                            <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 tabular-nums text-[11px] text-app-fg-muted">
                              <span title="Analyzed reels in this style (all ages)">{d.reel_count ?? "—"} reels</span>
                              {d.avg_comment_view_ratio != null ? (
                                <span title="Avg comments ÷ views — how much conversation each view tends to generate">
                                  {d.avg_comment_view_ratio > 0 ? ((1 / d.avg_comment_view_ratio) * 100).toFixed(2) : "0"}% C/V
                                </span>
                              ) : d.avg_engagement != null ? (
                                <span title="Avg (likes+comments+saves+shares) ÷ views">
                                  {(d.avg_engagement * 100).toFixed(2)}% eng
                                </span>
                              ) : null}
                              {d.avg_duration_s != null ? (
                                <span title="Mean video length when available">~{d.avg_duration_s}s</span>
                              ) : null}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : null}

              {/* ── Idea match ── */}
              {sourceMode === "idea_match" ? (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-sm font-semibold text-app-fg">What do you want to say?</h3>
                    <p className="mt-0.5 text-xs text-app-fg-muted">
                      Describe the message or situation. We&apos;ll suggest which content style fits it best based
                      on your niche data.
                    </p>
                  </div>
                  <textarea
                    id="gen-idea"
                    rows={4}
                    value={ideaText}
                    onChange={(e) => setIdeaText(e.target.value)}
                    placeholder={'e.g. "Your manager says \'I need this by end of day\' at 4pm — what do you do?"'}
                    className="glass-inset min-h-[5rem] w-full resize-y rounded-xl p-3 text-sm text-app-fg placeholder:text-app-fg-subtle focus:outline-none focus:ring-2 focus:ring-amber-500/35"
                  />
                  <button
                    type="button"
                    disabled={loadingList || !clientSlug}
                    onClick={() => void onSuggestFormats()}
                    className="rounded-lg border border-app-divider px-3 py-2 text-xs font-bold text-app-fg hover:bg-white/5 disabled:opacity-50"
                  >
                    {loadingList ? "Thinking…" : "Find best style →"}
                  </button>
                  {formatRecommendations.length > 0 ? (
                    <ul className="space-y-2">
                      {formatRecommendations.map((r, i) => (
                        <li key={`${r.format_key ?? i}-${i}`}>
                          <button
                            type="button"
                            onClick={() => r.format_key && setSelectedFormatKey(r.format_key)}
                            className={`w-full rounded-lg border px-3 py-2 text-left text-xs ${
                              r.format_key && selectedFormatKey === r.format_key
                                ? "border-amber-500/40 bg-amber-500/10"
                                : "border-app-divider hover:bg-white/[0.04]"
                            }`}
                          >
                            <span className="font-semibold capitalize">
                              {r.format_key ? formatKeyLabel(r.format_key) : "—"}
                            </span>
                            {r.score != null ? (
                              <span className="ml-2 tabular-nums text-app-fg-muted">{r.score}/100</span>
                            ) : null}
                            <p className="mt-1 text-app-fg-muted">{str(r.reasoning)}</p>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {formatDigests.length > 0 ? (
                    <div>
                      <p className="mb-2 text-[10px] font-semibold uppercase text-app-fg-subtle">
                        Or pick a style manually
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {formatDigests.map((d) => (
                          <button
                            key={d.format_key}
                            type="button"
                            onClick={() => setSelectedFormatKey(d.format_key)}
                            className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                              selectedFormatKey === d.format_key
                                ? "bg-amber-500/25 text-app-fg ring-1 ring-amber-500/40"
                                : "bg-app-chip-bg text-app-fg-muted hover:bg-white/5"
                            }`}
                          >
                            {formatKeyLabel(d.format_key)}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {/* ── URL adapt ── */}
              {sourceMode === "url_adapt" ? (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-sm font-semibold text-app-fg">Competitor reel URL</h3>
                    <p className="mt-0.5 text-xs text-app-fg-muted">
                      We&apos;ll fetch the reel, analyse its structure, and rewrite it in your client&apos;s voice
                      and niche. Takes a bit longer than the other modes.
                    </p>
                  </div>

                  <div className="rounded-xl border border-app-divider bg-app-chip-bg/25 p-3 md:p-4">
                    <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-xs font-semibold text-app-fg">Suggested competitor reels</p>
                        <p className="mt-0.5 text-[11px] leading-relaxed text-app-fg-muted">
                          Top five by <span className="text-app-fg-secondary">comments ÷ views</span> among
                          synced competitor reels (not your creator&apos;s own). Tap a card to paste its URL
                          below.
                        </p>
                      </div>
                      <Link
                        href="/intelligence/reels"
                        className="shrink-0 text-xs font-semibold text-amber-600 hover:underline dark:text-amber-400"
                      >
                        View all reels →
                      </Link>
                    </div>
                    {adaptPreviewLoading ? (
                      <div className="flex justify-center py-6">
                        <Loader2 className="size-5 animate-spin text-app-fg-subtle" />
                      </div>
                    ) : adaptPreviewError ? (
                      <p className="text-xs text-red-400/90">{adaptPreviewError}</p>
                    ) : adaptPreviewRows.length === 0 ? (
                      <p className="text-xs text-app-fg-muted">
                        No competitor reels with enough views yet. Sync accounts in{" "}
                        <Link href="/intelligence/reels" className="font-semibold text-amber-600 hover:underline dark:text-amber-400">
                          Intelligence → Reels
                        </Link>
                        .
                      </p>
                    ) : (
                      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">
                        {adaptPreviewRows.map((row) => {
                          const url = (row.post_url ?? "").trim();
                          const selected = url && adaptUrl.trim() === url;
                          return (
                            <li key={row.id}>
                              <button
                                type="button"
                                disabled={!url}
                                onClick={() => {
                                  if (url) setAdaptUrl(url);
                                }}
                                className={`flex w-full flex-col gap-1.5 rounded-xl border p-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                                  selected
                                    ? "border-amber-500/55 bg-amber-500/10"
                                    : "border-app-divider hover:bg-white/[0.04]"
                                }`}
                              >
                                <ReelThumbnail
                                  src={row.thumbnail_url}
                                  alt={`@${row.account_username} reel`}
                                  size="md"
                                  className="mx-auto"
                                />
                                <span className="truncate text-center text-[10px] font-semibold text-app-fg">
                                  @{row.account_username}
                                </span>
                                <span className="text-center text-[10px] tabular-nums text-app-fg-muted">
                                  {formatCommentViewPct(row)} C/V
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>

                  <div>
                    <label htmlFor="gen-url" className="text-xs font-semibold text-app-fg-muted">
                      Paste URL (or pick above)
                    </label>
                    <input
                      id="gen-url"
                      type="url"
                      value={adaptUrl}
                      onChange={(e) => setAdaptUrl(e.target.value)}
                      placeholder="https://www.instagram.com/reel/…"
                      className="glass-inset mt-1.5 w-full rounded-xl px-3 py-2.5 font-mono text-sm text-app-fg placeholder:text-app-fg-subtle focus:outline-none focus:ring-2 focus:ring-amber-500/35"
                    />
                  </div>
                </div>
              ) : null}

              {/* ── Script adapt (English → client language) ── */}
              {sourceMode === "script_adapt" ? (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-sm font-semibold text-app-fg">English talking-head script</h3>
                    <p className="mt-0.5 text-xs text-app-fg-muted">
                      Paste the full script (hook through CTA). We extract winning structure, then generate five
                      fresh angles for your client — not a word-for-word translation.
                    </p>
                  </div>
                  <textarea
                    id="gen-script-adapt"
                    rows={12}
                    value={scriptAdaptText}
                    onChange={(e) => setScriptAdaptText(e.target.value)}
                    placeholder="Paste English script here…"
                    className="glass-inset min-h-[12rem] w-full resize-y rounded-xl p-3 font-mono text-sm leading-relaxed text-app-fg placeholder:text-app-fg-subtle focus:outline-none focus:ring-2 focus:ring-amber-500/35"
                  />
                </div>
              ) : null}

              {/* ── Optional focus note (all modes) ── */}
              <div className="space-y-2">
                <label htmlFor="gen-extra" className="text-sm font-semibold text-app-fg">
                  Anything specific to focus on?{" "}
                  <span className="font-normal text-app-fg-muted">(optional)</span>
                </label>
                <textarea
                  id="gen-extra"
                  rows={3}
                  value={extraInstruction}
                  onChange={(e) => setExtraInstruction(e.target.value)}
                  placeholder={'e.g. "Focus on the emotional side, not the tactical" or "Avoid mentioning money directly"'}
                  className="glass-inset min-h-[4.5rem] w-full resize-y rounded-xl p-3 text-sm leading-relaxed text-app-fg placeholder:text-app-fg-subtle focus:outline-none focus:ring-2 focus:ring-amber-500/35"
                />
              </div>

              {/* ── Generate button ── */}
              <div className="flex flex-col items-end gap-2">
                <button
                  type="button"
                  disabled={loading || !clientSlug}
                  onClick={() => void onStart()}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-bold text-zinc-950 shadow-md shadow-amber-900/20 transition-opacity hover:opacity-95 disabled:opacity-50"
                >
                  {loading ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Sparkles className="size-4" />
                  )}
                  {loading ? "Running models…" : "Generate angles"}
                </button>
                {sourceMode === "url_adapt" ? (
                  <p className="text-right text-xs text-app-fg-muted">
                    URL mode fetches and analyses the reel first — expect 30–60s.
                  </p>
                ) : null}
                {sourceMode === "script_adapt" ? (
                  <p className="text-right text-xs text-app-fg-muted">
                    Script mode runs two model steps (structure → angles) — usually under a minute.
                  </p>
                ) : null}
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-app-divider bg-app-chip-bg/30 p-5 md:p-6">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-app-fg-subtle">
              Recent sessions
            </h2>
            <p className="mt-2 text-xs leading-relaxed text-app-fg-muted">
              This list is the record for this client: source, angles, full package, and status (approve or
              reject here).{" "}
              <Link href="/create" className="font-medium text-sky-400 hover:underline">
                Create
              </Link>{" "}
              only shows sessions that are content-ready or approved{" "}
              <span className="font-medium text-app-fg-secondary">and</span> use a video layout format (text
              overlay, B-roll reel, carousel).
            </p>
            {sessions.length > 0 ? (
              <ul className="mt-4 flex max-h-[min(50vh,28rem)] flex-col gap-2 overflow-y-auto pr-1 md:max-h-[min(45vh,26rem)]">
                {sessions.map((s) => (
                  <li key={s.id} className="flex flex-col gap-1">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => void loadSessionById(s.id)}
                        className="glass min-w-0 flex-1 rounded-xl border border-app-divider px-4 py-3 text-left transition-colors hover:bg-white/5 md:px-4 md:py-3.5"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs tabular-nums text-app-fg-muted">
                            {formatSessionDate(s.created_at)}
                          </span>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${statusBadgeClass(s.status)}`}
                          >
                            {s.status.replace("_", " ")}
                          </span>
                          <span className="rounded-full bg-app-chip-bg px-2 py-0.5 text-[10px] font-semibold uppercase text-app-fg-subtle">
                            {sourceTypeLabel(s.source_type)}
                          </span>
                          {canonicalFormatKey(s.source_format_key) ? (
                            <span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-violet-300">
                              {formatKeyLabel(canonicalFormatKey(s.source_format_key))}
                            </span>
                          ) : (
                            <span className="rounded-full bg-zinc-500/15 px-2 py-0.5 text-[10px] text-app-fg-subtle">
                              Format — (patterns / adapt)
                            </span>
                          )}
                        </div>
                        <p className="mt-1.5 truncate text-sm font-medium text-app-fg md:text-base">
                          {sessionAngleSummary(s)}
                        </p>
                        <p className="mt-0.5 font-mono text-[11px] text-app-fg-subtle">{s.id.slice(0, 14)}…</p>
                      </button>
                      <button
                        type="button"
                        title="Delete session"
                        disabled={loading}
                        onClick={(e) => {
                          e.stopPropagation();
                          void onDeleteSession(s.id);
                        }}
                        className="shrink-0 self-stretch rounded-xl border border-red-500/30 px-3.5 text-red-400 transition-colors hover:bg-red-500/10 disabled:opacity-40"
                      >
                        <Trash2 className="mx-auto h-4 w-4 md:h-5 md:w-5" />
                      </button>
                    </div>
                    {sessionEligibleForCreate(s) ? (
                      <Link
                        href="/create"
                        className="self-end pr-12 text-[11px] font-semibold text-sky-400 hover:underline md:pr-14"
                      >
                        Video pipeline (Create) →
                      </Link>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 text-sm text-app-fg-muted">
                No sessions yet — generate angles above to start. Past runs will appear here with status and
                format.
              </p>
            )}
          </section>
        </div>
      )}

      {step === "angles" && session && (
        <section className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => {
                setStep("source");
                setSession(null);
              }}
              className="text-xs font-semibold text-app-fg-muted hover:text-app-fg"
            >
              ← New session
            </button>
            {session.synthesized_patterns && (
              <button
                type="button"
                title="Digest JSON copied onto this session when you started Generate (format pick, idea match, or URL adapt). Includes AI-written hooks and summaries; may show an error string if the digest AI failed."
                onClick={() => setPatternsOpen((o) => !o)}
                className="flex items-center gap-1 text-xs font-semibold text-app-fg-muted hover:text-app-fg"
              >
                Synthesized patterns{" "}
                {patternsOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </button>
            )}
          </div>
          {patternsOpen && synthesizedPatterns ? (
            <SynthesizedPatternsView patterns={synthesizedPatterns} />
          ) : null}
          {session.source_type === "url_adapt" ? (
            <UrlAdaptReferenceCard
              sourceUrl={session.source_url}
              patterns={synthesizedPatterns ?? undefined}
            />
          ) : null}
          {session.source_type === "script_adapt" ? (
            <ScriptAdaptReferenceCard
              sourceScript={session.source_script}
              patterns={synthesizedPatterns ?? undefined}
            />
          ) : null}
          <h2 className="text-sm font-semibold text-app-fg">Pick an angle</h2>
          {sessionUsesBlueprintFirstAngle(session) ? (
            <p className="max-w-2xl text-xs leading-relaxed text-app-fg-muted">
              The <span className="font-semibold text-app-fg-secondary">first angle</span> is the direct
              blueprint — same structure and topic arc as your source, rewritten in your client&apos;s voice.
              The others are same-format variants you can use if you want a twist.
            </p>
          ) : null}
          <div className="grid gap-3 md:grid-cols-2">
            {angles.map((raw, i) => {
              const choosing = choosingAngleIndex !== null;
              const isPicked = choosingAngleIndex === i;
              const dimSibling = choosing && !isPicked;
              const blueprint = angleIsBlueprint(raw, i, session);
              return (
                <div
                  key={i}
                  className={`glass flex flex-col gap-2 rounded-2xl p-5 transition-opacity ${
                    dimSibling ? "pointer-events-none opacity-40" : ""
                  } ${isPicked && choosing ? "ring-2 ring-amber-500/45" : ""}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-app-fg">{str(raw.title)}</p>
                    {blueprint ? (
                      <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-300">
                        Blueprint
                      </span>
                    ) : null}
                  </div>
                  <p className="text-xs text-app-fg-muted">{str(raw.situation)}</p>
                  <p className="text-[11px] text-app-fg-subtle">
                    <span className="font-medium text-app-fg-muted">Hook: </span>
                    {str(raw.draft_hook)}
                  </p>
                  <button
                    type="button"
                    disabled={choosing}
                    onClick={() => void onChooseAngle(i)}
                    className="mt-2 inline-flex items-center justify-center gap-2 rounded-lg bg-amber-500/15 py-2 text-xs font-bold text-app-on-amber-title hover:bg-amber-500/25 disabled:opacity-70"
                  >
                    {isPicked && choosing ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
                        Generating…
                      </>
                    ) : (
                      "Use this angle"
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {step === "content" && session && (
        <section className="space-y-8 pb-28">
          {/* ── Header row ── */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setStep("angles")}
              className="text-xs font-semibold text-app-fg-muted hover:text-app-fg"
            >
              ← Back to angles
            </button>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${statusBadgeClass(session.status)}`}
            >
              {session.status.replace("_", " ")}
            </span>
            <button
              type="button"
              disabled={loading}
              onClick={() => void onDeleteSession(session.id)}
              className="ml-auto flex items-center gap-1.5 rounded-xl border border-red-500/30 px-3 py-1.5 text-[11px] font-bold text-red-400 hover:bg-red-500/10 disabled:opacity-40"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete session
            </button>
          </div>

          {session.source_type === "url_adapt" ? (
            <UrlAdaptReferenceCard
              sourceUrl={session.source_url}
              patterns={synthesizedPatterns ?? undefined}
            />
          ) : null}
          {session.source_type === "script_adapt" ? (
            <ScriptAdaptReferenceCard
              sourceScript={session.source_script}
              patterns={synthesizedPatterns ?? undefined}
            />
          ) : null}

          {chosenAngle ? (
            <div className="glass rounded-2xl border border-amber-500/25 bg-amber-500/[0.06] p-4">
              <p className="text-[10px] font-bold uppercase tracking-wider text-app-fg-subtle">
                Chosen angle
              </p>
              <p className="mt-1 text-sm font-semibold text-app-fg">{str(chosenAngle.title)}</p>
              <p className="mt-1 text-xs leading-relaxed text-app-fg-muted">{str(chosenAngle.situation)}</p>
            </div>
          ) : null}

          {session.status === "approved" ? (
            <div className="rounded-xl border border-emerald-500/35 bg-emerald-500/[0.08] p-4">
              <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-200">
                {sessionEligibleForCreate(session)
                  ? "Next step: Create (video pipeline)"
                  : "Approved — copy lives here"}
              </p>
              <p className="mt-2 text-xs leading-relaxed text-app-fg-muted">
                {sessionEligibleForCreate(session) ? (
                  <>
                    Go to{" "}
                    <Link
                      href="/create"
                      className="font-semibold text-emerald-700 underline-offset-2 hover:underline dark:text-emerald-400"
                    >
                      Create
                    </Link>
                    . This session shows in the left-hand list — pick it, then generate backgrounds and render.
                  </>
                ) : (
                  <>
                    <Link
                      href="/create"
                      className="font-semibold text-app-fg-secondary underline-offset-2 hover:underline"
                    >
                      Create
                    </Link>{" "}
                    only includes packages whose format is{" "}
                    <span className="font-medium text-app-fg-secondary">text overlay</span>,{" "}
                    <span className="font-medium text-app-fg-secondary">B-roll reel</span>, or{" "}
                    <span className="font-medium text-app-fg-secondary">carousel</span>. This run is{" "}
                    <span className="font-medium text-app-fg-secondary">
                      {formatKeyLabel(canonicalFormatKey(session.source_format_key) || session.source_format_key || "—")}
                    </span>
                    — export hooks, script, and caption from this page.
                  </>
                )}
              </p>
            </div>
          ) : null}

          {/* ── Refine ── */}
          <div className="glass rounded-2xl p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-app-fg-subtle">
              Refine
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              <select
                value={regenScope}
                onChange={(e) => setRegenScope(e.target.value as typeof regenScope)}
                className="glass-inset rounded-xl px-3 py-2 text-sm text-app-fg"
              >
                <option value="all">Full package</option>
                <option value="hooks">Hooks only</option>
                <option value="script">Script only</option>
                <option value="caption">Caption + hashtags</option>
                <option value="story">Story lines only</option>
              </select>
              <input
                type="text"
                value={regenFeedback}
                onChange={(e) => setRegenFeedback(e.target.value)}
                placeholder="Direction e.g. shorter hook, more direct…"
                className="glass-inset min-w-[200px] flex-1 rounded-xl px-3 py-2 text-sm text-app-fg"
              />
              <button
                type="button"
                disabled={loading}
                onClick={() => void onRegenerate()}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-app-divider px-4 py-2 text-xs font-bold text-app-fg hover:bg-white/5 disabled:opacity-50"
              >
                {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                Regenerate
              </button>
            </div>
          </div>

          {/* ── Content blocks ── */}
          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-app-fg">Hooks ({session.hooks?.length ?? 0})</h2>
              {(session.hooks?.length ?? 0) > 0 ? (
                <button
                  type="button"
                  onClick={() => void copyText("all hooks", allHooksText)}
                  className="flex items-center gap-1 rounded-lg bg-app-icon-btn-bg px-3 py-1.5 text-[11px] font-bold text-app-icon-btn-fg"
                >
                  <Copy className="h-3.5 w-3.5" /> Copy all hooks
                </button>
              ) : null}
            </div>
            <div className="space-y-6">
              {TIER_GROUPS.map(({ tier, title, subtitle }) => {
                const list = hooksByTier[tier];
                if (!list.length) return null;
                return (
                  <div key={tier}>
                    <p className="mb-1 text-xs font-bold uppercase tracking-wide text-app-fg-subtle">
                      {title}
                    </p>
                    <p className="mb-2 text-[11px] text-app-fg-muted">{subtitle}</p>
                    <ul className="space-y-2">
                      {list.map((h, i) => (
                        <li
                          key={`${tier}-${i}-${h.text.slice(0, 24)}`}
                          className="glass flex items-start justify-between gap-3 rounded-xl p-4"
                        >
                          <p className="flex-1 text-sm leading-relaxed text-app-fg">{h.text}</p>
                          <button
                            type="button"
                            onClick={() => void copyText("hook", h.text)}
                            className="shrink-0 rounded-lg bg-app-icon-btn-bg p-2 text-app-icon-btn-fg"
                          >
                            <Copy className="h-4 w-4" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── Reel cover ── */}
          {(session.hooks?.length ?? 0) > 0 && (
            <div className="glass rounded-2xl border border-app-divider/80 p-5 md:p-6">
              <div className="mb-4">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-app-fg">
                  <ImageIcon className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
                  Reel cover
                </h2>
                <p className="mt-0.5 text-xs text-app-fg-muted">
                  Generate a minimal editorial cover image (9:16) — the selected hook becomes the headline.
                </p>
              </div>

              <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
                {/* ── Left: portrait preview ── */}
                <div className="mx-auto shrink-0 lg:mx-0">
                  {thumbnailLoading ? (
                    <div className="flex aspect-[9/16] w-[180px] flex-col items-center justify-center gap-3 rounded-xl border border-app-divider bg-app-chip-bg/40">
                      <Loader2 className="h-7 w-7 animate-spin text-app-fg-subtle" />
                      <p className="px-4 text-center text-[10px] text-app-fg-muted">~30–60s</p>
                    </div>
                  ) : thumbnailUrl ? (
                    <div className="w-[180px] overflow-hidden rounded-xl border border-app-divider shadow-lg">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={thumbnailUrl}
                        alt="Generated reel cover"
                        width={180}
                        height={320}
                        className="block aspect-[9/16] w-full object-cover"
                        style={{ aspectRatio: "9/16" }}
                      />
                    </div>
                  ) : (
                    <div className="flex aspect-[9/16] w-[180px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-app-divider/70 bg-app-chip-bg/20">
                      <ImageIcon className="h-7 w-7 text-app-fg-subtle opacity-30" aria-hidden />
                      <p className="px-4 text-center text-[10px] text-app-fg-subtle">Cover preview</p>
                    </div>
                  )}
                </div>

                {/* ── Right: controls ── */}
                <div className="flex min-w-0 flex-1 flex-col gap-4">
                  {/* Hook picker */}
                  <div>
                    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-app-fg-subtle">
                      Headline for cover
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {(session.hooks ?? []).map((h, i) => {
                        const isSelected = coverText === h.text;
                        return (
                          <button
                            key={i}
                            type="button"
                            onClick={() => setCoverText(h.text)}
                            className={`max-w-[260px] truncate rounded-lg border px-2.5 py-1 text-left text-[11px] transition-colors ${
                              isSelected
                                ? "border-amber-500/50 bg-amber-500/15 font-semibold text-app-fg"
                                : "border-app-divider text-app-fg-muted hover:border-amber-500/30 hover:bg-amber-500/5"
                            }`}
                            title={h.text}
                          >
                            {h.text.length > 60 ? `${h.text.slice(0, 58)}…` : h.text}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Custom text override */}
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-app-fg-subtle">
                      Or type a custom headline
                    </label>
                    <textarea
                      rows={2}
                      value={coverText}
                      onChange={(e) => setCoverText(e.target.value)}
                      placeholder="Type a custom headline for the cover…"
                      className="glass-inset w-full resize-none rounded-xl px-3 py-2 text-sm text-app-fg placeholder:text-app-fg-subtle focus:outline-none focus:ring-2 focus:ring-amber-500/35"
                    />
                  </div>

                  {/* Active text preview */}
                  {coverText.trim() && (
                    <p className="rounded-lg border border-app-divider/60 bg-app-chip-bg/30 px-3 py-2 text-xs italic leading-relaxed text-app-fg-secondary">
                      &ldquo;{coverText.trim()}&rdquo;
                    </p>
                  )}

                  {/* Actions */}
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={thumbnailLoading}
                      onClick={() => void onGenerateThumbnail()}
                      className="inline-flex items-center gap-2 rounded-xl bg-amber-500/15 px-4 py-2 text-sm font-bold text-app-on-amber-title hover:bg-amber-500/25 disabled:opacity-50"
                    >
                      {thumbnailLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                      ) : (
                        <Sparkles className="h-4 w-4" aria-hidden />
                      )}
                      {thumbnailLoading ? "Generating…" : thumbnailUrl ? "Regenerate" : "Generate cover"}
                    </button>

                    {thumbnailUrl && !thumbnailLoading && (
                      <a
                        href={thumbnailUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-2 rounded-xl border border-app-divider px-4 py-2 text-sm font-semibold text-app-fg hover:bg-white/5"
                      >
                        <Download className="h-4 w-4" aria-hidden />
                        Open full size
                      </a>
                    )}
                  </div>

                  {thumbnailUrl && !thumbnailLoading && (
                    <p className="text-[10px] text-app-fg-subtle">
                      Right-click → Save image as, or use Open full size to download.
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          <div>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-app-fg">60s script</h2>
              <button
                type="button"
                onClick={() => void copyText("script", session.script ?? "")}
                className="flex items-center gap-1 rounded-lg bg-app-icon-btn-bg px-3 py-1.5 text-[11px] font-bold text-app-icon-btn-fg"
              >
                <Copy className="h-3.5 w-3.5" /> Copy all
              </button>
            </div>
            <div className="space-y-3">
              {scriptSections.length === 0 ? (
                <p className="glass rounded-2xl p-5 text-sm text-app-fg-muted">—</p>
              ) : (
                scriptSections.map((sec, i) => (
                  <div
                    key={`${sec.heading}-${i}`}
                    className="glass rounded-2xl border border-app-divider/80 p-4 md:p-5"
                  >
                    {sec.heading ? (
                      <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-amber-600 dark:text-amber-400">
                        {sec.heading}
                      </h3>
                    ) : null}
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-app-fg">{sec.body || "—"}</p>
                  </div>
                ))
              )}
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-app-fg">Caption</h2>
              <button
                type="button"
                onClick={() =>
                  void copyText(
                    "caption",
                    `${session.caption_body ?? ""}\n\n${(session.hashtags ?? []).join(" ")}`,
                  )
                }
                className="flex items-center gap-1 rounded-lg bg-app-icon-btn-bg px-3 py-1.5 text-[11px] font-bold text-app-icon-btn-fg"
              >
                <Copy className="h-3.5 w-3.5" /> Copy + tags
              </button>
            </div>
            <div className="glass rounded-2xl p-5 text-sm leading-relaxed text-app-fg">
              <p className="whitespace-pre-wrap">{session.caption_body ?? "—"}</p>
              <p className="mt-3 text-xs text-app-fg-muted">
                {(session.hashtags ?? []).join(" ") || "—"}
              </p>
            </div>
          </div>

          {Array.isArray(session.text_blocks) && session.text_blocks.length > 0 ? (
            <div>
              <h2 className="mb-2 text-sm font-semibold text-app-fg">On-screen text (Create)</h2>
              <ul className="glass space-y-2 rounded-2xl p-5">
                {session.text_blocks.map((b, i) => (
                  <li key={i} className="text-sm text-app-fg">
                    {typeof b === "object" && b && "text" in b ? String((b as { text?: string }).text) : "—"}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div>
            <h2 className="mb-2 text-sm font-semibold text-app-fg">Story variants</h2>
            <ul className="space-y-2">
              {(session.story_variants ?? []).map((line, i) => (
                <li key={i} className="glass flex items-center justify-between gap-3 rounded-xl p-4">
                  <p className="text-sm text-app-fg">{line}</p>
                  <button
                    type="button"
                    onClick={() => void copyText("story", line)}
                    className="rounded-lg bg-app-icon-btn-bg p-2"
                  >
                    <Copy className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {/* ── Sticky approve / reject bar ── */}
          <div className="fixed bottom-0 left-0 right-0 z-40 flex items-center justify-between gap-3 px-4 py-3 md:px-8 lg:px-12"
            style={{ background: "transparent" }}
          >
            {/* glass backdrop */}
            <div className="pointer-events-none absolute inset-0 border-t border-white/[0.08] bg-zinc-950/75 backdrop-blur-2xl backdrop-saturate-[1.3]" />
            <div className="relative flex min-w-0 flex-1 flex-wrap items-center gap-2">
              <span className="text-xs text-app-fg-muted">
                {session.status === "approved"
                  ? sessionEligibleForCreate(session)
                    ? "Approved — open Create to build video"
                    : "Approved — use this page to copy (not in Create for this format)"
                  : session.status === "rejected"
                    ? "Marked as rejected"
                    : "Review this package and approve or reject it"}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${statusBadgeClass(session.status)}`}
              >
                {session.status.replace("_", " ")}
              </span>
            </div>
            <div className="relative flex shrink-0 items-center gap-2">
              <button
                type="button"
                disabled={loading}
                onClick={() => void onReject()}
                className="inline-flex items-center gap-2 rounded-xl border border-red-500/40 px-4 py-2 text-sm font-semibold text-red-400 transition-colors hover:bg-red-500/10 disabled:opacity-40"
              >
                <ThumbsDown className="h-4 w-4" /> Reject
              </button>
              <button
                type="button"
                disabled={loading || session.status === "approved"}
                onClick={() => void onApprove()}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-5 py-2 text-sm font-bold text-zinc-950 shadow-md shadow-emerald-900/30 transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                <ThumbsUp className="h-4 w-4" /> Approve
              </button>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
