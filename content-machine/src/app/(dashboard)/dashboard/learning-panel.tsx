"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Check, ExternalLink, Loader2, MoreHorizontal, TrendingUp } from "lucide-react";
import { ReelThumbnail } from "@/components/reel-thumbnail";
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

/** Status = coloured dot + plain words. `text` colours the status line, `dot` the marker. */
const BUCKETS: { id: LearningBucket; label: string; hint: string; dot: string; text: string }[] = [
  { id: "scale", label: "Winner", hint: "Make more like this", dot: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-400" },
  { id: "adjust_hook", label: "Weak start", hint: "Good content — try a new first line", dot: "bg-amber-500", text: "text-amber-600 dark:text-amber-400" },
  { id: "adjust_cta", label: "Few comments", hint: "People watched — ask clearer for a comment", dot: "bg-sky-500", text: "text-sky-600 dark:text-sky-400" },
  { id: "retire", label: "Didn't work", hint: "Skip this topic", dot: "bg-rose-500", text: "text-rose-600 dark:text-rose-400" },
  { id: "keep", label: "Normal", hint: "Nothing to do", dot: "bg-zinc-400", text: "text-app-fg-muted" },
];
const LABEL = Object.fromEntries(BUCKETS.map((b) => [b.id, b])) as Record<LearningBucket, (typeof BUCKETS)[number]>;

const RULE_FIELDS: { key: string; label: string }[] = [
  { key: "scale_views_x", label: "Winner: at least × her usual views" },
  { key: "winner_top_share", label: "Winner: also in her top share of reels (0.2 = top 20%)" },
  { key: "low_views_x", label: "Weak start / Didn't work: below × her usual views" },
  { key: "cta_comment_rate_x", label: "Few comments: below × her usual comments per view" },
  { key: "median_window", label: "Her usual reel = middle of her last N reels" },
  { key: "min_age_days", label: "Judge reels after N days" },
  { key: "min_reels", label: "Minimum reels before judging" },
];

const PAGE = 15;

/** 23678.5 → "23,700" — a rounded number reads easier than an exact median. */
function roundViews(n: number): string {
  return (Math.round(n / 100) * 100).toLocaleString();
}

function shortDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** First caption line as a calm title: emojis and arrow symbols removed (they're in the caption). */
function titleFromCaption(text: string): string {
  const line = text.split("\n").find((l) => l.trim()) ?? "";
  return line
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{20E3}\u{2B05}-\u{2B07}\u{27A1}]/gu, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function firstSentence(text: string | null | undefined): string {
  const t = (text ?? "").trim();
  if (!t) return "";
  const m = t.match(/^(.{20,220}?[.!?])(\s|$)/);
  return m ? m[1] : t.slice(0, 220);
}

function Dot({ className }: { className: string }) {
  return <span aria-hidden className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${className}`} />;
}

/** One quiet menu per row instead of a dropdown, checkbox and button on every line. */
function RowMenu({
  item,
  busy,
  queued,
  onLabel,
  onIgnore,
  onAnalyse,
}: {
  item: ReelDiagnosticItem;
  busy: boolean;
  queued: boolean;
  onLabel: (bucket: LearningBucket | null) => void;
  onIgnore: (ignored: boolean) => void;
  onAnalyse: () => void;
}) {
  const [pos, setPos] = useState<CSSProperties | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const open = pos !== null;
  const setOpen = (next: boolean | ((o: boolean) => boolean)) => {
    const want = typeof next === "function" ? next(open) : next;
    if (!want) return setPos(null);
    // Rendered in <body> with fixed position: the glass panel clips its children (overflow: hidden).
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const menuH = 300;
    const right = Math.max(8, window.innerWidth - r.right);
    setPos(
      r.bottom + menuH + 8 > window.innerHeight
        ? { position: "fixed", right, bottom: window.innerHeight - r.top + 4 }
        : { position: "fixed", right, top: r.bottom + 4 },
    );
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !btnRef.current?.contains(t)) setPos(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPos(null);
    const onMove = () => setPos(null);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open]);

  const pick = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  const itemCls =
    "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-app-fg hover:bg-app-chip-bg/70 disabled:opacity-40";

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        aria-label="Reel options"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={busy}
        onClick={() => setOpen((o) => !o)}
        className="rounded-lg p-1.5 text-app-fg-subtle hover:bg-app-chip-bg/70 hover:text-app-fg disabled:opacity-40"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreHorizontal className="h-4 w-4" />}
      </button>
      {open && pos
        ? createPortal(
        <div
          ref={menuRef}
          role="menu"
          style={pos}
          className="z-50 w-56 rounded-xl border border-app-card-border bg-[var(--background)] p-1.5 shadow-xl"
        >
          <p className="px-2.5 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wide text-app-fg-subtle">Label</p>
          {BUCKETS.map((b) => (
            <button key={b.id} type="button" role="menuitem" className={itemCls} onClick={pick(() => onLabel(b.id))}>
              <Dot className={b.dot} />
              <span className="flex-1">{b.label}</span>
              {item.bucket === b.id ? <Check className="h-3.5 w-3.5 text-app-fg-muted" /> : null}
            </button>
          ))}
          {item.override_bucket ? (
            <button type="button" role="menuitem" className={itemCls} onClick={pick(() => onLabel(null))}>
              <span className="w-1.5" />
              <span className="flex-1 text-app-fg-muted">Back to automatic ({LABEL[item.rule_bucket].label})</span>
            </button>
          ) : null}
          <div className="my-1 border-t border-app-divider" />
          <button type="button" role="menuitem" className={itemCls} onClick={pick(() => onIgnore(!item.excluded))}>
            <span className="w-1.5" />
            <span className="flex-1">{item.excluded ? "Use this reel again" : "Ignore this reel"}</span>
          </button>
          {!item.analysis ? (
            <button type="button" role="menuitem" className={itemCls} disabled={queued} onClick={pick(onAnalyse)}>
              <span className="w-1.5" />
              <span className="flex-1">{queued ? "AI read queued…" : "Get AI read"}</span>
            </button>
          ) : null}
        </div>,
            document.body,
          )
        : null}
    </div>
  );
}

/** Learning loop on the dashboard: how each own reel did against her usual reel, with human override. */
export function LearningPanel({ clientSlug, orgSlug }: { clientSlug: string; orgSlug: string }) {
  const { show } = useToast();
  const [data, setData] = useState<LearningDiagnostics | null>(null);
  const [filter, setFilter] = useState<LearningBucket | "all">("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rulesDraft, setRulesDraft] = useState<Record<string, string>>({});
  const [empty, setEmpty] = useState<string | null>(null);
  const [queued, setQueued] = useState<Set<string>>(new Set());
  const [shown, setShown] = useState(PAGE);

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
        setEmpty(`Not enough reels yet — needs ${rc.data.min_reels} reels older than a few days (has ${rc.data.reels}).`);
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

  const allRows = (data?.items ?? []).filter((it) => filter === "all" || it.bucket === filter);
  const rows = allRows.slice(0, shown);

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
      if (!res.ok) {
        show(res.error, "error");
        return;
      }
      setQueued((prev) => new Set(prev).add(it.reel_id));
      show(res.data.already_pending ? "Already being analysed." : "AI read queued — it appears here in a few minutes.", "success");
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

  const chip = (id: LearningBucket | "all", label: string, count: number, dot?: string, hint?: string) => (
    <button
      key={id}
      type="button"
      title={hint}
      aria-pressed={filter === id}
      onClick={() => {
        setFilter(id);
        setShown(PAGE);
      }}
      className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-semibold transition ${
        filter === id ? "bg-app-chip-bg text-app-fg" : "text-app-fg-muted hover:text-app-fg"
      }`}
    >
      {dot ? <Dot className={dot} /> : null}
      {label}
      <span className="font-normal text-app-fg-subtle">{count}</span>
    </button>
  );

  return (
    <section
      className="glass glass-strong rounded-2xl border border-app-card-border"
      aria-label="Learning from results"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-app-divider px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <div className="rounded-lg bg-emerald-500/15 p-1.5 text-emerald-600 dark:text-emerald-400">
            <TrendingUp className="h-4 w-4" aria-hidden />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-app-fg">What&apos;s working</h2>
            <p className="text-[10px] text-app-fg-muted">
              {data?.usual_views
                ? `Each reel compared with her usual reel (about ${roundViews(data.usual_views)} views)`
                : "Each reel compared with her usual reel"}
            </p>
          </div>
        </div>
        {data ? (
          <label className="inline-flex cursor-pointer items-center gap-2 text-[11px] font-semibold text-app-fg-muted">
            <input
              type="checkbox"
              className="accent-emerald-500"
              checked={data.learning_enabled}
              onChange={(e) => void saveSettings({ learning_enabled: e.target.checked })}
              aria-label="Learn from results"
            />
            Learn from results
          </label>
        ) : null}
      </div>

      {!data ? (
        <p className="px-4 py-6 text-xs text-app-fg-subtle">Loading…</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-1 border-b border-app-divider px-3 py-2">
            {chip("all", "All", data.items.length)}
            {BUCKETS.map((b) => chip(b.id, b.label, counts[b.id] ?? 0, b.dot, b.hint))}
          </div>

          {empty ? <p className="px-4 py-6 text-xs text-app-fg-subtle">{empty}</p> : null}

          <ul className="divide-y divide-app-divider">
            {rows.map((it) => {
              const b = LABEL[it.bucket];
              const why = firstSentence(it.analysis?.why_it_worked);
              const title = titleFromCaption(it.caption) || "Untitled reel";
              return (
                <li key={it.reel_id} className={`flex items-start gap-3 px-4 py-3 ${it.excluded ? "opacity-50" : ""}`}>
                  <ReelThumbnail src={it.thumbnail_url} alt="" href={it.post_url} className="h-11 w-11 shrink-0 rounded-lg" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-app-fg">{title}</p>
                    <p className={`mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] font-semibold ${b.text}`} title={`${b.label}: ${it.reason}`}>
                      <Dot className={b.dot} />
                      <span className="shrink-0 whitespace-nowrap">{b.label}</span>
                      <span className="min-w-0 truncate font-normal text-app-fg-muted">· {it.reason}</span>
                    </p>
                    <p className="mt-0.5 text-[10px] text-app-fg-subtle">
                      {shortDate(it.posted_at)}
                      {it.override_bucket ? " · label changed by you" : ""}
                      {it.excluded ? " · ignored" : ""}
                      {it.linked_session_id ? (
                        <>
                          {" · "}
                          <Link href={generateSessionHref(it.linked_session_id)} className="underline hover:text-app-fg">
                            made in the system
                          </Link>
                        </>
                      ) : null}
                    </p>
                    {why ? <p className="mt-1 text-[11px] leading-relaxed text-app-fg-muted">{why}</p> : null}
                  </div>
                  <div className="flex shrink-0 items-center">
                    <a
                      href={it.post_url}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="Open on Instagram"
                      className="rounded-lg p-1.5 text-app-fg-subtle hover:bg-app-chip-bg/70 hover:text-app-fg"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </a>
                    <RowMenu
                      item={it}
                      busy={busyId === it.reel_id}
                      queued={queued.has(it.reel_id)}
                      onLabel={(bucket) =>
                        void patchItem(it, bucket ? { override_bucket: bucket } : { clear_override: true })
                      }
                      onIgnore={(ignored) => void patchItem(it, { excluded: ignored })}
                      onAnalyse={() => void analyse(it)}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
          {allRows.length === 0 && !empty ? (
            <p className="px-4 py-6 text-xs text-app-fg-subtle">No reels in this group.</p>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-app-divider px-4 py-2.5">
            {allRows.length > rows.length ? (
              <button
                type="button"
                onClick={() => setShown((n) => n + PAGE)}
                className="text-[11px] font-semibold text-app-accent hover:underline"
              >
                Show {Math.min(PAGE, allRows.length - rows.length)} more
              </button>
            ) : (
              <span />
            )}
            <details className="text-right">
              <summary className="cursor-pointer list-none text-[11px] font-semibold text-app-fg-muted hover:text-app-fg">
                Rules
              </summary>
              <div className="mt-2 w-[min(28rem,80vw)] space-y-2 text-left">
                <p className="text-[10px] text-app-fg-subtle">Defaults — confirm with Silas.</p>
                {RULE_FIELDS.map((f) => (
                  <label key={f.key} className="flex items-center justify-between gap-3 text-[11px] text-app-fg">
                    <span>{f.label}</span>
                    <input
                      type="number"
                      step={f.key === "winner_top_share" ? "0.05" : "0.1"}
                      min="0"
                      value={rulesDraft[f.key] ?? ""}
                      aria-label={f.label}
                      onChange={(e) => setRulesDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                      className="glass-inset w-16 rounded-md px-1.5 py-0.5 text-right"
                    />
                  </label>
                ))}
                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => void saveSettings({ thresholds: {} })}
                    className="rounded-lg border border-app-divider px-2.5 py-1 text-[11px] font-semibold text-app-fg-muted"
                  >
                    Reset
                  </button>
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
                    className="rounded-lg bg-app-chip-bg px-2.5 py-1 text-[11px] font-semibold text-app-fg"
                  >
                    Save rules
                  </button>
                </div>
              </div>
            </details>
          </div>
        </>
      )}
    </section>
  );
}
