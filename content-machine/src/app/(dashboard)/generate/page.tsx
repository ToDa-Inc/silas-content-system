"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Loader2, Sparkles, Trash2 } from "lucide-react";
import { ReelThumbnail } from "@/components/reel-thumbnail";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast-provider";
import { VideoCreateWorkspace } from "@/components/video-create-workspace";
import type { ClientCarouselTemplate, ClientCoverTemplate, ClientCta, ScrapedReelRow } from "@/lib/api";
import { formatCommentViewPct } from "@/lib/reel-comment-view";
import { generateSessionHref } from "@/lib/generate-session-url";
import {
  clientApiContext,
  CONTENT_DEFAULTS_UPDATED_AT_KEY,
  CONTENT_DEFAULTS_UPDATED_EVENT,
  fetchAdaptPreviewReels,
  fetchClientGenerationLibraries,
  fetchFormatDigests,
  fetchReelSourcePreview,
  generateAutoVideoIdea,
  generationChooseAngle,
  generationDeleteSession,
  generationGetSession,
  generationListSessions,
  generationStart,
  readClientGenerationLibrariesSnapshot,
  recommendFormatForIdea,
  type ClientGenerationLibraryBundle,
  type FormatDigestSummary,
  type GenerationSession,
} from "@/lib/api-client";
import { scrapedReelRowMatchesComposerUrl } from "@/lib/instagram-post-url";

type Step = "source" | "angles" | "create";

/** Top-level user intent: write something new vs. adapt an existing reel. Persisted in localStorage. */
type Mode = "idea" | "recreate";

const MODE_STORAGE_KEY = "silas:generate:mode";

/** Video format preset for idea / empty-composer flows (`auto` = pick from niche data or AI). */
type FormatPreset = "auto" | "text_overlay" | "talking_head" | "carousel";

/** Recreate-from-URL: explicit target format only (no Auto — avoids wrong backend routing). */
type RecreateFormatChoice = "text_overlay" | "talking_head" | "carousel";

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

const CTA_TYPE_LABEL: Record<string, string> = {
  website: "Website",
  newsletter: "Newsletter",
  video: "Video",
  lead_magnet: "Lead magnet",
  booking: "Booking",
  other: "Other",
};

/** Picker shown right under the format selector. The chosen next step is snapshotted
 *  onto the new generation session so caption, script, and on-screen text all
 *  adapt to the same destination. */
