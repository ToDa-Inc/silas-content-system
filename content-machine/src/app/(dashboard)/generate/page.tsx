"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Copy,
  Loader2,
  RefreshCw,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { useToast } from "@/components/ui/toast-provider";
import {
  clientApiContext,
  fetchReelAnalysesList,
  generationChooseAngle,
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
              extra_instruction: extraInstruction.trim() || undefined,
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
                extra_instruction: extraInstruction.trim() || undefined,
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
    if (!session || !clientSlug || !orgSlug) return;
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

  return (
    <main className="mx-auto max-w-[1400px] p-4 pb-16 pt-6 md:p-8 md:pt-10 lg:p-12">
      <header className="mb-8 md:mb-10">
        <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-app-fg-subtle">
          Generate
        </span>
        <h1 className="mb-2 max-w-2xl text-lg font-semibold text-app-fg">
          Outlier-driven copy
        </h1>
        <p className="max-w-2xl text-xs leading-relaxed text-app-fg-muted">
          Patterns from analyzed reels → five angles → hooks, 60s script, caption, and story
          lines in your client&apos;s voice (from client DNA).
        </p>
      </header>

      {!clientSlug && (
        <p className="mb-6 text-sm text-amber-600 dark:text-amber-400">
          No active client in workspace — complete onboarding or switch client.
        </p>
      )}

      {sessions.length > 0 && step === "source" && (
        <section className="mb-8 rounded-2xl border border-app-divider bg-app-chip-bg/30 p-4">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-app-fg-subtle">
            Recent sessions
          </h2>
          <ul className="flex flex-wrap gap-2">
            {sessions.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => void loadSessionById(s.id)}
                  className="rounded-lg border border-app-divider px-3 py-1.5 text-left text-[11px] text-app-fg transition-colors hover:bg-white/5"
                >
                  <span className="font-mono text-app-fg-muted">{s.id.slice(0, 12)}…</span>{" "}
                  <span className="text-app-fg-subtle">{s.status}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {step === "source" && (
        <div className="flex flex-col gap-10 lg:flex-row lg:items-start">
          <section className="glass w-full space-y-6 rounded-2xl p-6 lg:sticky lg:top-24 lg:max-w-md">
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-app-fg-subtle">
                Source
              </p>
              {(
                [
                  ["patterns", "Top patterns", "Use highest-scoring saved analyses."],
                  ["outlier", "Selected analyses", "Pick specific reels you want to echo."],
                  ["manual", "Manual focus", "Same as top patterns + your note below."],
                ] as const
              ).map(([id, label, hint]) => (
                <label
                  key={id}
                  className={`flex cursor-pointer flex-col rounded-xl border p-3 text-sm ${
                    sourceMode === id
                      ? "border-amber-500/40 bg-amber-500/10"
                      : "border-transparent bg-app-chip-bg"
                  }`}
                >
                  <span className="flex items-center gap-2 font-semibold text-app-fg">
                    <input
                      type="radio"
                      name="src"
                      checked={sourceMode === id}
                      onChange={() => setSourceMode(id)}
                      className="accent-amber-500"
                    />
                    {label}
                  </span>
                  <span className="mt-1 pl-6 text-[11px] text-app-fg-muted">{hint}</span>
                </label>
              ))}
            </div>

            <div className="space-y-2">
              <label
                htmlFor="gen-extra"
                className="text-xs font-semibold uppercase tracking-wider text-app-fg-subtle"
              >
                Focus (optional)
              </label>
              <textarea
                id="gen-extra"
                rows={3}
                value={extraInstruction}
                onChange={(e) => setExtraInstruction(e.target.value)}
                placeholder="e.g. Grenzen gegenüber der Chefin, Meeting-Situationen…"
                className="glass-inset w-full resize-y rounded-xl p-3 text-sm text-app-fg placeholder:text-app-fg-subtle focus:outline-none focus:ring-2 focus:ring-amber-500/30"
              />
            </div>

            <button
              type="button"
              disabled={loading || !clientSlug}
              onClick={() => void onStart()}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 py-4 text-sm font-bold text-zinc-950 shadow-lg shadow-amber-900/20 transition-opacity hover:opacity-95 disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {loading ? "Running models…" : "Generate angles"}
            </button>
            <p className="text-[11px] text-app-fg-muted">
              Requires saved reel analyses in Intelligence. First run can take 1–3 minutes.
            </p>
          </section>

          {sourceMode === "outlier" && (
            <section className="glass flex-1 rounded-2xl p-6">
              <h2 className="mb-3 text-sm font-semibold text-app-fg">
                Select analyses ({selectedAnalysisIds.size} selected)
              </h2>
              {loadingList ? (
                <Loader2 className="h-6 w-6 animate-spin text-app-fg-subtle" />
              ) : analyses.length === 0 ? (
                <p className="text-sm text-app-fg-muted">No analyses yet — analyze reels in Intelligence.</p>
              ) : (
                <ul className="max-h-[480px] space-y-2 overflow-y-auto pr-1">
                  {analyses.map((a) => (
                    <li key={a.id}>
                      <label className="flex cursor-pointer gap-3 rounded-xl border border-app-divider p-3 hover:bg-white/[0.03]">
                        <input
                          type="checkbox"
                          checked={selectedAnalysisIds.has(a.id)}
                          onChange={() => toggleAnalysis(a.id)}
                          className="mt-1 accent-amber-500"
                        />
                        <span className="min-w-0 flex-1 text-sm">
                          <span className="font-medium text-app-fg">@{a.owner_username ?? "?"}</span>
                          <span className="ml-2 text-app-fg-muted">
                            score {a.total_score ?? "—"}
                          </span>
                          <span className="mt-1 block truncate font-mono text-[11px] text-app-fg-subtle">
                            {a.post_url}
                          </span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
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
                Synthesized patterns {patternsOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </button>
            )}
          </div>
          {patternsOpen && session.synthesized_patterns && (
            <pre className="max-h-64 overflow-auto rounded-xl border border-app-divider bg-zinc-950/40 p-4 text-[11px] text-zinc-300">
              {JSON.stringify(session.synthesized_patterns, null, 2)}
            </pre>
          )}
          <h2 className="text-sm font-semibold text-app-fg">Pick an angle</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {angles.map((raw, i) => (
              <div
                key={i}
                className="glass flex flex-col gap-2 rounded-2xl p-5"
              >
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
              className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                session.status === "approved"
                  ? "bg-emerald-500/20 text-emerald-400"
                  : session.status === "rejected"
                    ? "bg-red-500/20 text-red-400"
                    : "bg-app-chip-bg text-app-fg-muted"
              }`}
            >
              {session.status}
            </span>
          </div>

          <div className="glass rounded-2xl p-4">
            <p className="mb-2 text-xs font-semibold uppercase text-app-fg-subtle">Regenerate</p>
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
              <select
                value={regenScope}
                onChange={(e) =>
                  setRegenScope(e.target.value as typeof regenScope)
                }
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
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-app-fg">
                Hooks ({session.hooks?.length ?? 0})
              </h2>
            </div>
            <ul className="space-y-2">
              {(session.hooks ?? []).map((h, i) => (
                <li
                  key={`${i}-${h.text.slice(0, 20)}`}
                  className="glass flex items-start justify-between gap-3 rounded-xl p-4"
                >
                  <p className="flex-1 text-sm leading-relaxed text-app-fg">
                    <span className="mr-2 text-[10px] font-bold uppercase text-app-fg-subtle">
                      T{h.tier}
                    </span>
                    {h.text}
                  </p>
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
            <pre className="glass max-h-[480px] overflow-auto whitespace-pre-wrap rounded-2xl p-5 text-sm leading-relaxed text-app-fg">
              {session.script ?? "—"}
            </pre>
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
