"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Copy,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Trash2,
} from "lucide-react";
import { useToast } from "@/components/ui/toast-provider";
import {
  clientApiContext,
  fetchReelAnalysesList,
  generationChooseAngle,
  generationDeleteSession,
  generationGetSession,
  generationListSessions,
  generationRegenerate,
  generationSetStatus,
  generationStart,
  type GenerationSession,
  type ReelAnalysisListRow,
} from "@/lib/api-client";

type Step = "source" | "angles" | "content";

type SourceMode = "patterns" | "outlier" | "manual";

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
  if (t === "patterns") return "Patterns";
  if (t === "outlier") return "Selected";
  if (t === "manual") return "Manual";
  return t;
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

  return (
    <div className="max-h-[28rem] space-y-4 overflow-y-auto pr-1">
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

const TIER_GROUPS: { tier: 1 | 2 | 3; title: string; subtitle: string }[] = [
  { tier: 1, title: "Tier 1 — Direct relatable question", subtitle: "Opens with a question the viewer feels." },
  { tier: 2, title: "Tier 2 — Tension / insight", subtitle: "Contrast, stakes, or a sharp insight." },
  { tier: 3, title: "Tier 3 — Concrete script / list", subtitle: "Specific lines, lists, or say-this-out-loud hooks." },
];

export default function GeneratePage() {
  const { show } = useToast();
  const [step, setStep] = useState<Step>("source");
  const [sourceMode, setSourceMode] = useState<SourceMode>("patterns");
  const [extraInstruction, setExtraInstruction] = useState("");
  const [analyses, setAnalyses] = useState<ReelAnalysisListRow[]>([]);
  const [selectedAnalysisIds, setSelectedAnalysisIds] = useState<Set<string>>(() => new Set());
  const [session, setSession] = useState<GenerationSession | null>(null);
  const [sessions, setSessions] = useState<GenerationSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingList, setLoadingList] = useState(false);
  const [patternsOpen, setPatternsOpen] = useState(false);
  const [clientSlug, setClientSlug] = useState("");
  const [orgSlug, setOrgSlug] = useState("");
  const [regenScope, setRegenScope] = useState<"all" | "hooks" | "script" | "caption" | "story">("all");
  const [regenFeedback, setRegenFeedback] = useState("");
  const [analysisSearch, setAnalysisSearch] = useState("");
  const [competitorFilter, setCompetitorFilter] = useState<string | null>(null);

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

  useEffect(() => {
    void (async () => {
      const ctx = await refreshContext();
      if (!ctx.clientSlug || !ctx.orgSlug) return;
      setLoadingList(true);
      try {
        const [listRes, anaRes] = await Promise.all([
          generationListSessions(ctx.clientSlug, ctx.orgSlug, 15),
          fetchReelAnalysesList(ctx.clientSlug, ctx.orgSlug, 60),
        ]);
        if (listRes.ok) setSessions(listRes.data);
        if (anaRes.ok) setAnalyses(anaRes.data);
      } finally {
        setLoadingList(false);
      }
    })();
  }, [refreshContext]);

  const toggleAnalysis = useCallback((id: string) => {
    setSelectedAnalysisIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

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

  const onStart = useCallback(async () => {
    const ctx = await refreshContext();
    if (!ctx.clientSlug || !ctx.orgSlug) {
      show("No workspace client — finish onboarding.", "error");
      return;
    }
    if (sourceMode === "outlier" && selectedAnalysisIds.size === 0) {
      show("Select at least one analyzed reel.", "error");
      return;
    }
    setLoading(true);
    try {
      const body =
        sourceMode === "outlier"
          ? {
              source_type: "outlier" as const,
              source_analysis_ids: Array.from(selectedAnalysisIds),
              max_analyses: 12,
            }
          : sourceMode === "manual"
            ? {
                source_type: "manual" as const,
                max_analyses: 12,
                extra_instruction: extraInstruction.trim() || undefined,
              }
            : {
                source_type: "patterns" as const,
                max_analyses: 12,
              };
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
  }, [extraInstruction, refreshContext, selectedAnalysisIds, show, sourceMode]);

  const onChooseAngle = useCallback(
    async (index: number) => {
      if (!session || !clientSlug || !orgSlug) return;
      setLoading(true);
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
        setLoading(false);
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
      setSession(res.data);
      show("Marked approved.", "success");
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

  const analysisCompetitors = useMemo(() => {
    const seen = new Set<string>();
    for (const a of analyses) {
      const u = a.owner_username?.trim();
      if (u) seen.add(u);
    }
    return Array.from(seen).sort((x, y) => x.localeCompare(y, undefined, { sensitivity: "base" }));
  }, [analyses]);

  const filteredAnalyses = useMemo(() => {
    let rows = analyses;
    if (competitorFilter) {
      rows = rows.filter((a) => (a.owner_username?.trim() || "") === competitorFilter);
    }
    const q = analysisSearch.trim().toLowerCase();
    if (q) {
      rows = rows.filter((a) => {
        const u = (a.owner_username || "").toLowerCase();
        const p = (a.post_url || "").toLowerCase();
        return u.includes(q) || p.includes(q);
      });
    }
    const rank = (a: ReelAnalysisListRow) => {
      const s = a.total_score;
      if (s == null || Number.isNaN(Number(s))) return null;
      return Number(s);
    };
    return [...rows].sort((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      if (ra != null && rb != null) return rb - ra;
      if (ra != null) return -1;
      if (rb != null) return 1;
      return 0;
    });
  }, [analyses, analysisSearch, competitorFilter]);

  return (
    <main className="mx-auto max-w-[1400px] p-4 pb-16 pt-6 md:p-8 md:pt-10 lg:p-12">
      <header className="mb-8 md:mb-10">
        <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-app-fg-subtle">
          Generate
        </span>
        <h1 className="mb-2 max-w-2xl text-lg font-semibold text-app-fg">Outlier-driven copy</h1>
        <p className="max-w-2xl text-xs leading-relaxed text-app-fg-muted">
          Patterns from analyzed reels → five angles → hooks, 60s script, caption, and story lines in your
          client&apos;s voice (from client DNA).
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
            <div className="mx-auto max-w-5xl">
              <h2 className="mb-1 text-sm font-semibold uppercase tracking-wider text-app-fg-subtle">
                Source
              </h2>
              <p className="mb-6 max-w-2xl text-sm text-app-fg-muted">
                Choose how we pull reel intelligence, then run angle generation. For manual focus, add your note
                below.
              </p>

              <div className="flex flex-col gap-2">
                <label
                  className={`flex cursor-pointer flex-col rounded-xl border p-3 transition-colors ${
                    sourceMode === "patterns"
                      ? "border-amber-500/40 bg-amber-500/10"
                      : "border-app-divider bg-app-chip-bg/40 hover:bg-app-chip-bg/70"
                  }`}
                >
                  <span className="flex items-start gap-2.5">
                    <input
                      type="radio"
                      name="src"
                      checked={sourceMode === "patterns"}
                      onChange={() => setSourceMode("patterns")}
                      className="mt-0.5 size-3.5 shrink-0 accent-amber-500"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-app-fg">Top patterns</span>
                      <span className="mt-0.5 block text-xs leading-relaxed text-app-fg-muted">
                        Use highest-scoring saved analyses.
                      </span>
                    </span>
                  </span>
                </label>

                <div className="flex flex-col gap-2">
                  <label
                    className={`flex cursor-pointer flex-col rounded-xl border p-3 transition-colors ${
                      sourceMode === "outlier"
                        ? "border-amber-500/40 bg-amber-500/10"
                        : "border-app-divider bg-app-chip-bg/40 hover:bg-app-chip-bg/70"
                    }`}
                  >
                    <span className="flex items-start gap-2.5">
                      <input
                        type="radio"
                        name="src"
                        checked={sourceMode === "outlier"}
                        onChange={() => setSourceMode("outlier")}
                        className="mt-0.5 size-3.5 shrink-0 accent-amber-500"
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-app-fg">Selected analyses</span>
                        <span className="mt-0.5 block text-xs leading-relaxed text-app-fg-muted">
                          Pick specific reels you want to echo.
                        </span>
                      </span>
                    </span>
                  </label>
                  {sourceMode === "outlier" ? (
                    <div className="rounded-xl border border-app-divider bg-app-chip-bg/25 p-3 md:p-4">
                  <h3 className="text-sm font-semibold text-app-fg">
                    Select analyses{" "}
                    <span className="font-normal text-app-fg-muted">
                      ({selectedAnalysisIds.size} selected)
                    </span>
                  </h3>
                  <p className="mb-3 text-xs text-app-fg-muted">
                    Pick the saved analyses that should shape this run. Sorted by score (highest first).
                  </p>
                  {analysisCompetitors.length > 0 ? (
                    <div className="mb-3">
                      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-app-fg-subtle">
                        Competitor
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          onClick={() => setCompetitorFilter(null)}
                          className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                            competitorFilter == null
                              ? "bg-amber-500/25 text-app-fg ring-1 ring-amber-500/40"
                              : "bg-app-chip-bg text-app-fg-muted hover:bg-white/5"
                          }`}
                        >
                          All
                        </button>
                        {analysisCompetitors.map((c) => (
                          <button
                            key={c}
                            type="button"
                            onClick={() =>
                              setCompetitorFilter((prev) => (prev === c ? null : c))
                            }
                            className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                              competitorFilter === c
                                ? "bg-amber-500/25 text-app-fg ring-1 ring-amber-500/40"
                                : "bg-app-chip-bg text-app-fg-muted hover:bg-white/5"
                            }`}
                          >
                            @{c}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  <div className="relative mb-2">
                    <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-app-fg-subtle" />
                    <input
                      type="search"
                      value={analysisSearch}
                      onChange={(e) => setAnalysisSearch(e.target.value)}
                      placeholder="Search username or URL…"
                      className="glass-inset w-full rounded-lg py-2 pl-9 pr-3 text-sm text-app-fg placeholder:text-app-fg-subtle focus:outline-none focus:ring-2 focus:ring-amber-500/30"
                    />
                  </div>
                  {loadingList ? (
                    <div className="flex justify-center py-6">
                      <Loader2 className="size-6 animate-spin text-app-fg-subtle" />
                    </div>
                  ) : analyses.length === 0 ? (
                    <p className="py-2 text-sm text-app-fg-muted">
                      No analyses yet — analyze reels in Intelligence.
                    </p>
                  ) : filteredAnalyses.length === 0 ? (
                    <p className="py-2 text-sm text-app-fg-muted">No analyses match your search or filter.</p>
                  ) : (
                    <div className="max-h-[20rem] overflow-y-auto rounded-lg border border-app-divider/60 pr-1">
                      <ul className="space-y-1.5 p-1">
                        {filteredAnalyses.map((a) => (
                          <li key={a.id}>
                            <label className="flex cursor-pointer gap-2.5 rounded-lg border border-transparent p-2 transition-colors hover:border-app-divider hover:bg-white/[0.03]">
                              <input
                                type="checkbox"
                                checked={selectedAnalysisIds.has(a.id)}
                                onChange={() => toggleAnalysis(a.id)}
                                className="mt-0.5 size-3.5 shrink-0 accent-amber-500"
                              />
                              <span className="min-w-0 flex-1 text-sm">
                                <span className="font-medium text-app-fg">@{a.owner_username ?? "?"}</span>
                                <span className="ml-2 tabular-nums text-xs text-app-fg-muted">
                                  score {a.total_score ?? "—"}
                                </span>
                                <span className="mt-0.5 block truncate font-mono text-[11px] text-app-fg-subtle">
                                  {a.post_url}
                                </span>
                              </span>
                            </label>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                    </div>
                  ) : null}
                </div>

                <label
                  className={`flex cursor-pointer flex-col rounded-xl border p-3 transition-colors ${
                    sourceMode === "manual"
                      ? "border-amber-500/40 bg-amber-500/10"
                      : "border-app-divider bg-app-chip-bg/40 hover:bg-app-chip-bg/70"
                  }`}
                >
                  <span className="flex items-start gap-2.5">
                    <input
                      type="radio"
                      name="src"
                      checked={sourceMode === "manual"}
                      onChange={() => setSourceMode("manual")}
                      className="mt-0.5 size-3.5 shrink-0 accent-amber-500"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-app-fg">Manual focus</span>
                      <span className="mt-0.5 block text-xs leading-relaxed text-app-fg-muted">
                        Same as top patterns + your note below.
                      </span>
                    </span>
                  </span>
                </label>
              </div>

              {sourceMode === "manual" ? (
                <div className="mt-6 space-y-3">
                  <label htmlFor="gen-extra" className="text-sm font-semibold text-app-fg">
                    Focus <span className="font-normal text-app-fg-muted">(optional)</span>
                  </label>
                  <textarea
                    id="gen-extra"
                    rows={4}
                    value={extraInstruction}
                    onChange={(e) => setExtraInstruction(e.target.value)}
                    placeholder="e.g. Grenzen gegenüber der Chefin, Meeting-Situationen…"
                    className="glass-inset min-h-[6.5rem] w-full resize-y rounded-xl p-3 text-sm leading-relaxed text-app-fg placeholder:text-app-fg-subtle focus:outline-none focus:ring-2 focus:ring-amber-500/35"
                  />
                </div>
              ) : null}

              <div className="mt-6 flex flex-col items-end gap-2">
                <button
                  type="button"
                  disabled={loading || !clientSlug}
                  onClick={() => void onStart()}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-bold text-zinc-950 shadow-md shadow-amber-900/20 transition-opacity hover:opacity-95 disabled:opacity-50"
                >
                  {loading ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Sparkles className="size-4" />
                  )}
                  {loading ? "Running models…" : "Generate angles"}
                </button>
                <p className="max-w-md text-right text-xs leading-relaxed text-app-fg-muted">
                  Requires saved reel analyses in Intelligence. First run can take 1–3 minutes.
                </p>
              </div>
            </div>
          </section>

          {sessions.length > 0 ? (
            <section className="rounded-2xl border border-app-divider bg-app-chip-bg/30 p-5 md:p-6">
              <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-app-fg-subtle">
                Recent sessions
              </h2>
              <ul className="flex max-h-[min(50vh,28rem)] flex-col gap-2 overflow-y-auto pr-1 md:max-h-[min(45vh,26rem)]">
                {sessions.map((s) => (
                  <li key={s.id} className="flex gap-2">
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
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
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
          <h2 className="text-sm font-semibold text-app-fg">Pick an angle</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {angles.map((raw, i) => (
              <div key={i} className="glass flex flex-col gap-2 rounded-2xl p-5">
                <p className="text-sm font-semibold text-app-fg">{str(raw.title)}</p>
                <p className="text-xs text-app-fg-muted">{str(raw.situation)}</p>
                <p className="text-[11px] text-app-fg-subtle">
                  <span className="font-medium text-app-fg-muted">Hook: </span>
                  {str(raw.draft_hook)}
                </p>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => void onChooseAngle(i)}
                  className="mt-2 rounded-lg bg-amber-500/15 py-2 text-xs font-bold text-app-on-amber-title hover:bg-amber-500/25 disabled:opacity-50"
                >
                  Use this angle
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {step === "content" && session && (
        <section className="space-y-8">
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

          {chosenAngle ? (
            <div className="glass rounded-2xl border border-amber-500/25 bg-amber-500/[0.06] p-4">
              <p className="text-[10px] font-bold uppercase tracking-wider text-app-fg-subtle">
                Chosen angle
              </p>
              <p className="mt-1 text-sm font-semibold text-app-fg">{str(chosenAngle.title)}</p>
              <p className="mt-1 text-xs leading-relaxed text-app-fg-muted">{str(chosenAngle.situation)}</p>
            </div>
          ) : null}

          <div className="glass rounded-2xl p-4">
            <p className="mb-2 text-xs font-semibold uppercase text-app-fg-subtle">Regenerate</p>
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
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
                placeholder="Feedback e.g. shorter hook, more direct…"
                className="glass-inset min-w-[200px] flex-1 rounded-xl px-3 py-2 text-sm text-app-fg"
              />
              <button
                type="button"
                disabled={loading}
                onClick={() => void onRegenerate()}
                className="flex items-center justify-center gap-2 rounded-xl border border-app-divider px-4 py-2 text-xs font-bold text-app-fg hover:bg-white/5 disabled:opacity-50"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Regenerate
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={loading || session.status === "approved"}
              onClick={() => void onApprove()}
              className="flex items-center gap-2 rounded-xl bg-emerald-500/15 px-4 py-2 text-xs font-bold text-emerald-400 hover:bg-emerald-500/25 disabled:opacity-40"
            >
              <ThumbsUp className="h-4 w-4" /> Approve
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={() => void onReject()}
              className="flex items-center gap-2 rounded-xl bg-red-500/10 px-4 py-2 text-xs font-bold text-red-400 hover:bg-red-500/20"
            >
              <ThumbsDown className="h-4 w-4" /> Reject
            </button>
          </div>

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
        </section>
      )}
    </main>
  );
}
