"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink, Loader2, Sparkles } from "lucide-react";
import { useToast } from "@/components/ui/toast-provider";
import {
  analyzeOwnReel,
  fetchLearningDiagnostics,
  patchReelDiagnostic,
  putLearningSettings,
  recomputeLearningDiagnostics,
  type LearningBucket,
  type LearningDiagnostics,
  type ReelDiagnosticItem,
} from "@/lib/api-client";
import { generateSessionHref } from "@/lib/generate-session-url";

const BUCKETS: { id: LearningBucket; label: string; cls: string }[] = [
  { id: "scale", label: "Scale it", cls: "bg-emerald-500/15 text-emerald-300" },
  { id: "adjust_hook", label: "Adjust hook", cls: "bg-amber-500/15 text-amber-300" },
  { id: "adjust_cta", label: "Adjust CTA", cls: "bg-sky-500/15 text-sky-300" },
  { id: "retire", label: "Retire", cls: "bg-rose-500/15 text-rose-300" },
  { id: "keep", label: "Keep", cls: "bg-app-chip-bg text-app-fg-muted" },
];
const LABEL = Object.fromEntries(BUCKETS.map((b) => [b.id, b])) as Record<LearningBucket, (typeof BUCKETS)[number]>;

const RULE_FIELDS: { key: string; label: string }[] = [
  { key: "scale_views_x", label: "Scale it: views ≥ × median" },
  { key: "low_views_x", label: "Adjust hook / Retire: views < × median" },
  { key: "cta_comment_rate_x", label: "Adjust CTA: comments/view < × median" },
  { key: "median_window", label: "Median over last N reels" },
  { key: "min_age_days", label: "Judge reels after N days" },
  { key: "min_reels", label: "Minimum reels before judging" },
];

function shortDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

function firstSentence(text: string | null | undefined): string {
  const t = (text ?? "").trim();
  if (!t) return "";
  const m = t.match(/^(.{20,220}?[.!?])(\s|$)/);
  return m ? m[1] : t.slice(0, 220);
}

