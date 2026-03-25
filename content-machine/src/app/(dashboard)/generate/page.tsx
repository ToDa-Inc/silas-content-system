"use client";

import { useCallback, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Brain,
  Check,
  Copy,
  Loader2,
  MessageCircle,
  Sparkles,
  Star,
  Zap,
} from "lucide-react";
import { useToast } from "@/components/ui/toast-provider";

const niches = [
  "B2B SaaS Growth",
  "Personal Finance",
  "Creative Technology",
  "Performance Marketing",
  "Lifestyle & Wellness",
];

const tones = [
  { id: "authoritative", label: "Authoritative", icon: Zap },
  { id: "curious", label: "Curious", icon: Brain },
  { id: "urgent", label: "Urgent", icon: AlertTriangle },
  { id: "conversational", label: "Conversational", icon: MessageCircle },
] as const;

const HOOK_POOL = [
  "Stop wasting hours on manual formatting when these 3 automation secrets can do it for you in seconds.",
  "Most founders fail because they ignore this one critical metric in their first six months of operation.",
  "The algorithm changed again — here is the only framework that still scales organic reach in 2026.",
  'If your hooks feel "random", you are missing this single pattern every 1M+ view account uses.',
  "Your audience scrolls past 99% of posts — this opening line pattern is why the 1% stop.",
  "The uncomfortable truth: your content is fine; your first three seconds are what’s killing reach.",
  "I reviewed 200 viral hooks this week — only one structure showed up in more than half of them.",
];

const INITIAL = HOOK_POOL.slice(0, 4).map((text, i) => ({
  id: `h-${i}`,
  text,
}));

function pickFreshHooks(count: number) {
  const shuffled = [...HOOK_POOL].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count).map((text, i) => ({
    id: `h-${Date.now()}-${i}`,
    text,
  }));
}

