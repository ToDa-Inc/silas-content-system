"use client";

import { useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Brain,
  Copy,
  MessageCircle,
  Sparkles,
  Star,
  Zap,
} from "lucide-react";

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

const hooks = [
  "Stop wasting hours on manual formatting when these 3 automation secrets can do it for you in seconds.",
  "Most founders fail because they ignore this one critical metric in their first six months of operation.",
  "The algorithm changed again — here is the only framework that still scales organic reach in 2026.",
  "If your hooks feel \"random\", you are missing this single pattern every 1M+ view account uses.",
];

export default function GeneratePage() {
  const [tone, setTone] = useState<string>("authoritative");

  return (
    <main className="mx-auto max-w-[1400px] p-4 pb-16 pt-6 md:p-8 md:pt-10 lg:p-12">
      <header className="mb-12 md:mb-16">
        <span className="mb-2 block text-[10px] font-bold uppercase tracking-widest text-primary">
          Content Engine v2.0
        </span>
        <h1 className="mb-4 max-w-2xl text-4xl font-extrabold leading-[1.1] tracking-tighter text-zinc-50 md:text-5xl lg:text-6xl">
          Hook Architecture.
        </h1>
        <p className="max-w-lg text-lg leading-relaxed text-zinc-500">
          Transforming core concepts into high-retention opening lines. Generate,
          refine, and deploy across all channels.
        </p>
      </header>

      <div className="flex flex-col items-start gap-12 lg:flex-row">
        <section className="sticky top-24 w-full space-y-10 lg:w-[400px]">
          <div className="space-y-6">
            <div className="space-y-2">
              <label className="ml-1 text-xs font-bold uppercase tracking-widest text-zinc-400">
                Content Niche
              </label>
              <div className="relative">
                <select
                  className="w-full appearance-none rounded-xl border-none bg-surface-container-high py-4 pl-5 pr-12 text-on-surface transition-all focus:ring-1 focus:ring-primary/20"
                  defaultValue={niches[0]}
                >
                  {niches.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
                <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500">
                  ▼
                </span>
              </div>
            </div>

            <div className="space-y-4">
              <label className="ml-1 text-xs font-bold uppercase tracking-widest text-zinc-400">
                Tone & Voice
              </label>
              <div className="grid grid-cols-2 gap-3">
                {tones.map(({ id, label, icon: Icon }) => {
                  const active = tone === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setTone(id)}
                      className={`flex items-center gap-3 rounded-xl p-4 text-sm font-semibold transition-all ${
                        active
                          ? "border border-primary/20 bg-surface-container-high text-primary"
                          : "bg-surface-container-low text-zinc-400 hover:bg-surface-container-high"
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
              <label className="ml-1 text-xs font-bold uppercase tracking-widest text-zinc-400">
                Context / Topic
              </label>
              <textarea
                rows={4}
                placeholder="What is this content about?"
                className="w-full rounded-xl border-none bg-surface-container-high p-5 text-on-surface placeholder:text-zinc-600 focus:ring-1 focus:ring-primary/20"
              />
            </div>
          </div>

          <button
            type="button"
            className="flex w-full items-center justify-center gap-3 rounded-xl bg-primary-container py-5 text-sm font-extrabold uppercase tracking-[0.2em] text-on-primary-container shadow-xl shadow-amber-900/10 transition-all hover:scale-[1.02] active:scale-95"
          >
            Generate Hooks <Sparkles className="h-4 w-4" aria-hidden />
          </button>

          <div className="flex items-center gap-3 px-2">
            <div className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
            <span className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
              System ready for inference
            </span>
          </div>
        </section>

        <section className="w-full flex-1 space-y-6">
          <div className="mb-8 flex flex-col gap-4 border-b border-zinc-800/20 pb-4 sm:flex-row sm:items-center sm:justify-between">
            <h3 className="text-sm font-bold uppercase tracking-[0.2em] text-zinc-400">
              Generated Output ({hooks.length})
            </h3>
            <div className="flex gap-2">
              <button
                type="button"
                className="rounded-full bg-surface-container-high px-4 py-2 text-[11px] font-bold text-zinc-400 transition-colors hover:text-zinc-200"
              >
                EXPORT ALL
              </button>
              <button
                type="button"
                className="rounded-full bg-surface-container-high px-4 py-2 text-[11px] font-bold text-zinc-400 transition-colors hover:text-zinc-200"
              >
                REFRESH
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4">
            {hooks.map((text, i) => (
              <div
                key={i}
                className="glass-card group flex flex-col justify-between gap-6 rounded-2xl p-6 transition-all hover:bg-surface-container-high md:flex-row md:items-center"
              >
                <p className="flex-1 text-[15px] font-normal leading-relaxed text-zinc-200">
                  {text}
                </p>
                <div className="flex items-center gap-2 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100">
                  <button
                    type="button"
                    title="Copy"
                    className="rounded-lg bg-surface-container-highest p-2.5 text-zinc-400 transition-colors hover:text-primary"
                  >
                    <Copy className="h-5 w-5" aria-hidden />
                  </button>
                  <button
                    type="button"
                    title="Save"
                    className="rounded-lg bg-surface-container-highest p-2.5 text-zinc-400 transition-colors hover:text-amber-400"
                  >
                    <Star className="h-5 w-5" aria-hidden />
                  </button>
                  <button
                    type="button"
                    className="flex items-center gap-2 rounded-lg bg-primary-container/10 px-4 py-2.5 text-[12px] font-bold text-primary transition-all hover:bg-primary-container/20"
                  >
                    USE IN SCRIPT <ArrowRight className="h-4 w-4" aria-hidden />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
