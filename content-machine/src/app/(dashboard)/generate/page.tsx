"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Loader2, Sparkles, Trash2 } from "lucide-react";
import { ReelThumbnail } from "@/components/reel-thumbnail";
import { useToast } from "@/components/ui/toast-provider";
import { VideoCreateWorkspace } from "@/components/video-create-workspace";
import type { ScrapedReelRow } from "@/lib/api";
import { formatCommentViewPct } from "@/lib/reel-comment-view";
import {
  clientApiContext,
  fetchAdaptPreviewReels,
  fetchFormatDigests,
  generateAutoVideoIdea,
  generationChooseAngle,
  generationDeleteSession,
  generationGetSession,
  generationListSessions,
  generationStart,
  recommendFormatForIdea,
  type FormatDigestSummary,
  type GenerationSession,
} from "@/lib/api-client";

type Step = "source" | "angles" | "create";

/** Top-level user intent: write something new vs. adapt an existing reel. Persisted in localStorage. */
type Mode = "idea" | "recreate";

const MODE_STORAGE_KEY = "silas:generate:mode";

/** Video format preset for idea / empty-composer flows (`auto` = pick from niche data or AI). */
type FormatPreset = "auto" | "text_overlay" | "talking_head" | "carousel";

function isLikelyInstagramReelUrl(s: string): boolean {
  const t = s.trim().toLowerCase();
  return (
    t.includes("instagram.com/reel") ||
    t.includes("instagram.com/reels/") ||
    t.includes("instagram.com/p/") ||
    t.includes("instagram.com/tv/")
  );
}

/** Formats we want users to choose from in the unified flow. */
const ALLOWED_VIDEO_FORMATS = new Set(["text_overlay", "talking_head", "carousel"]);

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

/** Match backend canonicalize_stored_format_key (legacy b_roll → b_roll_reel). */
function canonicalFormatKey(key: string | null | undefined): string {
  const k = (key || "").trim();
  if (k === "b_roll") return "b_roll_reel";
  return k;
}

/**
 * True when the session has a content package (hooks/script) ready, regardless of status.
 * Includes legacy `approved`/`rejected` sessions and the new `content_ready` flow.
 */