export default function GeneratePage() {
  const { show } = useToast();
  const [tone, setTone] = useState<string>("authoritative");
  const [niche, setNiche] = useState(niches[0]);
  const [topic, setTopic] = useState("");
  const [items, setItems] = useState(INITIAL);
  const [generating, setGenerating] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [starred, setStarred] = useState<Set<string>>(() => new Set());

  const onGenerate = useCallback(() => {
    setGenerating(true);
    window.setTimeout(() => {
      const next = pickFreshHooks(4);
      setItems(next);
      setGenerating(false);
      show(
        `Generated 4 hooks (${niche}, ${tone})${topic.trim() ? " — topic applied." : "."}`,
        "success",
      );
    }, 1200);
  }, [niche, show, tone, topic]);

  const onCopy = useCallback(
    async (id: string, text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        setCopiedId(id);
        show("Copied to clipboard.", "success");
        window.setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1600);
      } catch {
        show("Could not copy — check browser permissions.", "error");
      }
    },
    [show],
  );

  const toggleStar = useCallback((id: string) => {
    setStarred((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const onExportAll = useCallback(() => {
    const body = items.map((h, i) => `${i + 1}. ${h.text}`).join("\n\n");
    void (async () => {
      try {
        await navigator.clipboard.writeText(body);
        show(`Exported ${items.length} hooks to clipboard.`, "success");
      } catch {
        show("Export failed — try again.", "error");
      }
    })();
  }, [items, show]);

  const onRefresh = useCallback(() => {
    setItems((prev) => [...prev].sort(() => Math.random() - 0.5));
    show("List reordered.");
  }, [show]);

  return (
    <main className="mx-auto max-w-[1400px] p-4 pb-16 pt-6 md:p-8 md:pt-10 lg:p-12">
      <header className="mb-8 md:mb-10">
        <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-app-fg-subtle">
          Generate
        </span>
        <h1 className="mb-2 max-w-2xl text-lg font-semibold text-app-fg">
          Hooks
        </h1>
        <p className="max-w-lg text-xs leading-relaxed text-app-fg-muted">
          Niche, tone, optional context — then generate. Copy or star lines you’ll use.
        </p>
      </header>

      <div className="flex flex-col items-start gap-12 lg:flex-row">
        <section className="glass w-full space-y-8 rounded-2xl p-6 lg:sticky lg:top-24 lg:w-[400px]">
          <div className="space-y-6">
            <div className="space-y-2">
              <label
                htmlFor="gen-niche"
                className="ml-1 text-xs font-semibold uppercase tracking-wider text-app-fg-subtle"
              >
                Content niche
              </label>
              <div className="relative">
                <select
                  id="gen-niche"
                  value={niche}
                  onChange={(e) => setNiche(e.target.value)}
                  className="glass-inset w-full appearance-none rounded-xl py-3.5 pl-4 pr-11 text-sm text-app-fg transition-shadow focus:outline-none focus:ring-2 focus:ring-amber-500/30"
                >
                  {niches.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
                <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-app-fg-subtle">
                  ▼
                </span>
              </div>
            </div>

            <div className="space-y-3">
              <p className="ml-1 text-xs font-semibold uppercase tracking-wider text-app-fg-subtle">
                Tone
              </p>
              <div className="grid grid-cols-2 gap-2">
                {tones.map(({ id, label, icon: Icon }) => {
                  const active = tone === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setTone(id)}
                      className={`flex items-center gap-2 rounded-xl p-3.5 text-left text-sm font-semibold transition-colors ${
                        active
                          ? "border border-amber-500/35 bg-amber-500/10 text-app-on-amber-title"
                          : "border border-transparent bg-app-chip-bg text-app-chip-fg hover:bg-app-chip-bg-hover hover:text-app-chip-fg-hover"
                      }`}
                    >
                      <Icon className="h-4 w-4 shrink-0" aria-hidden />
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <label
                htmlFor="gen-topic"
                className="ml-1 text-xs font-semibold uppercase tracking-wider text-app-fg-subtle"
              >
                Context (optional)
              </label>
              <textarea
                id="gen-topic"
                rows={4}
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="One line on the angle or audience…"
                className="glass-inset w-full resize-y rounded-xl p-4 text-sm text-app-fg placeholder:text-app-fg-subtle focus:outline-none focus:ring-2 focus:ring-amber-500/30"
              />
            </div>
          </div>

          <button
            type="button"
            disabled={generating}
            onClick={() => void onGenerate()}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 py-4 text-sm font-bold text-zinc-950 shadow-lg shadow-amber-900/20 transition-opacity hover:opacity-95 active:scale-[0.99] disabled:opacity-60"
          >
            {generating ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Sparkles className="h-4 w-4" aria-hidden />
            )}
            {generating ? "Generating…" : "Generate hooks"}
          </button>

          <div className="flex items-center gap-2 px-1">
            <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400" />
            <span className="text-[11px] font-medium text-app-fg-muted">
              Ready — output is demo data until the model is wired.
            </span>
          </div>
        </section>

        <section className="w-full flex-1 space-y-6">
          <div className="mb-6 flex flex-col gap-4 border-b border-app-divider pb-4 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-sm font-semibold text-app-fg">
              Output <span className="text-app-fg-muted">({items.length})</span>
            </h2>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void onExportAll()}
                className="glass-pill rounded-full px-4 py-2 text-[11px] font-bold text-app-pill-fg transition-colors hover:text-app-pill-fg-hover"
              >
                Export all
              </button>
              <button
                type="button"
                onClick={onRefresh}
                className="glass-pill rounded-full px-4 py-2 text-[11px] font-bold text-app-pill-fg transition-colors hover:text-app-pill-fg-hover"
              >
                Shuffle order
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3">
            {items.map((row) => {
              const isStarred = starred.has(row.id);
              return (
                <div
                  key={row.id}
                  className="glass group flex flex-col justify-between gap-4 rounded-2xl p-5 transition-colors hover:bg-zinc-100/70 dark:hover:bg-white/[0.04] md:flex-row md:items-center"
                >
                  <p className="min-w-0 flex-1 text-[15px] leading-relaxed text-app-fg">
                    {row.text}
                  </p>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      title="Copy"
                      onClick={() => void onCopy(row.id, row.text)}
                      className="rounded-lg bg-app-icon-btn-bg p-2.5 text-app-icon-btn-fg transition-colors hover:bg-app-icon-btn-bg-hover hover:text-app-icon-btn-fg-hover"
                    >
                      {copiedId === row.id ? (
                        <Check className="h-5 w-5 text-emerald-400" aria-hidden />
                      ) : (
                        <Copy className="h-5 w-5" aria-hidden />
                      )}
                    </button>
                    <button
                      type="button"
                      title={isStarred ? "Unstar" : "Star"}
                      onClick={() => toggleStar(row.id)}
                      className={`rounded-lg p-2.5 transition-colors ${
                        isStarred
                          ? "bg-amber-500/15 text-app-accent"
                          : "bg-app-icon-btn-bg text-app-icon-btn-fg hover:bg-app-icon-btn-bg-hover hover:text-app-accent"
                      }`}
                    >
                      <Star
                        className={`h-5 w-5 ${isStarred ? "fill-amber-500 dark:fill-amber-400" : ""}`}
                        aria-hidden
                      />
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        show("Script step isn’t built yet — copy the hook and paste into your teleprompter.")
                      }
                      className="flex items-center gap-1.5 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[12px] font-bold text-app-on-amber-title transition-colors hover:bg-amber-500/15"
                    >
                      Use in script <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </main>
  );
}