function CtaPicker({
  library,
  selectedId,
  onSelect,
}: {
  library: ClientCta[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-wider text-app-fg-subtle">
          Next step <span className="font-normal text-app-fg-muted">(required)</span>
        </p>
        <Link
          href="/settings#content-defaults"
          className="text-[11px] font-semibold text-amber-600 hover:underline dark:text-amber-400"
        >
          Edit next steps →
        </Link>
      </div>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="CTA">
        {library.map((cta) => {
          const active = selectedId === cta.id;
          const typeLabel = CTA_TYPE_LABEL[cta.type] ?? cta.type;
          return (
            <button
              key={cta.id}
              type="button"
              role="radio"
              aria-checked={active}
              title={
                cta.traffic_goal
                  ? `${typeLabel} · ${cta.traffic_goal}`
                  : typeLabel
              }
              onClick={() => onSelect(cta.id)}
              className={`rounded-xl border px-3 py-2 text-xs font-semibold transition-colors ${
                active
                  ? "border-amber-500/50 bg-amber-500/10 text-app-fg"
                  : "border-app-divider bg-app-chip-bg/40 text-app-fg-muted hover:bg-app-chip-bg/70"
              }`}
            >
              {cta.label}
              <span className="ml-1.5 font-normal text-app-fg-subtle">· {typeLabel}</span>
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-app-fg-muted">
        Caption, script, and on-screen text will adapt to this destination.
      </p>
    </div>
  );
}

function CtaPickerEmpty() {
  return (
    <div className="rounded-xl border border-dashed border-app-divider bg-app-chip-bg/20 p-3 text-[11px] leading-relaxed text-app-fg-muted">
      No next steps configured yet.{" "}
      <Link
        href="/settings#content-defaults"
        className="font-semibold text-amber-600 hover:underline dark:text-amber-400"
      >
        Add one in Settings
      </Link>{" "}
      so future posts know where to send viewers. We&apos;ll fall back to a generic ending otherwise.
    </div>
  );
}

function CarouselSlideCountPicker({
  value,
  onChange,
}: {
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <div>
      <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-app-fg-subtle">
        Slides in this carousel <span className="font-normal text-app-fg-muted">(3–10)</span>
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="range"
          min={3}
          max={10}
          step={1}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-44 max-w-full accent-amber-500"
          aria-label="Number of carousel slides"
        />
        <span className="min-w-[2ch] text-sm font-bold text-app-fg">{value}</span>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-app-fg-muted">
        We split your angle across this many slides. The style you pick below sets backgrounds and layout cues —
        not the slide count.
      </p>
    </div>
  );
}

function CarouselTemplatePicker({
  templates,
  selectedId,
  onSelect,
}: {
  templates: ClientCarouselTemplate[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-wider text-app-fg-subtle">
          Carousel style <span className="font-normal text-app-fg-muted">(required)</span>
        </p>
        <Link
          href="/settings#content-defaults"
          className="text-[11px] font-semibold text-amber-600 hover:underline dark:text-amber-400"
        >
          Edit styles →
        </Link>
      </div>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Carousel style">
        {templates.map((template) => {
          const active = selectedId === template.id;
          return (
            <button
              key={template.id}
              type="button"
              role="radio"
              aria-checked={active}
              title={template.description ?? undefined}
              onClick={() => onSelect(template.id)}
              className={`rounded-xl border px-3 py-2 text-xs font-semibold transition-colors ${
                active
                  ? "border-amber-500/50 bg-amber-500/10 text-app-fg"
                  : "border-app-divider bg-app-chip-bg/40 text-app-fg-muted hover:bg-app-chip-bg/70"
              }`}
            >
              {template.name}
              <span className="ml-1.5 font-normal text-app-fg-subtle">
                · {template.slides.length} ref. backgrounds
              </span>
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-app-fg-muted">
        Backgrounds and roles from your Media library — we cycle them if you generate more slides than references.
      </p>
    </div>
  );
}

function CarouselTemplatePickerEmpty() {
  return (
    <div className="rounded-xl border border-dashed border-app-divider bg-app-chip-bg/20 p-3 text-[11px] leading-relaxed text-app-fg-muted">
      No carousel styles configured yet.{" "}
      <Link
        href="/settings#content-defaults"
        className="font-semibold text-amber-600 hover:underline dark:text-amber-400"
      >
        Add one in Settings
      </Link>{" "}
      to reuse slide structures from example images.
    </div>
  );
}

function CoverTemplatePicker({
  templates,
  selectedId,
  onSelect,
}: {
  templates: ClientCoverTemplate[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-wider text-app-fg-subtle">
          Cover style <span className="font-normal text-app-fg-muted">(required)</span>
        </p>
        <Link
          href="/settings#content-defaults"
          className="text-[11px] font-semibold text-amber-600 hover:underline dark:text-amber-400"
        >
          Edit styles →
        </Link>
      </div>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Cover style">
        {templates.map((template) => {
          const active = selectedId === template.id;
          return (
            <button
              key={template.id}
              type="button"
              role="radio"
              aria-checked={active}
              title={template.instruction || template.reference_label || undefined}
              onClick={() => onSelect(template.id)}
              className={`rounded-xl border px-3 py-2 text-xs font-semibold transition-colors ${
                active
                  ? "border-amber-500/50 bg-amber-500/10 text-app-fg"
                  : "border-app-divider bg-app-chip-bg/40 text-app-fg-muted hover:bg-app-chip-bg/70"
              }`}
            >
              {template.name}
              <span className="ml-1.5 font-normal text-app-fg-subtle">
                · {template.reference_label ?? "1 image"}
              </span>
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-app-fg-muted">
        The cover workspace will start from this example image.
      </p>
    </div>
  );
}

function CoverTemplatePickerEmpty() {
  return (
    <div className="rounded-xl border border-dashed border-app-divider bg-app-chip-bg/20 p-3 text-[11px] leading-relaxed text-app-fg-muted">
      No cover styles configured yet.{" "}
      <Link
        href="/settings#content-defaults"
        className="font-semibold text-amber-600 hover:underline dark:text-amber-400"
      >
        Add one in Settings
      </Link>{" "}
      to reuse cover examples from Media.
    </div>
  );
}

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
  if (t === "format_pick") return "Format pick";
  if (t === "idea_match") return "New idea";
  if (t === "url_adapt") return "From a reel";
  if (t === "script_adapt") return "From a script";
  if (t === "patterns") return "From patterns";
  if (t === "outlier") return "From Intelligence";
  if (t === "manual") return "Custom";
  return t.replace(/_/g, " ");
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
  const normalized = key.trim().toLowerCase().replace(/_/g, " ");
  const friendly: Record<string, string> = {
    "text overlay": "Text on video",
    "talking head": "Talking head",
    carousel: "Carousel",
    "b roll reel": "B-roll style",
    "b roll": "B-roll style",
  };
  return friendly[normalized] ?? key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
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
        What was working in your niche when this run started. If a section is empty, refresh insights on the
        Source step and try again.
      </p>

      {formatInsights &&
      [
        formatInsights.dominant_type,
        formatInsights.optimal_duration,
        formatInsights.engagement_drivers,
      ].some((x) => typeof x === "string" && x.trim()) ? (
        <div className="rounded-xl border border-app-divider bg-app-chip-bg/40 p-4">
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-app-fg-subtle">
            Format insights
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
                <dt className="font-semibold text-app-fg-subtle">Typical length</dt>
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
        <>
          <p className="mt-2 truncate font-mono text-[11px] text-app-fg-secondary" title={u}>
            {u}
          </p>
          <p className="mt-1.5 text-xs">
            <a
              href={u}
              target="_blank"
              rel="noreferrer"
              className="font-semibold text-amber-600 underline-offset-2 hover:underline dark:text-amber-400"
            >
              Open original on Instagram ↗
            </a>
          </p>
        </>
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
  opening,
  onOpen,
  onDelete,
}: {
  session: GenerationSession;
  loading: boolean;
  opening: boolean;
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
          disabled={opening}
          aria-busy={opening}
          onClick={onOpen}
          className="glass relative min-w-0 flex-1 overflow-hidden rounded-xl border border-app-divider text-left transition-colors hover:bg-white/5 disabled:cursor-wait"
        >
          {opening ? (
            <span className="absolute inset-0 z-10 flex items-center justify-center gap-2 rounded-xl bg-zinc-950/65 text-xs font-semibold text-white backdrop-blur-[1px]">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Opening session…
            </span>
          ) : null}
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
          disabled={loading || opening}
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="shrink-0 self-stretch rounded-xl border border-red-500/30 px-3.5 text-red-400 transition-colors hover:bg-red-500/10 disabled:opacity-40"
        >
          <Trash2 className="mx-auto h-4 w-4 md:h-5 md:w-5" />
        </button>
      </div>
      {!isDone && sessionHasPackage(session) ? (
        <span className="self-end pr-12 text-[11px] font-semibold text-emerald-500 md:pr-14 dark:text-emerald-400">
          Video ready to open →
        </span>
      ) : null}
    </li>
  );
}

/**
 * Pill for the angle that stays closest to the source reel (structure + hook arc, rewritten for the client).
 */
function BlueprintBadge() {
  return (
    <span className="group relative inline-flex items-center gap-1">
      <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-300">
        Blueprint
      </span>
      <button
        type="button"
        aria-label="What's preserved and changed in the Blueprint angle"
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
          Default recreation: faithful 1-to-1 translation into German — same hook, story, examples, and
          structure as the source. Use <span className="font-medium text-zinc-200">Anpassen</span> only if
          you want to adapt it to your client&apos;s voice or ICP.
        </p>
        <div className="grid grid-cols-2 gap-x-3">
          <div>
            <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-300/80">
              Preserved (1:1)
            </p>
            <ul className="space-y-0.5 text-zinc-300">
              <li>Format &amp; beats</li>
              <li>Hook &amp; story</li>
              <li>Examples &amp; numbers</li>
              <li>CTA mechanism</li>
            </ul>
          </div>
          <div>
            <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300/80">
              Changed
            </p>
            <ul className="space-y-0.5 text-zinc-300">
              <li>Language → German</li>
              <li>Untranslatable names only</li>
              <li>Native German CTAs</li>
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
  const params = useParams<{ sessionId?: string | string[] }>();
  const searchParams = useSearchParams();
  const sessionIdFromPath = Array.isArray(params?.sessionId) ? params.sessionId[0] : params?.sessionId;
  const sessionIdFromQuery = searchParams.get("session");
  const sessionIdFromUrl = sessionIdFromPath ?? sessionIdFromQuery;
  const urlFromUrl = searchParams.get("url");
  const [step, setStep] = useState<Step>("source");
  /**
   * Suppresses the source/angles/create UI on the very first render when the page
   * was opened via `/generate/{sessionId}` (or legacy `/generate?session=…`).
   * Without this we render the composer for one frame before the session
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
  /** Target production format for "Recreate a reel" — required explicit choice. */
  const [recreateFormat, setRecreateFormat] = useState<RecreateFormatChoice | null>(null);
  /** "Recreate a reel" mode: strict 1:1 copy (skips angles) vs adapt into angles. Defaults to 1:1. */
  const [recreateMode, setRecreateMode] = useState<"one_to_one" | "adapt">("one_to_one");
  const [extraInstruction, setExtraInstruction] = useState("");
  const [focusNoteOpen, setFocusNoteOpen] = useState(false);
  const [formatDigests, setFormatDigests] = useState<FormatDigestSummary[]>([]);
  const [ctaLibrary, setCtaLibrary] = useState<ClientCta[]>([]);
  /** User-selected CTA for the next generation. Required only if the client has CTAs. */
  const [selectedCtaId, setSelectedCtaId] = useState<string | null>(null);
  const [carouselTemplates, setCarouselTemplates] = useState<ClientCarouselTemplate[]>([]);
  const [selectedCarouselTemplateId, setSelectedCarouselTemplateId] = useState<string | null>(null);
  const [coverTemplates, setCoverTemplates] = useState<ClientCoverTemplate[]>([]);
  const [selectedCoverTemplateId, setSelectedCoverTemplateId] = useState<string | null>(null);
  /** Target length for carousel output (3–10); style template is visual only. */
  const [carouselSlideCount, setCarouselSlideCount] = useState(6);
  /** Debounced niche inference when Format = Auto + idea text (drives template rows without triple-fetch). */
  const [autoFormatHint, setAutoFormatHint] = useState<string | null>(null);
  const [autoFormatHintLoading, setAutoFormatHintLoading] = useState(false);
  const [adaptPreviewRows, setAdaptPreviewRows] = useState<ScrapedReelRow[]>([]);
  const [adaptPreviewLoading, setAdaptPreviewLoading] = useState(false);
  const [adaptPreviewError, setAdaptPreviewError] = useState<string | null>(null);
  /** When pasted URL is not in quick picks, lazy-load scraped_reels row for cover thumbnail. */
  const [recreateSourcePreviewApi, setRecreateSourcePreviewApi] = useState<ScrapedReelRow | null>(null);
  const [recreateSourcePreviewLoading, setRecreateSourcePreviewLoading] = useState(false);
  const [session, setSession] = useState<GenerationSession | null>(null);
  const currentSessionIdRef = useRef<string | null>(null);
  const [sessions, setSessions] = useState<GenerationSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [openingSessionId, setOpeningSessionId] = useState<string | null>(null);
  const [deleteSessionId, setDeleteSessionId] = useState<string | null>(null);
  const [deleteSessionBusy, setDeleteSessionBusy] = useState(false);
  /** Index of angle being submitted (content generation); other angle cards stay visible but dimmed. */
  const [choosingAngleIndex, setChoosingAngleIndex] = useState<number | null>(null);
  /** Blueprint card: expanded Anpassen panel (angle index). */
  const [blueprintAnpassenIndex, setBlueprintAnpassenIndex] = useState<number | null>(null);
  const [blueprintAdaptInstruction, setBlueprintAdaptInstruction] = useState("");
  const [patternsOpen, setPatternsOpen] = useState(false);
  const [clientSlug, setClientSlug] = useState("");
  const [orgSlug, setOrgSlug] = useState("");

  const refreshSessions = useCallback(
    async (cs?: string, os?: string) => {
      const slug = (cs ?? clientSlug).trim();
      const org = (os ?? orgSlug).trim();
      if (!slug || !org) return null;
      const lr = await generationListSessions(slug, org, 15);
      if (lr.ok) {
        setSessions(lr.data);
        return lr.data;
      }
      show(lr.error, "error");
      return null;
    },
    [clientSlug, orgSlug, show],
  );

  const refreshContext = useCallback(async () => {
    const ctx = await clientApiContext();
    setClientSlug(ctx.clientSlug);
    setOrgSlug(ctx.orgSlug);
    return ctx;
  }, []);

  const applyGenerationLibraries = useCallback((bundle: ClientGenerationLibraryBundle) => {
    const { ctaLibrary: ctas, carouselTemplates: carousels, coverTemplates: covers } = bundle;
    setCtaLibrary(ctas);
    setSelectedCtaId((current) => {
      if (current && ctas.some((cta) => cta.id === current)) return current;
      return ctas.length === 1 ? ctas[0].id : null;
    });
    setCarouselTemplates(carousels);
    setSelectedCarouselTemplateId((current) => {
      if (current && carousels.some((template) => template.id === current)) return current;
      return carousels.length === 1 ? carousels[0].id : null;
    });
    setCoverTemplates(covers);
    setSelectedCoverTemplateId((current) => {
      if (current && covers.some((template) => template.id === current)) return current;
      return covers.length === 1 ? covers[0].id : null;
    });
  }, []);

  const refreshGenerationLibraries = useCallback(async (cs: string, os: string) => {
    if (!cs || !os) return;
    const libsRes = await fetchClientGenerationLibraries(cs, os);
    if (!libsRes.ok) {
      show(libsRes.error, "error");
      return;
    }
    applyGenerationLibraries(libsRes.data);
  }, [applyGenerationLibraries, show]);

  useEffect(() => {
    currentSessionIdRef.current = session?.id ?? null;
  }, [session?.id]);

  useEffect(() => {
    if (!loadingFromUrl) setOpeningSessionId(null);
  }, [loadingFromUrl]);

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
      else show(listRes.error, "error");
      if (digRes.ok) {
        setFormatDigests(digRes.data);
      } else {
        show(digRes.error, "error");
      }
      await refreshGenerationLibraries(ctx.clientSlug, ctx.orgSlug);
    })();
  }, [refreshContext, refreshGenerationLibraries, show]);

  useEffect(() => {
    if (!clientSlug || !orgSlug) return;

    const refresh = (event?: Event) => {
      if (event instanceof CustomEvent && event.detail) {
        applyGenerationLibraries(event.detail as ClientGenerationLibraryBundle);
        return;
      }
      const snapshot = readClientGenerationLibrariesSnapshot();
      if (snapshot) applyGenerationLibraries(snapshot);
      void refreshGenerationLibraries(clientSlug, orgSlug);
    };
    const refreshOnVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };

    window.addEventListener(CONTENT_DEFAULTS_UPDATED_EVENT, refresh);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refreshOnVisible);
    return () => {
      window.removeEventListener(CONTENT_DEFAULTS_UPDATED_EVENT, refresh);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refreshOnVisible);
    };
  }, [applyGenerationLibraries, clientSlug, orgSlug, refreshGenerationLibraries]);

  useEffect(() => {
    if (!clientSlug || !orgSlug) return;
    const updatedAt = window.localStorage.getItem(CONTENT_DEFAULTS_UPDATED_AT_KEY);
    if (updatedAt) {
      const snapshot = readClientGenerationLibrariesSnapshot();
      if (snapshot) applyGenerationLibraries(snapshot);
      void refreshGenerationLibraries(clientSlug, orgSlug);
    }
  }, [applyGenerationLibraries, clientSlug, orgSlug, refreshGenerationLibraries]);

  /** When Format = Auto and the user typed enough idea text, infer format once for template UI (matches submit-time recommend). */
  useEffect(() => {
    if (mode !== "idea" || formatPreset !== "auto") {
      setAutoFormatHint(null);
      setAutoFormatHintLoading(false);
      return;
    }
    const trimmed = composerInput.trim();
    if (trimmed.length < 8) {
      setAutoFormatHint(null);
      setAutoFormatHintLoading(false);
      return;
    }
    if (!clientSlug.trim() || !orgSlug.trim()) {
      return;
    }
    let cancelled = false;
    setAutoFormatHintLoading(true);
    const t = window.setTimeout(() => {
      void (async () => {
        const res = await recommendFormatForIdea(clientSlug, orgSlug, trimmed);
        if (cancelled) return;
        setAutoFormatHintLoading(false);
        if (!res.ok) {
          setAutoFormatHint(null);
          return;
        }
        const first = res.data[0]?.format_key;
        const canon = first ? canonicalFormatKey(String(first)) : "";
        setAutoFormatHint(ALLOWED_VIDEO_FORMATS.has(canon) ? canon : "text_overlay");
      })();
    }, 520);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [mode, formatPreset, composerInput, clientSlug, orgSlug]);

  const ideaShowsCarouselTemplateRow = useMemo(() => {
    if (mode !== "idea") return false;
    if (formatPreset === "carousel") return true;
    return (
      formatPreset === "auto" &&
      composerInput.trim().length >= 8 &&
      autoFormatHint === "carousel"
    );
  }, [mode, formatPreset, composerInput, autoFormatHint]);

  const ideaShowsCoverTemplateRow = useMemo(() => {
    if (mode !== "idea") return false;
    if (formatPreset === "talking_head" || formatPreset === "text_overlay") return true;
    if (formatPreset !== "auto") return false;
    return (
      composerInput.trim().length >= 8 &&
      autoFormatHint !== null &&
      autoFormatHint !== "carousel"
    );
  }, [mode, formatPreset, composerInput, autoFormatHint]);

  /** Show carousel length control whenever the user is generating a carousel (idea or recreate). */
  const showCarouselSlideCountRow = useMemo(() => {
    if (mode === "recreate") return recreateFormat === "carousel";
    if (mode !== "idea") return false;
    if (formatPreset === "carousel") return true;
    return formatPreset === "auto" && composerInput.trim().length >= 8 && autoFormatHint === "carousel";
  }, [mode, formatPreset, composerInput, autoFormatHint, recreateFormat]);

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

  const recreatePreviewFromQuickPicks = useMemo(() => {
    if (mode !== "recreate") return null;
    const raw = composerInput.trim();
    if (!raw || !isLikelyInstagramReelUrl(raw)) return null;
    return adaptPreviewRows.find((r) => scrapedReelRowMatchesComposerUrl(r, raw)) ?? null;
  }, [mode, composerInput, adaptPreviewRows]);

  useEffect(() => {
    if (mode !== "recreate" || step !== "source") {
      setRecreateSourcePreviewApi(null);
      setRecreateSourcePreviewLoading(false);
      return;
    }
    const raw = composerInput.trim();
    if (!raw || !isLikelyInstagramReelUrl(raw)) {
      setRecreateSourcePreviewApi(null);
      setRecreateSourcePreviewLoading(false);
      return;
    }
    if (recreatePreviewFromQuickPicks) {
      setRecreateSourcePreviewApi(null);
      setRecreateSourcePreviewLoading(false);
      return;
    }
    if (!clientSlug.trim() || !orgSlug.trim()) {
      setRecreateSourcePreviewApi(null);
      setRecreateSourcePreviewLoading(false);
      return;
    }
    let cancelled = false;
    setRecreateSourcePreviewApi(null);
    const t = window.setTimeout(() => {
      if (cancelled) return;
      setRecreateSourcePreviewLoading(true);
      void fetchReelSourcePreview(clientSlug, orgSlug, raw).then((res) => {
        if (cancelled) return;
        setRecreateSourcePreviewLoading(false);
        if (res.ok) setRecreateSourcePreviewApi(res.data);
        else setRecreateSourcePreviewApi(null);
      });
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
      setRecreateSourcePreviewLoading(false);
    };
  }, [mode, step, composerInput, clientSlug, orgSlug, recreatePreviewFromQuickPicks]);

  const recreateSourcePreviewRow = useMemo(
    () => recreatePreviewFromQuickPicks ?? recreateSourcePreviewApi,
    [recreatePreviewFromQuickPicks, recreateSourcePreviewApi],
  );

  /** Open session from Intelligence "Recreate" flow, /media cards, or the Recent
   *  sessions panel (`/generate/{sessionId}`). While this effect is in flight we
   *  hide the composer/angles UI behind a `loadingFromUrl` gate so the user
   *  doesn't see a flash of the wrong step. */
  useEffect(() => {
    const raw = sessionIdFromUrl?.trim();
    if (!raw) {
      setLoadingFromUrl(false);
      return;
    }
    setLoadingFromUrl(true);
    if (currentSessionIdRef.current === raw) {
      setLoadingFromUrl(false);
      if (!sessionIdFromPath) {
        router.replace(generateSessionHref(raw), { scroll: false });
      }
      return;
    }
    let cancelled = false;
    void (async () => {
      const ctx = await clientApiContext();
      if (cancelled) return;
      const cs = ctx.clientSlug.trim();
      const os = ctx.orgSlug.trim();
      if (!cs || !os) {
        setLoadingFromUrl(false);
        show("No active creator — pick one in the sidebar.", "error");
        return;
      }
      setClientSlug(cs);
      setOrgSlug(os);
      const res = await generationGetSession(cs, os, raw);
      if (cancelled) return;
      if (!res.ok) {
        setLoadingFromUrl(false);
        show(res.error, "error");
        router.replace("/generate", { scroll: false });
        return;
      }
      currentSessionIdRef.current = res.data.id;
      setSession(res.data);
      if (sessionHasPackage(res.data)) {
        setStep("create");
      } else {
        setStep("angles");
      }
      await refreshSessions(cs, os);
      setLoadingFromUrl(false);
      if (!sessionIdFromPath) {
        router.replace(generateSessionHref(raw), { scroll: false });
      }
      show("Session loaded.", "success");
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionIdFromPath, sessionIdFromUrl, router, show, refreshSessions]);

  const requestDeleteSession = useCallback((id: string) => {
    setDeleteSessionId(id);
  }, []);

  const executeDeleteSession = useCallback(async () => {
    const id = deleteSessionId;
    if (!id || !clientSlug || !orgSlug) return;
    setDeleteSessionBusy(true);
    try {
      const res = await generationDeleteSession(clientSlug, orgSlug, id);
      if (!res.ok) {
        show(res.error, "error");
        return;
      }
      show("Session deleted.", "success");
      setDeleteSessionId(null);
      if (session?.id === id) {
        currentSessionIdRef.current = null;
        setSession(null);
        setStep("source");
        router.push("/generate", { scroll: false });
      }
      await refreshSessions();
    } finally {
      setDeleteSessionBusy(false);
    }
  }, [clientSlug, orgSlug, deleteSessionId, refreshSessions, router, session?.id, show]);

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
    if (ctaLibrary.length > 0 && !selectedCtaId) {
      show("Pick a next step below the format selector first.", "error");
      return;
    }
    const selectedCta =
      selectedCtaId !== null ? (ctaLibrary.find((c) => c.id === selectedCtaId) ?? null) : null;
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
        if (
          recreateFormat === "carousel" &&
          carouselTemplates.length > 0 &&
          !selectedCarouselTemplateId
        ) {
          show("Pick a carousel template below first.", "error");
          return;
        }
        if (
          recreateFormat !== "carousel" &&
          coverTemplates.length > 0 &&
          !selectedCoverTemplateId
        ) {
          show("Pick a cover template below first.", "error");
          return;
        }
        body = {
          source_type: "url_adapt",
          url: raw,
          recreate_mode: recreateMode,
          // Strict 1:1 copies the original on-screen text verbatim (just translated),
          // so extra focus only applies when adapting into angles.
          extra_instruction: recreateMode === "adapt" ? extra : undefined,
          format_key: recreateFormat,
        };
      } else if (raw.length > 0) {
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
        if (fk === "carousel" && carouselTemplates.length > 0 && !selectedCarouselTemplateId) {
          show("Pick a carousel style below first.", "error");
          return;
        }
        if (fk !== "carousel" && coverTemplates.length > 0 && !selectedCoverTemplateId) {
          show("Pick a cover template below first.", "error");
          return;
        }
        body = {
          source_type: "idea_match",
          format_key: fk,
          idea_text: raw,
          extra_instruction: extra,
        };
      } else if (formatPreset !== "auto") {
        if (
          formatPreset === "carousel" &&
          carouselTemplates.length > 0 &&
          !selectedCarouselTemplateId
        ) {
          show("Pick a carousel style below first.", "error");
          return;
        }
        if (
          formatPreset !== "carousel" &&
          coverTemplates.length > 0 &&
          !selectedCoverTemplateId
        ) {
          show("Pick a cover template below first.", "error");
          return;
        }
        body = {
          source_type: "format_pick",
          format_key: formatPreset,
          extra_instruction: extra,
        };
      } else {
        const ideaRes = await generateAutoVideoIdea(ctx.clientSlug, ctx.orgSlug);
        if (!ideaRes.ok) {
          show(ideaRes.error, "error");
          return;
        }
        let fk = canonicalFormatKey(ideaRes.data.suggested_format_key);
        if (!ALLOWED_VIDEO_FORMATS.has(fk)) fk = "text_overlay";

        if (fk === "carousel" && carouselTemplates.length > 0 && !selectedCarouselTemplateId) {
          setComposerInput(ideaRes.data.idea.trim());
          setFormatPreset("carousel");
          show(
            "Auto chose Carousel — pick a carousel style below, then Generate angles again.",
            "default",
          );
          return;
        }
        if (fk !== "carousel" && coverTemplates.length > 0 && !selectedCoverTemplateId) {
          setComposerInput(ideaRes.data.idea.trim());
          setFormatPreset(fk === "talking_head" ? "talking_head" : "text_overlay");
          show(
            "Auto chose this format — pick a cover template below, then Generate angles again.",
            "default",
          );
          return;
        }
        body = {
          source_type: "idea_match",
          format_key: fk,
          idea_text: ideaRes.data.idea.trim(),
          extra_instruction: extra,
        };
      }

      if (selectedCta) {
        body = { ...body, selected_cta: selectedCta };
      }

      const fkForSnap =
        "format_key" in body && typeof body.format_key === "string" ? body.format_key : "";
      const startsCarousel = fkForSnap === "carousel";
      const needsCoverSnapshot = Boolean(fkForSnap && fkForSnap !== "carousel");

      if (startsCarousel && selectedCarouselTemplateId) {
        const selectedTemplate =
          carouselTemplates.find((template) => template.id === selectedCarouselTemplateId) ??
          null;
        if (selectedTemplate) {
          body = { ...body, selected_carousel_template: selectedTemplate };
        }
      }
      if (needsCoverSnapshot && selectedCoverTemplateId) {
        const selectedTemplate =
          coverTemplates.find((template) => template.id === selectedCoverTemplateId) ?? null;
        if (selectedTemplate) {
          body = { ...body, selected_cover_template: selectedTemplate };
        }
      }

      if (startsCarousel) {
        body = { ...body, carousel_slide_count: carouselSlideCount };
      }

      const res = await generationStart(ctx.clientSlug, ctx.orgSlug, body);
      if (!res.ok) {
        show(res.error, "error");
        return;
      }
      currentSessionIdRef.current = res.data.id;
      setSession(res.data);
      // 1:1 recreate packages content on /start (no angles), so land directly in the studio.
      const landedWithPackage = sessionHasPackage(res.data);
      setStep(landedWithPackage ? "create" : "angles");
      router.replace(generateSessionHref(res.data.id), { scroll: false });
      show(landedWithPackage ? "1:1 copy ready." : "Angles ready — pick one.", "success");
      const lr = await generationListSessions(ctx.clientSlug, ctx.orgSlug, 15);
      if (lr.ok) setSessions(lr.data);
    } finally {
      setLoading(false);
    }
  }, [
    composerInput,
    carouselTemplates,
    coverTemplates,
    ctaLibrary,
    extraInstruction,
    formatPreset,
    mode,
    recreateFormat,
    recreateMode,
    refreshContext,
    router,
    selectedCtaId,
    selectedCarouselTemplateId,
    selectedCoverTemplateId,
    show,
    carouselSlideCount,
  ]);

  const onChooseAngle = useCallback(
    async (index: number, extraInstruction?: string) => {
      if (!session || !clientSlug || !orgSlug) return;
      setChoosingAngleIndex(index);
      setBlueprintAnpassenIndex(null);
      try {
        const trimmed = extraInstruction?.trim();
        const res = await generationChooseAngle(
          clientSlug,
          orgSlug,
          session.id,
          index,
          trimmed ? { extra_instruction: trimmed } : undefined,
        );
        if (!res.ok) {
          show(res.error, "error");
          return;
        }
        setSession(res.data);
        setStep("create");
        const fk = canonicalFormatKey(res.data.source_format_key ?? "");
        show(
          fk === "carousel" ? "Carousel slides and caption ready." : "Script and captions generated.",
          "success",
        );
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

  const openSessionById = useCallback(
    (id: string) => {
      const raw = id.trim();
      if (!raw) return;
      setOpeningSessionId(raw);
      setLoadingFromUrl(true);
      router.push(generateSessionHref(raw), { scroll: false });
    },
    [router],
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
          Create
        </span>
        <h1 className="mb-2 max-w-2xl text-lg font-semibold text-app-fg">New reel, cover or carousel</h1>
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
                    {formatPreset === "auto" && composerInput.trim().length >= 8 ? (
                      <p className="mt-1 text-[11px] text-app-fg-subtle">
                        {autoFormatHintLoading
                          ? "Inferring format from your niche…"
                          : autoFormatHint
                            ? `Auto preview → ${autoFormatHint.replace(/_/g, " ")}`
                            : null}
                      </p>
                    ) : null}
                  </div>

                  {showCarouselSlideCountRow ? (
                    <CarouselSlideCountPicker
                      value={carouselSlideCount}
                      onChange={setCarouselSlideCount}
                    />
                  ) : null}

                  {ideaShowsCarouselTemplateRow ? (
                    carouselTemplates.length > 0 ? (
                      <CarouselTemplatePicker
                        templates={carouselTemplates}
                        selectedId={selectedCarouselTemplateId}
                        onSelect={setSelectedCarouselTemplateId}
                      />
                    ) : (
                      <CarouselTemplatePickerEmpty />
                    )
                  ) : ideaShowsCoverTemplateRow ? (
                    coverTemplates.length > 0 ? (
                      <CoverTemplatePicker
                        templates={coverTemplates}
                        selectedId={selectedCoverTemplateId}
                        onSelect={setSelectedCoverTemplateId}
                      />
                    ) : (
                      <CoverTemplatePickerEmpty />
                    )
                  ) : null}

                  {ctaLibrary.length > 0 ? (
                    <CtaPicker
                      library={ctaLibrary}
                      selectedId={selectedCtaId}
                      onSelect={setSelectedCtaId}
                    />
                  ) : (
                    <CtaPickerEmpty />
                  )}
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
                        {recreateMode === "one_to_one" ? (
                          <>
                            We&apos;ll read the reel&apos;s on-screen text and recreate it{" "}
                            <span className="font-medium text-app-fg-secondary">1:1</span>, translated to your
                            client&apos;s language — no angle questions.
                          </>
                        ) : (
                          <>
                            We&apos;ll study the reel, pull out what worked, then suggest a{" "}
                            <span className="font-medium text-app-fg-secondary">Blueprint</span> angle (same
                            structure and idea, your client&apos;s voice) plus variants in the format you pick below.
                          </>
                        )}
                      </p>
                    )}
                    {composerInput.trim() && isLikelyInstagramReelUrl(composerInput.trim()) ? (
                      <>
                        {recreateSourcePreviewRow ? (
                          <div className="mt-3 flex gap-3 rounded-xl border border-app-divider bg-app-chip-bg/20 p-3">
                            <ReelThumbnail
                              src={recreateSourcePreviewRow.thumbnail_url}
                              href={composerInput.trim()}
                              size="lg"
                              alt={
                                recreateSourcePreviewRow.account_username
                                  ? `@${recreateSourcePreviewRow.account_username} reel cover`
                                  : "Reel cover"
                              }
                            />
                            <div className="min-w-0 flex-1">
                              <p className="text-[10px] font-bold uppercase tracking-wider text-app-fg-subtle">
                                Source preview
                              </p>
                              {recreateSourcePreviewRow.account_username ? (
                                <p className="mt-0.5 text-xs font-semibold text-app-fg">
                                  @{recreateSourcePreviewRow.account_username}
                                </p>
                              ) : null}
                              <p className="mt-1 line-clamp-3 text-[11px] leading-snug text-app-fg-secondary">
                                {(recreateSourcePreviewRow.hook_text || recreateSourcePreviewRow.caption || "")
                                  .trim()
                                  .slice(0, 180) ||
                                  "Cover from your workspace — tap the image to open on Instagram."}
                              </p>
                              <p className="mt-1.5 text-[10px] leading-relaxed text-app-fg-subtle">
                                Inline Instagram playback isn&apos;t available here; the cover + link confirm
                                you picked the right reel.
                              </p>
                            </div>
                          </div>
                        ) : recreateSourcePreviewLoading ? (
                          <div className="mt-3 flex items-center gap-2 text-[11px] text-app-fg-muted">
                            <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
                            Looking up cover in your workspace…
                          </div>
                        ) : (
                          <p className="mt-3 text-[11px] leading-relaxed text-app-fg-muted">
                            No saved cover for this URL yet. You can analyze it under{" "}
                            <Link
                              href="/intelligence/reels"
                              className="font-semibold text-amber-600 hover:underline dark:text-amber-400"
                            >
                              Intelligence → Reels
                            </Link>
                            , or continue here — we&apos;ll load the reel when you generate.
                          </p>
                        )}
                      </>
                    ) : null}
                  </div>

                  <div>
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-app-fg-subtle">
                      How should we recreate it?
                    </p>
                    <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Recreation mode">
                      {(
                        [
                          { key: "one_to_one" as const, label: "1:1 copy", hint: "Copy the original on-screen text exactly, just translated. Skips angle selection." },
                          { key: "adapt" as const, label: "Adapt", hint: "Rework the idea into new angles for your client. You'll pick an angle next." },
                        ]
                      ).map(({ key, label, hint }) => {
                        const active = recreateMode === key;
                        return (
                          <button
                            key={key}
                            type="button"
                            role="radio"
                            aria-checked={active}
                            title={hint}
                            onClick={() => setRecreateMode(key)}
                            className={`rounded-xl border px-3 py-2 text-left text-xs font-semibold transition-colors ${
                              active
                                ? "border-amber-500/55 bg-amber-500/10 text-app-fg"
                                : "border-app-divider bg-app-chip-bg/20 text-app-fg-muted hover:border-amber-500/30"
                            }`}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                    <p className="mt-2 text-[11px] leading-relaxed text-app-fg-muted">
                      {recreateMode === "one_to_one"
                        ? "Faithful recreation: the same on-screen text as the original, translated to your client's language. No angle questions — straight to the studio."
                        : "Reframe the source idea into angle options tailored to your client."}
                    </p>
                  </div>

                  <div>
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-app-fg-subtle">
                      Recreate as <span className="font-normal text-app-fg-muted">(required)</span>
                    </p>
                    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Target format">
                      {(
                        [
                          { key: "text_overlay" as const, label: "Text overlay", hint: "Static visuals + on-screen text blocks" },
                          { key: "talking_head" as const, label: "Talking head", hint: "You speak to camera the whole reel" },
                          { key: "carousel" as const, label: "Carousel", hint: "Swipeable image slides (Instagram carousel)" },
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
                      {recreateFormat
                        ? "We keep the original idea and payoff, and rewrite beats and on-screen text for the format you chose."
                        : "Choose the kind of post you want to create — text on video, talking head, or carousel."}
                    </p>
                  </div>

                  {showCarouselSlideCountRow ? (
                    <CarouselSlideCountPicker
                      value={carouselSlideCount}
                      onChange={setCarouselSlideCount}
                    />
                  ) : null}

                  {recreateFormat === "carousel" ? (
                    carouselTemplates.length > 0 ? (
                      <CarouselTemplatePicker
                        templates={carouselTemplates}
                        selectedId={selectedCarouselTemplateId}
                        onSelect={setSelectedCarouselTemplateId}
                      />
                    ) : (
                      <CarouselTemplatePickerEmpty />
                    )
                  ) : recreateFormat ? (
                    coverTemplates.length > 0 ? (
                      <CoverTemplatePicker
                        templates={coverTemplates}
                        selectedId={selectedCoverTemplateId}
                        onSelect={setSelectedCoverTemplateId}
                      />
                    ) : (
                      <CoverTemplatePickerEmpty />
                    )
                  ) : null}

                  {ctaLibrary.length > 0 ? (
                    <CtaPicker
                      library={ctaLibrary}
                      selectedId={selectedCtaId}
                      onSelect={setSelectedCtaId}
                    />
                  ) : (
                    <CtaPickerEmpty />
                  )}

                  <div className="rounded-xl border border-app-divider bg-app-chip-bg/25 p-4">
                    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                      <div>
                        <p className="text-xs font-semibold text-app-fg">No URL handy? Quick picks</p>
                        <p className="mt-0.5 text-[11px] leading-relaxed text-app-fg-muted">
                          Top competitor reels by{" "}
                          <span className="text-app-fg-secondary">C/V</span> — tap to use one.
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
                        No competitor reels yet. Refresh data in{" "}
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

              {/* Optional focus note — collapsed by default to keep the page calm.
                  Hidden for strict 1:1 recreation since on-screen text is copied verbatim. */}
              {mode === "recreate" && recreateMode === "one_to_one" ? null : focusNoteOpen ? (
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
                    ? mode === "recreate" && recreateMode === "one_to_one"
                      ? "Creating 1:1 copy…"
                      : "Preparing angles…"
                    : mode === "recreate" && !recreateFormat
                    ? "Pick a target format"
                    : mode === "recreate" && recreateMode === "one_to_one"
                    ? "Create 1:1 copy"
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
                    opening={openingSessionId === s.id}
                    onOpen={() => openSessionById(s.id)}
                    onDelete={() => requestDeleteSession(s.id)}
                  />
                ))}
              </ul>
            ) : (
              <p className="mt-4 text-sm text-app-fg-muted">
                {clientSlug ? (
                  <>
                    No sessions for <span className="font-semibold text-app-fg">{clientSlug}</span> yet —
                    generate angles above to start. Past runs are per creator: if you expected older work,
                    switch creator in the sidebar (e.g. another slug in this org).
                  </>
                ) : (
                  <>
                    No sessions yet — generate angles above to start. Past runs will appear here with status
                    and format.
                  </>
                )}
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
                currentSessionIdRef.current = null;
                setStep("source");
                setSession(null);
                router.push("/generate", { scroll: false });
              }}
              className="text-xs font-semibold text-app-fg-muted hover:text-app-fg"
            >
              ← New session
            </button>
            {session.synthesized_patterns && (
              <button
                type="button"
                title="What we learned when you started this session — hooks, summaries, and patterns."
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
              The <span className="font-semibold text-app-fg-secondary">first angle</span> recreates the
              source 1-to-1 in German — same hook, story, and structure. Use{" "}
              <span className="font-semibold text-app-fg-secondary">Anpassen</span> only if you want it
              adapted to your client&apos;s voice. Other angles are same-format variants with a twist.
            </p>
          ) : null}
          <div className="grid gap-3 md:grid-cols-2">
            {angles.map((raw, i) => {
              const choosing = choosingAngleIndex !== null;
              const isPicked = choosingAngleIndex === i;
              const dimSibling = choosing && !isPicked;
              const blueprint = angleIsBlueprint(raw, i, session);
              const blueprintRecreateUi =
                blueprint && sessionUsesBlueprintFirstAngle(session);
              const anpassenOpen = blueprintAnpassenIndex === i;
              return (
                <div
                  key={i}
                  className={`glass flex flex-col gap-2 rounded-2xl p-5 transition-opacity ${
                    dimSibling ? "pointer-events-none opacity-40" : ""
                  } ${isPicked && choosing ? "ring-2 ring-amber-500/45" : ""} ${
                    blueprintRecreateUi ? "ring-1 ring-emerald-500/25" : ""
                  }`}
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
                  {blueprintRecreateUi ? (
                    <div className="mt-2 flex flex-col gap-2">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={choosing}
                          onClick={() => void onChooseAngle(i)}
                          className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-emerald-500/20 py-2 text-xs font-bold text-emerald-200 hover:bg-emerald-500/30 disabled:opacity-70 min-w-[8rem]"
                        >
                          {isPicked && choosing && !anpassenOpen ? (
                            <>
                              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
                              Generating…
                            </>
                          ) : (
                            "1:1 auf Deutsch"
                          )}
                        </button>
                        <button
                          type="button"
                          disabled={choosing}
                          onClick={() =>
                            setBlueprintAnpassenIndex((prev) => (prev === i ? null : i))
                          }
                          className="inline-flex items-center justify-center rounded-lg border border-app-divider bg-app-surface/40 px-3 py-2 text-xs font-semibold text-app-fg-muted hover:bg-app-surface/70 hover:text-app-fg disabled:opacity-70"
                        >
                          {anpassenOpen ? "Anpassen ▲" : "Anpassen"}
                        </button>
                      </div>
                      {anpassenOpen ? (
                        <div className="flex flex-col gap-2 rounded-xl border border-app-divider/80 bg-app-surface/30 p-3">
                          <label className="text-[11px] font-medium text-app-fg-muted">
                            Was möchtest du anpassen?
                          </label>
                          <textarea
                            value={blueprintAdaptInstruction}
                            onChange={(e) => setBlueprintAdaptInstruction(e.target.value)}
                            placeholder="z. B. stärker auf Führungskräfte im Mittelstand ausrichten, CTA auf Lead-Magnet X…"
                            rows={3}
                            className="w-full resize-y rounded-lg border border-app-divider bg-app-bg/60 px-3 py-2 text-xs text-app-fg placeholder:text-app-fg-subtle focus:outline-none focus:ring-1 focus:ring-amber-500/40"
                          />
                          <button
                            type="button"
                            disabled={choosing || !blueprintAdaptInstruction.trim()}
                            onClick={() => void onChooseAngle(i, blueprintAdaptInstruction)}
                            className="inline-flex items-center justify-center gap-2 rounded-lg bg-amber-500/15 py-2 text-xs font-bold text-app-on-amber-title hover:bg-amber-500/25 disabled:opacity-50"
                          >
                            {isPicked && choosing ? (
                              <>
                                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
                                Generating…
                              </>
                            ) : (
                              "Mit Anpassungen generieren"
                            )}
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ) : (
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
                  )}
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
                currentSessionIdRef.current = null;
                setSession(null);
                setStep("source");
                router.push("/generate", { scroll: false });
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
              onClick={() => requestDeleteSession(session.id)}
              className="flex shrink-0 items-center gap-1.5 rounded-xl border border-red-500/30 px-3 py-1.5 text-[11px] font-bold text-red-400 hover:bg-red-500/10 disabled:opacity-40"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
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

          <VideoCreateWorkspace
            clientSlug={clientSlug}
            orgSlug={orgSlug}
            sessionId={session.id}
            onSessionUpdated={(s) => {
              currentSessionIdRef.current = s.id;
              setSession(s);
            }}
          />
        </section>
      )}
      <ConfirmDialog
        open={deleteSessionId != null}
        onClose={() => {
          if (!deleteSessionBusy) setDeleteSessionId(null);
        }}
        title="Delete this session?"
        description="Removes this generation session and its saved progress. This cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="danger"
        busy={deleteSessionBusy}
        onConfirm={executeDeleteSession}
      />
    </main>
  );
}