function sessionHasPackage(s: GenerationSession): boolean {
  if (Array.isArray(s.hooks) && s.hooks.length > 0) return true;
  if (s.script && s.script.trim().length > 0) return true;
  if (s.caption_body && s.caption_body.trim().length > 0) return true;
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

/**
 * One row in the Recent sessions panel. Adapts to the session's actual state instead
 * of pretending every session looks the same:
 *   - **Done** (`render_status === "done"` and `thumbnail_url` exists) → visual card:
 *     9:16 cover thumbnail + caption snippet so the user can see what they made.
 *   - **In progress** (anything else) → compact text row, same as before. We don't
 *     fake a thumbnail when there isn't one — that would be theater.
 *
 * The card is the catalogue entry users browse to find / reopen / show off finished
 * posts. The same data we already fetch from `generationListSessions` (no backend work).
 */
function SessionCard({
  session,
  loading,
  onOpen,
  onDelete,
}: {
  session: GenerationSession;
  loading: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const isDone = session.render_status === "done" && Boolean(session.thumbnail_url);
  const formatKey = canonicalFormatKey(session.source_format_key);
  const captionSnippet = (session.caption_body ?? "").trim().replace(/\s+/g, " ");

  return (
    <li className="flex flex-col gap-1">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onOpen}
          className="glass min-w-0 flex-1 rounded-xl border border-app-divider text-left transition-colors hover:bg-white/5"
        >
          {isDone ? (
            <div className="flex items-stretch gap-3 p-2.5">
              {/* 9:16 cover thumbnail — the actual reel cover, at the actual aspect ratio. */}
              <div className="shrink-0 overflow-hidden rounded-lg border border-app-divider bg-black/20">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={session.thumbnail_url ?? ""}
                  alt=""
                  className="block aspect-[9/16] w-[72px] object-cover md:w-[80px]"
                />
              </div>
              <div className="flex min-w-0 flex-1 flex-col justify-between py-0.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-app-fg">
                    {sessionAngleSummary(session)}
                  </p>
                  {captionSnippet ? (
                    <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-app-fg-muted">
                      {captionSnippet}
                    </p>
                  ) : null}
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-400">
                    Done
                  </span>
                  {formatKey ? (
                    <span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-violet-300">
                      {formatKeyLabel(formatKey)}
                    </span>
                  ) : null}
                  <span className="text-[10px] tabular-nums text-app-fg-subtle">
                    {formatSessionDate(session.created_at)}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            // Compact / in-progress row — same density as today, nothing to preview yet.
            <div className="px-4 py-3 md:py-3.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs tabular-nums text-app-fg-muted">
                  {formatSessionDate(session.created_at)}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${statusBadgeClass(session.status)}`}
                >
                  {session.status.replace("_", " ")}
                </span>
                <span className="rounded-full bg-app-chip-bg px-2 py-0.5 text-[10px] font-semibold uppercase text-app-fg-subtle">
                  {sourceTypeLabel(session.source_type)}
                </span>
                {formatKey ? (
                  <span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-violet-300">
                    {formatKeyLabel(formatKey)}
                  </span>
                ) : null}
              </div>
              <p className="mt-1.5 truncate text-sm font-medium text-app-fg md:text-base">
                {sessionAngleSummary(session)}
              </p>
            </div>
          )}
        </button>
        <button
          type="button"
          title="Delete session"
          disabled={loading}
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="shrink-0 self-stretch rounded-xl border border-red-500/30 px-3.5 text-red-400 transition-colors hover:bg-red-500/10 disabled:opacity-40"
        >
          <Trash2 className="mx-auto h-4 w-4 md:h-5 md:w-5" />
        </button>
      </div>
      {/* Surface the "video pipeline ready" hint only on in-progress rows; on done rows
          the Done pill already says it. */}
      {!isDone && sessionHasPackage(session) ? (
        <span className="self-end pr-12 text-[11px] font-semibold text-emerald-500 md:pr-14 dark:text-emerald-400">
          Video pipeline ready →
        </span>
      ) : null}
    </li>
  );
}

/**
 * The green "Blueprint" pill on angle 1 of url_adapt sessions, with a focus/hover
 * popover that names what the LLM preserves vs swaps. Mirrors the prompt contract in
 * `backend/services/content_generation.py::run_angle_generation` (FAITHFUL BLUEPRINT branch)
 * so the UI promise matches what the model is actually instructed to do.
 */
function BlueprintBadge() {
  return (
    <span className="group relative inline-flex items-center gap-1">
      <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-300">
        Blueprint
      </span>
      <button
        type="button"
        aria-label="What's preserved and swapped in the Blueprint angle"
        className="rounded-full text-[11px] leading-none text-emerald-400/80 transition-colors hover:text-emerald-300 focus:outline-none focus-visible:ring-1 focus-visible:ring-emerald-400/60"
      >
        ⓘ
      </button>
      <span
        role="tooltip"
        className="pointer-events-none invisible absolute left-0 top-full z-30 mt-1.5 w-72 rounded-xl border border-app-divider bg-zinc-900/95 p-3 text-left text-[11px] leading-relaxed text-zinc-100 opacity-0 shadow-xl backdrop-blur transition-opacity duration-100 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
      >
        <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-emerald-400">
          What &ldquo;Blueprint&rdquo; means
        </p>
        <p className="mb-2.5 text-zinc-300">
          This angle keeps the source reel&apos;s structure — and rewrites everything else in your
          client&apos;s voice.
        </p>
        <div className="grid grid-cols-2 gap-x-3">
          <div>
            <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-300/80">
              Preserved
            </p>
            <ul className="space-y-0.5 text-zinc-300">
              <li>Format &amp; beats</li>
              <li>Hook mechanism</li>
              <li>Topic arc</li>
              <li>Payoff / CTA</li>
            </ul>
          </div>
          <div>
            <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300/80">
              Swapped
            </p>
            <ul className="space-y-0.5 text-zinc-300">
              <li>Language</li>
              <li>Names &amp; setting</li>
              <li>Concrete examples</li>
              <li>Voice (Client DNA)</li>
            </ul>
          </div>
        </div>
      </span>
    </span>
  );
}

export default function GeneratePage() {
  const { show } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionIdFromUrl = searchParams.get("session");
  const urlFromUrl = searchParams.get("url");
  const [step, setStep] = useState<Step>("source");
  /**
   * Suppresses the source/angles/create UI on the very first render when the page
   * was opened via `/generate?session=…` (e.g. from /media or the Recent sessions
   * panel). Without this we render the composer for one frame before the session
   * fetch resolves, which reads as a broken navigation. Cleared as soon as the
   * loading effect either succeeds or fails.
   */
  const [loadingFromUrl, setLoadingFromUrl] = useState<boolean>(() =>
    Boolean(sessionIdFromUrl?.trim()),
  );
  /**
   * Mode must match server + first client paint (no `localStorage` in the initializer — it
   * caused hydration mismatches when the stored tab differed from SSR). We sync storage in
   * `useEffect` after mount; `?url=…` still forces Recreate on both.
   */
  const [mode, setMode] = useState<Mode>(() => (urlFromUrl?.trim() ? "recreate" : "idea"));
  useEffect(() => {
    if (urlFromUrl?.trim()) {
      setMode("recreate");
      return;
    }
    try {
      const stored = window.localStorage.getItem(MODE_STORAGE_KEY);
      if (stored === "idea" || stored === "recreate") setMode(stored);
    } catch {
      // ignore (private mode, etc.)
    }
  }, [urlFromUrl]);
  const [composerInput, setComposerInput] = useState(urlFromUrl?.trim() ?? "");
  const [formatPreset, setFormatPreset] = useState<FormatPreset>("auto");
  /** Target production format for "Recreate a reel" — no default; user must pick.
   * `auto` keeps the source reel's original format. */
  const [recreateFormat, setRecreateFormat] = useState<FormatPreset | null>(null);
  const [extraInstruction, setExtraInstruction] = useState("");
  const [focusNoteOpen, setFocusNoteOpen] = useState(false);
  const [formatDigests, setFormatDigests] = useState<FormatDigestSummary[]>([]);
  const [adaptPreviewRows, setAdaptPreviewRows] = useState<ScrapedReelRow[]>([]);
  const [adaptPreviewLoading, setAdaptPreviewLoading] = useState(false);
  const [adaptPreviewError, setAdaptPreviewError] = useState<string | null>(null);
  const [session, setSession] = useState<GenerationSession | null>(null);
  const [sessions, setSessions] = useState<GenerationSession[]>([]);
  const [loading, setLoading] = useState(false);
  /** Index of angle being submitted (content generation); other angle cards stay visible but dimmed. */
  const [choosingAngleIndex, setChoosingAngleIndex] = useState<number | null>(null);
  const [patternsOpen, setPatternsOpen] = useState(false);
  const [clientSlug, setClientSlug] = useState("");
  const [orgSlug, setOrgSlug] = useState("");

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

  /** Persist mode + clear composer so a stale URL doesn't leak into idea mode (or vice versa). */
  const onChangeMode = useCallback((next: Mode) => {
    setMode(next);
    setComposerInput("");
    try {
      if (typeof window !== "undefined") {
        window.localStorage.setItem(MODE_STORAGE_KEY, next);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const ctx = await refreshContext();
      if (!ctx.clientSlug || !ctx.orgSlug) return;
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
    })();
  }, [refreshContext, show]);

  /** Top competitor reels by comments÷views — quick-pick URLs into the composer. */
  useEffect(() => {
    if (!clientSlug || !orgSlug || step !== "source") return;
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
  }, [clientSlug, orgSlug, step]);

  /** Open session from Intelligence "Recreate" flow, /media cards, or the Recent
   *  sessions panel (`/generate?session=…`). While this effect is in flight we
   *  hide the composer/angles UI behind a `loadingFromUrl` gate so the user
   *  doesn't see a flash of the wrong step. */
  useEffect(() => {
    const raw = sessionIdFromUrl?.trim();
    if (!raw) return;
    if (!clientSlug.trim() || !orgSlug.trim()) {
      // Wait for client/org bootstrap to finish — keep the loading gate up.
      return;
    }
    let cancelled = false;
    void (async () => {
      const res = await generationGetSession(clientSlug, orgSlug, raw);
      if (cancelled) return;
      router.replace("/generate", { scroll: false });
      if (!res.ok) {
        setLoadingFromUrl(false);
        show(res.error, "error");
        return;
      }
      setSession(res.data);
      if (sessionHasPackage(res.data)) {
        setStep("create");
      } else {
        setStep("angles");
      }
      await refreshSessions();
      setLoadingFromUrl(false);
      show("Session loaded.", "success");
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

  /** Niche reel count per video format — annotates the format pills with social proof. */
  const nicheReelCountByFormat = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of formatDigests) {
      const canon = canonicalFormatKey(d.format_key);
      if (ALLOWED_VIDEO_FORMATS.has(canon)) {
        m.set(canon, d.reel_count ?? 0);
      }
    }
    return m;
  }, [formatDigests]);

  const onStart = useCallback(async () => {
    const ctx = await refreshContext();
    if (!ctx.clientSlug || !ctx.orgSlug) {
      show("No workspace client — finish onboarding.", "error");
      return;
    }
    const raw = composerInput.trim();
    const extra = extraInstruction.trim() || undefined;
    setLoading(true);
    try {
      let body: Parameters<typeof generationStart>[2];

      if (mode === "recreate") {
        if (!raw) {
          show("Paste a reel URL or pick one from the quick picks below.", "error");
          return;
        }
        if (!isLikelyInstagramReelUrl(raw)) {
          show("That doesn't look like an Instagram reel URL.", "error");
          return;
        }
        if (!recreateFormat) {
          show("Pick a target format to recreate the reel as.", "error");
          return;
        }
        body = {
          source_type: "url_adapt",
          url: raw,
          extra_instruction: extra,
          format_key: recreateFormat === "auto" ? undefined : recreateFormat,
        };
      } else if (raw.length > 0) {
        // Idea mode + text → idea_match (auto resolves format from niche data).
        let fk: string;
        if (formatPreset === "auto") {
          const recRes = await recommendFormatForIdea(ctx.clientSlug, ctx.orgSlug, raw);
          if (!recRes.ok) {
            show(recRes.error, "error");
            return;
          }
          const first = recRes.data[0]?.format_key;
          const canon = first ? canonicalFormatKey(String(first)) : "";
          fk = ALLOWED_VIDEO_FORMATS.has(canon) ? canon : "text_overlay";
        } else {
          fk = formatPreset;
        }
        body = {
          source_type: "idea_match",
          format_key: fk,
          idea_text: raw,
          extra_instruction: extra,
        };
      } else if (formatPreset !== "auto") {
        // Idea mode + empty box + explicit format → format_pick (style only).
        body = {
          source_type: "format_pick",
          format_key: formatPreset,
          extra_instruction: extra,
        };
      } else {
        // Idea mode + empty + auto → AI proposes both an idea and the format.
        const ideaRes = await generateAutoVideoIdea(ctx.clientSlug, ctx.orgSlug);
        if (!ideaRes.ok) {
          show(ideaRes.error, "error");
          return;
        }
        let fk = canonicalFormatKey(ideaRes.data.suggested_format_key);
        if (!ALLOWED_VIDEO_FORMATS.has(fk)) fk = "text_overlay";
        body = {
          source_type: "idea_match",
          format_key: fk,
          idea_text: ideaRes.data.idea.trim(),
          extra_instruction: extra,
        };
      }

      const res = await generationStart(ctx.clientSlug, ctx.orgSlug, body);
      if (!res.ok) {
        show(res.error, "error");
        return;
      }
      setSession(res.data);
      setStep("angles");
      show("Angles ready — pick one.", "success");
      const lr = await generationListSessions(ctx.clientSlug, ctx.orgSlug, 15);
      if (lr.ok) setSessions(lr.data);
    } finally {
      setLoading(false);
    }
  }, [
    composerInput,
    extraInstruction,
    formatPreset,
    mode,
    recreateFormat,
    refreshContext,
    show,
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
        setStep("create");
        show("Script and captions generated.", "success");
      } finally {
        setChoosingAngleIndex(null);
      }
    },
    [clientSlug, orgSlug, session, show],
  );

  // The legacy global "Refine" panel was removed in favour of per-section regenerate
  // buttons that live inside VideoCreateWorkspace. Approve/Reject is gone too —
  // rendering a video implicitly approves it; rejection became "Delete session".
  // Cover generation also lives entirely inside VideoCreateWorkspace now.

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
        if (sessionHasPackage(s)) {
          setStep("create");
        } else {
          setStep("angles");
        }
      } finally {
        setLoading(false);
      }
    },
    [clientSlug, orgSlug, show],
  );

  const angles = Array.isArray(session?.angles) ? session!.angles! : [];

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
          Start from an idea or recreate a winning reel — we&apos;ll propose five angles in your client&apos;s
          voice (Client DNA), then hooks, script, and caption.
        </p>
      </header>

      {!clientSlug && (
        <p className="mb-6 text-sm text-amber-600 dark:text-amber-400">
          No active client in workspace — complete onboarding or switch client.
        </p>
      )}

      {/* Loading gate: when the page was opened with `?session=…` (deep-link from
          /media, Recent sessions, Intelligence Recreate), show a quiet loading state
          instead of the composer until the session fetch resolves. Prevents the
          one-frame flash of the wrong step that read as a broken navigation. */}
      {loadingFromUrl && (
        <div className="glass flex flex-col items-center justify-center gap-3 rounded-2xl border border-app-divider/80 px-6 py-16 text-center">
          <Loader2 className="h-6 w-6 animate-spin text-app-fg-muted" aria-hidden />
          <p className="text-sm font-medium text-app-fg">Loading session…</p>
          <p className="text-xs text-app-fg-subtle">Pulling angles, script, and render status.</p>
        </div>
      )}

      {!loadingFromUrl && step === "source" && (
        <div className="flex flex-col gap-8 lg:gap-10">
          <section className="glass w-full rounded-2xl border border-app-divider/80 p-6 shadow-sm md:p-8 lg:p-10">
            <div className="mx-auto max-w-3xl space-y-7">
              {/* Mode switch — two real intents, no overlap */}
              <div className="flex justify-center">
                <div
                  role="tablist"
                  aria-label="What are you doing?"
                  className="inline-flex rounded-xl border border-app-divider bg-app-chip-bg/40 p-1"
                >
                  {(
                    [
                      { key: "idea" as const, label: "Start from an idea" },
                      { key: "recreate" as const, label: "Recreate a reel" },
                    ] as const
                  ).map(({ key, label }) => {
                    const active = mode === key;
                    return (
                      <button
                        key={key}
                        role="tab"
                        type="button"
                        aria-selected={active}
                        onClick={() => onChangeMode(key)}
                        className={`rounded-lg px-4 py-1.5 text-xs font-semibold transition-colors ${
                          active
                            ? "bg-amber-500/15 text-app-fg"
                            : "text-app-fg-muted hover:text-app-fg"
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {mode === "idea" ? (
                <>
                  <div>
                    <label htmlFor="gen-idea" className="mb-2 block text-sm font-semibold text-app-fg">
                      What&apos;s the idea?
                    </label>
                    <textarea
                      id="gen-idea"
                      rows={5}
                      value={composerInput}
                      onChange={(e) => setComposerInput(e.target.value)}
                      placeholder={
                        'e.g. "Your boss says \'I need this by EOD\' at 4pm — what do you do?"\nLeave empty and we\'ll propose one from your niche context.'
                      }
                      className="glass-inset min-h-[6rem] w-full resize-y rounded-xl p-3 text-sm leading-relaxed text-app-fg placeholder:text-app-fg-subtle focus:outline-none focus:ring-2 focus:ring-amber-500/35"
                    />
                  </div>

                  <div>
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-app-fg-subtle">
                      Format
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {(
                        [
                          { key: "auto" as const, label: "Auto", showCount: false },
                          { key: "text_overlay" as const, label: "Text overlay", showCount: true },
                          { key: "talking_head" as const, label: "Talking head", showCount: true },
                          { key: "carousel" as const, label: "Carousel", showCount: true },
                        ] as const
                      ).map(({ key, label, showCount }) => {
                        const active = formatPreset === key;
                        const count = showCount ? nicheReelCountByFormat.get(key) ?? 0 : 0;
                        return (
                          <button
                            key={key}
                            type="button"
                            onClick={() => setFormatPreset(key)}
                            className={`rounded-xl border px-3 py-2 text-xs font-semibold transition-colors ${
                              active
                                ? "border-amber-500/50 bg-amber-500/10 text-app-fg"
                                : "border-app-divider bg-app-chip-bg/40 text-app-fg-muted hover:bg-app-chip-bg/70"
                            }`}
                          >
                            {label}
                            {showCount && count > 0 ? (
                              <span
                                className="ml-1.5 font-normal text-app-fg-subtle"
                                title="Analyzed competitor reels in this style"
                              >
                                · {count} in your niche
                              </span>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                    <p className="mt-2 text-[11px] leading-relaxed text-app-fg-muted">
                      Auto picks the best fit from your niche data when you have text — or a proven style (and
                      a fresh idea) when the box is empty.
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label htmlFor="gen-url" className="mb-2 block text-sm font-semibold text-app-fg">
                      Which reel?
                    </label>
                    <input
                      id="gen-url"
                      type="text"
                      value={composerInput}
                      onChange={(e) => setComposerInput(e.target.value)}
                      placeholder="https://www.instagram.com/reel/…"
                      className="glass-inset w-full rounded-xl p-3 text-sm leading-relaxed text-app-fg placeholder:text-app-fg-subtle focus:outline-none focus:ring-2 focus:ring-amber-500/35"
                    />
                    {composerInput.trim() && !isLikelyInstagramReelUrl(composerInput) ? (
                      <p className="mt-2 text-[11px] text-amber-500">
                        That doesn&apos;t look like an Instagram reel URL.
                      </p>
                    ) : (
                      <p className="mt-2 text-[11px] leading-relaxed text-app-fg-muted">
                        We&apos;ll fetch the reel, learn what made it work, then propose a faithful{" "}
                        <span className="font-medium text-app-fg-secondary">Blueprint</span> angle (same
                        idea, your client&apos;s voice) plus four variants in the format you pick below.
                      </p>
                    )}
                  </div>

                  {/* ── Recreate-as format picker ──
                      Required: lets the user pick the production format the source reel
                      should be rebuilt as. "Auto" keeps the source reel's original format
                      (legacy behavior); the others tell the LLM to keep the CORE IDEA but
                      rebuild the FORMAT RECIPE for that target. */}
                  <div>
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-app-fg-subtle">
                      Recreate as <span className="font-normal text-app-fg-muted">(required)</span>
                    </p>
                    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Target format">
                      {(
                        [
                          { key: "auto" as const, label: "Auto", hint: "Keep source reel's original format" },
                          { key: "text_overlay" as const, label: "Text overlay", hint: "Static visuals + on-screen text blocks" },
                          { key: "talking_head" as const, label: "Talking head", hint: "You speak to camera the whole reel" },
                          { key: "carousel" as const, label: "Carousel", hint: "Swipeable PNG slides (not a video)" },
                        ] as const
                      ).map(({ key, label, hint }) => {
                        const active = recreateFormat === key;
                        return (
                          <button
                            key={key}
                            type="button"
                            role="radio"
                            aria-checked={active}
                            title={hint}
                            onClick={() => setRecreateFormat(key)}
                            className={`rounded-xl border px-3 py-2 text-xs font-semibold transition-colors ${
                              active
                                ? "border-amber-500/50 bg-amber-500/10 text-app-fg"
                                : "border-app-divider bg-app-chip-bg/40 text-app-fg-muted hover:bg-app-chip-bg/70"
                            }`}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                    <p className="mt-2 text-[11px] leading-relaxed text-app-fg-muted">
                      {recreateFormat && recreateFormat !== "auto"
                        ? "We'll keep the source reel's idea + viewer payoff, but rebuild beats and on-screen language for this format."
                        : recreateFormat === "auto"
                        ? "We'll mirror the source reel's original production format."
                        : "Pick a target format — Auto keeps the source's, the others re-format the same idea."}
                    </p>
                  </div>

                  <div className="rounded-xl border border-app-divider bg-app-chip-bg/25 p-4">
                    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                      <div>
                        <p className="text-xs font-semibold text-app-fg">No URL handy? Quick picks</p>
                        <p className="mt-0.5 text-[11px] leading-relaxed text-app-fg-muted">
                          Top competitor reels by{" "}
                          <span className="text-app-fg-secondary">comments ÷ views</span> — tap to use one.
                        </p>
                      </div>
                      <Link
                        href="/intelligence/breakouts"
                        className="shrink-0 text-xs font-semibold text-amber-600 hover:underline dark:text-amber-400"
                      >
                        Browse breakouts →
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
                        No competitor reels yet. Sync in{" "}
                        <Link
                          href="/intelligence/reels"
                          className="font-semibold text-amber-600 hover:underline dark:text-amber-400"
                        >
                          Intelligence → Reels
                        </Link>
                        .
                      </p>
                    ) : (
                      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        {adaptPreviewRows.slice(0, 4).map((row) => {
                          const url = (row.post_url ?? "").trim();
                          const selected = url.length > 0 && composerInput.trim() === url;
                          return (
                            <li key={row.id}>
                              <button
                                type="button"
                                disabled={!url}
                                onClick={() => {
                                  if (url) setComposerInput(url);
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
                </>
              )}

              {/* Optional focus note — collapsed by default to keep the page calm */}
              {focusNoteOpen ? (
                <div>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <label htmlFor="gen-extra" className="text-sm font-semibold text-app-fg">
                      Focus note <span className="font-normal text-app-fg-muted">(optional)</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setExtraInstruction("");
                        setFocusNoteOpen(false);
                      }}
                      className="text-[11px] font-semibold text-app-fg-muted hover:text-app-fg"
                    >
                      Remove
                    </button>
                  </div>
                  <textarea
                    id="gen-extra"
                    rows={3}
                    value={extraInstruction}
                    onChange={(e) => setExtraInstruction(e.target.value)}
                    placeholder={'e.g. "Lean emotional, not tactical" or "Avoid mentioning money directly"'}
                    className="glass-inset min-h-[4.5rem] w-full resize-y rounded-xl p-3 text-sm leading-relaxed text-app-fg placeholder:text-app-fg-subtle focus:outline-none focus:ring-2 focus:ring-amber-500/35"
                  />
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setFocusNoteOpen(true)}
                  className="text-xs font-semibold text-amber-600 hover:underline dark:text-amber-400"
                >
                  + Add a focus note
                </button>
              )}

              {/* Generate */}
              <div className="flex flex-col items-end gap-2">
                <button
                  type="button"
                  disabled={loading || !clientSlug || (mode === "recreate" && !recreateFormat)}
                  onClick={() => void onStart()}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-bold text-zinc-950 shadow-md shadow-amber-900/20 transition-opacity hover:opacity-95 disabled:opacity-50"
                >
                  {loading ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Sparkles className="size-4" />
                  )}
                  {loading
                    ? "Running models…"
                    : mode === "recreate" && !recreateFormat
                    ? "Pick a target format"
                    : "Generate angles"}
                </button>
                {mode === "recreate" ? (
                  <p className="text-right text-xs text-app-fg-muted">
                    Reels are fetched and analyzed first — usually 30–60s.
                  </p>
                ) : !composerInput.trim() && formatPreset === "auto" ? (
                  <p className="text-right text-xs text-app-fg-muted">
                    Empty box = we propose a fresh idea from your niche, then five angles.
                  </p>
                ) : !composerInput.trim() ? (
                  <p className="text-right text-xs text-app-fg-muted">
                    Empty box + format chosen = we generate angles in that style only.
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
              In‑progress runs and finished posts for this client. Done posts show their cover and caption;
              click any row to reopen.
            </p>
            {sessions.length > 0 ? (
              <ul className="mt-4 flex max-h-[min(50vh,28rem)] flex-col gap-2 overflow-y-auto pr-1 md:max-h-[min(45vh,26rem)]">
                {sessions.map((s) => (
                  <SessionCard
                    key={s.id}
                    session={s}
                    loading={loading}
                    onOpen={() => void loadSessionById(s.id)}
                    onDelete={() => void onDeleteSession(s.id)}
                  />
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

      {!loadingFromUrl && step === "angles" && session && (
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
                    {blueprint ? <BlueprintBadge /> : null}
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


      {!loadingFromUrl && step === "create" && session && clientSlug && orgSlug && (
        <section className="space-y-5 pb-12">
          {/* compact header: nav back + 1-line angle title + format pill + delete */}
          <div className="flex flex-wrap items-center gap-3 border-b border-app-divider/60 pb-4">
            <button
              type="button"
              onClick={() => {
                setSession(null);
                setStep("source");
              }}
              className="text-xs font-semibold text-app-fg-muted hover:text-app-fg"
            >
              ← New session
            </button>
            {chosenAngle ? (
              <div className="min-w-0 flex-1 truncate text-sm">
                <span className="font-semibold text-app-fg">{str(chosenAngle.title)}</span>
                {chosenAngle.situation ? (
                  <span className="text-app-fg-muted"> — {str(chosenAngle.situation)}</span>
                ) : null}
              </div>
            ) : (
              <div className="min-w-0 flex-1" />
            )}
            <span className="shrink-0 rounded-full bg-violet-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-violet-300">
              {formatKeyLabel(canonicalFormatKey(session.source_format_key) || session.source_format_key || "—")}
            </span>
            <button
              type="button"
              disabled={loading}
              onClick={() => void onDeleteSession(session.id)}
              className="flex shrink-0 items-center gap-1.5 rounded-xl border border-red-500/30 px-3 py-1.5 text-[11px] font-bold text-red-400 hover:bg-red-500/10 disabled:opacity-40"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </button>
          </div>

          <VideoCreateWorkspace
            clientSlug={clientSlug}
            orgSlug={orgSlug}
            sessionId={session.id}
            onSessionUpdated={(s) => setSession(s)}
          />
        </section>
      )}
    </main>
  );
}