/** Learning loop on the dashboard: what each own reel says, with human override. */
export function LearningPanel({ clientSlug, orgSlug }: { clientSlug: string; orgSlug: string }) {
  const { show } = useToast();
  const [data, setData] = useState<LearningDiagnostics | null>(null);
  const [filter, setFilter] = useState<LearningBucket | "all">("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [rulesDraft, setRulesDraft] = useState<Record<string, string>>({});
  const [empty, setEmpty] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetchLearningDiagnostics(clientSlug, orgSlug);
    if (!res.ok) {
      show(res.error, "error");
      return;
    }
    setData(res.data);
    setRulesDraft(Object.fromEntries(Object.entries(res.data.thresholds).map(([k, v]) => [k, String(v)])));
    if (!res.data.items.length) {
      const rc = await recomputeLearningDiagnostics(clientSlug, orgSlug);
      if (rc.ok && rc.data.status === "not_enough_data") {
        setEmpty(`Not enough data yet — needs ${rc.data.min_reels} reels older than a few days (has ${rc.data.reels}).`);
      } else if (rc.ok && rc.data.status === "ok") {
        const again = await fetchLearningDiagnostics(clientSlug, orgSlug);
        if (again.ok) setData(again.data);
      }
    }
  }, [clientSlug, orgSlug, show]);

  useEffect(() => {
    if (clientSlug.trim() && orgSlug.trim()) void load();
  }, [clientSlug, orgSlug, load]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const it of data?.items ?? []) if (!it.excluded) c[it.bucket] = (c[it.bucket] ?? 0) + 1;
    return c;
  }, [data]);

  const rows = (data?.items ?? []).filter((it) => filter === "all" || it.bucket === filter);

  const patchItem = async (it: ReelDiagnosticItem, body: Parameters<typeof patchReelDiagnostic>[3]) => {
    setBusyId(it.reel_id);
    try {
      const res = await patchReelDiagnostic(clientSlug, orgSlug, it.reel_id, body);
      if (!res.ok) {
        show(res.error, "error");
        return;
      }
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const analyse = async (it: ReelDiagnosticItem) => {
    setBusyId(it.reel_id);
    try {
      const res = await analyzeOwnReel(clientSlug, orgSlug, it.reel_id);
      show(res.ok ? "Analysis queued — it appears here in a few minutes." : res.error, res.ok ? "success" : "error");
    } finally {
      setBusyId(null);
    }
  };

  const saveSettings = async (body: Parameters<typeof putLearningSettings>[2]) => {
    const res = await putLearningSettings(clientSlug, orgSlug, body);
    if (!res.ok) {
      show(res.error, "error");
      return;
    }
    if (body.thresholds !== undefined) await recomputeLearningDiagnostics(clientSlug, orgSlug);
    await load();
    show("Saved.", "success");
  };

  if (!data) {
    return (
      <section className="glass rounded-2xl border border-app-divider/80 p-5">
        <p className="text-xs text-app-fg-subtle">Loading learning…</p>
      </section>
    );
  }

  return (
    <section className="glass rounded-2xl border border-app-divider/80 p-5 md:p-6" aria-label="Learning from results">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-app-fg">What&apos;s working</h2>
          <p className="text-[11px] text-app-fg-muted">Each reel vs her own median. Your override always wins.</p>
        </div>
        <label className="inline-flex items-center gap-2 text-[11px] font-semibold text-app-fg">
          <input
            type="checkbox"
            checked={data.learning_enabled}
            onChange={(e) => void saveSettings({ learning_enabled: e.target.checked })}
            aria-label="Learn from results"
          />
          Learn from results
        </label>
      </div>

      {empty ? <p className="text-xs text-app-fg-subtle">{empty}</p> : null}

      <div className="mb-3 flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => setFilter("all")}
          className={`rounded-lg px-2 py-1 text-[11px] font-semibold ${filter === "all" ? "bg-app-icon-btn-bg text-app-icon-btn-fg" : "text-app-fg-muted"}`}
        >
          All {data.items.length}
        </button>
        {BUCKETS.map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => setFilter(b.id)}
            className={`rounded-lg px-2 py-1 text-[11px] font-semibold ${filter === b.id ? b.cls : "text-app-fg-muted"}`}
          >
            {b.label} {counts[b.id] ?? 0}
          </button>
        ))}
      </div>

      <ul className="divide-y divide-app-divider/40">
        {rows.map((it) => {
          const b = LABEL[it.bucket];
          const why = firstSentence(it.analysis?.why_it_worked);
          return (
            <li key={it.reel_id} className={`py-2.5 ${it.excluded ? "opacity-50" : ""}`}>
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                <span className={`rounded-md px-1.5 py-0.5 font-bold ${b.cls}`}>{b.label}</span>
                <span className="text-app-fg-muted">{shortDate(it.posted_at)}</span>
                <span className="min-w-0 flex-1 text-app-fg">
                  {it.reason}
                  {it.override_bucket ? <span className="text-app-fg-muted"> · your override</span> : null}
                </span>
                <a href={it.post_url} target="_blank" rel="noreferrer" aria-label="Open on Instagram" className="text-app-fg-subtle hover:text-app-fg">
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
              <p className="mt-0.5 truncate text-[11px] text-app-fg-subtle">{it.caption}</p>
              {why ? <p className="mt-0.5 text-[11px] text-app-fg-muted">AI: {why}</p> : null}
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
                <select
                  value={it.override_bucket ?? ""}
                  disabled={busyId === it.reel_id}
                  aria-label="Override bucket"
                  onChange={(e) =>
                    void patchItem(
                      it,
                      e.target.value ? { override_bucket: e.target.value as LearningBucket } : { clear_override: true },
                    )
                  }
                  className="glass-inset rounded-md px-1.5 py-0.5 text-[11px] text-app-fg"
                >
                  <option value="">Rule: {LABEL[it.rule_bucket].label}</option>
                  {BUCKETS.map((o) => (
                    <option key={o.id} value={o.id}>
                      Override: {o.label}
                    </option>
                  ))}
                </select>
                <label className="inline-flex items-center gap-1 text-app-fg-muted">
                  <input
                    type="checkbox"
                    checked={it.excluded}
                    disabled={busyId === it.reel_id}
                    onChange={(e) => void patchItem(it, { excluded: e.target.checked })}
                  />
                  Exclude from learning
                </label>
                {!it.analysis ? (
                  <button
                    type="button"
                    disabled={busyId === it.reel_id}
                    onClick={() => void analyse(it)}
                    className="inline-flex items-center gap-1 text-app-fg-muted hover:text-app-fg disabled:opacity-40"
                  >
                    {busyId === it.reel_id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                    Analyse
                  </button>
                ) : null}
                {it.linked_session_id ? (
                  <Link href={generateSessionHref(it.linked_session_id)} className="text-app-fg-muted underline">
                    Made in the system
                  </Link>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      <details className="mt-3" open={rulesOpen} onToggle={(e) => setRulesOpen((e.target as HTMLDetailsElement).open)}>
        <summary className="cursor-pointer text-[11px] font-semibold text-app-fg-muted">Rules (defaults — confirm with Silas)</summary>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {RULE_FIELDS.map((f) => (
            <label key={f.key} className="flex items-center justify-between gap-2 text-[11px] text-app-fg">
              <span>{f.label}</span>
              <input
                type="number"
                step="0.1"
                min="0"
                value={rulesDraft[f.key] ?? ""}
                aria-label={f.label}
                onChange={(e) => setRulesDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                className="glass-inset w-20 rounded-md px-1.5 py-0.5 text-right"
              />
            </label>
          ))}
        </div>
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={() =>
              void saveSettings({
                thresholds: Object.fromEntries(
                  Object.entries(rulesDraft)
                    .map(([k, v]) => [k, Number(v)] as const)
                    .filter(([k, v]) => Number.isFinite(v) && v > 0 && v !== data.default_thresholds[k]),
                ),
              })
            }
            className="rounded-lg bg-violet-500/20 px-2.5 py-1 text-[11px] font-bold text-violet-200 hover:bg-violet-500/30"
          >
            Save rules
          </button>
          <button
            type="button"
            onClick={() => void saveSettings({ thresholds: {} })}
            className="rounded-lg border border-app-divider px-2.5 py-1 text-[11px] font-semibold text-app-fg-muted"
          >
            Reset to defaults
          </button>
        </div>
      </details>
    </section>
  );
}
