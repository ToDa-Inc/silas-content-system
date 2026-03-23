import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileText,
  Wand2,
} from "lucide-react";

const activity = [
  {
    id: "1",
    title: 'Draft Generated: "Sustainable Tech 2024"',
    time: "12 mins ago",
    body: "Intelligence agent matched 14 data points with the current context library.",
    icon: FileText,
    iconClass: "text-amber-500",
    tags: [
      { label: "PENDING REVIEW", className: "text-amber-500" },
      { label: "AGENT_04", className: "text-on-surface-variant" },
    ],
  },
  {
    id: "2",
    title: "Data Scrape Completed",
    time: "1 hour ago",
    body: "Successfully crawled 8 target domains. 1.2k new entries added to Context.",
    icon: Download,
    iconClass: "text-blue-400",
    tags: [{ label: "SUCCESS", className: "text-green-400" }],
  },
  {
    id: "3",
    title: "Prompt Rejection",
    time: "3 hours ago",
    body: "Conflict detected between Brand Guidelines and Request #882. Generation halted.",
    icon: AlertTriangle,
    iconClass: "text-red-400",
    tags: [{ label: "BLOCKED", className: "text-red-400" }],
    action: "VIEW CONFLICT",
  },
] as const;

export default function DashboardPage() {
  return (
    <main className="mx-auto max-w-7xl px-4 py-8 md:px-6">
      <header className="mb-10 flex flex-col justify-end gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-3xl font-extrabold tracking-tight text-on-surface md:text-4xl">
            System Overview
          </h1>
          <p className="max-w-md text-sm text-on-surface-variant">
            Real-time automation health and content generation orchestration.
          </p>
        </div>
        <div className="flex gap-3">
          <div className="flex items-center gap-2 rounded-lg border border-outline-variant/10 bg-surface-container px-4 py-2 text-xs font-medium text-on-surface-variant">
            <span className="h-2 w-2 rounded-full bg-green-500" />
            API Active
          </div>
        </div>
      </header>

      <div className="mb-8 flex flex-col gap-4 rounded-2xl border border-primary-container/20 bg-primary-container/10 p-4 glass-panel sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-4 sm:items-center">
          <div className="rounded-xl bg-primary-container p-2 text-on-primary-container">
            <AlertTriangle className="h-5 w-5" aria-hidden />
          </div>
          <div>
            <h3 className="font-bold text-primary-fixed-dim">Review Required</h3>
            <p className="text-sm text-on-surface-variant">
              There are{" "}
              <span className="font-semibold text-on-surface">3 reviews</span>{" "}
              pending your final approval before publication.
            </p>
          </div>
        </div>
        <Link
          href="/scheduling"
          className="shrink-0 rounded-lg bg-primary-container px-6 py-2 text-center text-sm font-bold text-on-primary-container transition-opacity hover:opacity-90 active:scale-[0.98]"
        >
          Open Queue
        </Link>
      </div>

      <div className="mb-12 grid grid-cols-1 gap-6 md:grid-cols-3">
        <div className="group relative overflow-hidden rounded-3xl bg-surface-container p-6">
          <div className="absolute right-0 top-0 h-32 w-32 opacity-5 blur-3xl transition-opacity group-hover:opacity-10 amber-gradient" />
          <div className="mb-4 flex justify-between">
            <span className="text-xs font-bold uppercase tracking-widest text-on-surface-variant">
              Scrape Efficiency
            </span>
            <span className="text-[10px] text-on-surface-variant">2h ago</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-5xl font-extrabold tracking-tighter text-on-surface">
              94.2%
            </span>
            <span className="text-xs font-bold text-green-400">+2.4%</span>
          </div>
          <div className="mt-6 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-amber-500" aria-hidden />
            <span className="text-xs text-on-surface-variant">
              12,402 sources indexed successfully
            </span>
          </div>
        </div>

        <div className="group relative overflow-hidden rounded-3xl bg-surface-container p-6">
          <div className="absolute right-0 top-0 h-32 w-32 bg-tertiary opacity-5 blur-3xl transition-opacity group-hover:opacity-10" />
          <div className="mb-4 flex justify-between">
            <span className="text-xs font-bold uppercase tracking-widest text-on-surface-variant">
              Generation Speed
            </span>
            <span className="text-[10px] text-on-surface-variant">5h ago</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-5xl font-extrabold tracking-tighter text-on-surface">
              1.8s
            </span>
            <span className="text-xs font-bold text-amber-400">Optimal</span>
          </div>
          <div className="mt-6 flex items-center gap-2">
            <span className="text-sm text-tertiary" aria-hidden>
              ⚡
            </span>
            <span className="text-xs text-on-surface-variant">
              Average latent response for GPT-4o cluster
            </span>
          </div>
        </div>

        <div className="rounded-3xl bg-surface-container p-6">
          <div className="mb-4 flex justify-between">
            <span className="text-xs font-bold uppercase tracking-widest text-on-surface-variant">
              Active Credits
            </span>
            <span className="text-[10px] text-on-surface-variant">Live</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-5xl font-extrabold tracking-tighter text-on-surface">
              42.8k
            </span>
          </div>
          <div className="mt-6">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-container-highest">
              <div className="h-full w-3/4 bg-amber-500" />
            </div>
            <div className="mt-2 flex justify-between">
              <span className="text-[10px] uppercase text-on-surface-variant">
                Current Usage
              </span>
              <span className="text-[10px] text-on-surface-variant">
                75% of limit
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-on-surface">Recent Activity</h2>
            <button
              type="button"
              className="text-sm font-semibold text-amber-500 hover:underline"
            >
              Export Logs
            </button>
          </div>
          <div className="space-y-1">
            {activity.map((item) => (
              <div
                key={item.id}
                className="flex items-start gap-4 rounded-2xl bg-surface-container p-4 transition-colors hover:bg-surface-container-high"
              >
                <div
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-800 ${item.iconClass}`}
                >
                  <item.icon className="h-5 w-5" aria-hidden />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap justify-between gap-2">
                    <h4 className="text-sm font-bold text-on-surface">
                      {item.title}
                    </h4>
                    <span className="text-[10px] text-on-surface-variant">
                      {item.time}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-on-surface-variant">{item.body}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {item.tags.map((t) => (
                      <span
                        key={t.label}
                        className={`rounded bg-surface-container-highest px-2 py-0.5 text-[10px] font-bold ${t.className}`}
                      >
                        {t.label}
                      </span>
                    ))}
                    {"action" in item && item.action ? (
                      <button
                        type="button"
                        className="ml-auto text-[10px] font-bold text-amber-500 underline"
                      >
                        {item.action}
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-6">
          <h2 className="text-xl font-bold text-on-surface">Intelligence Context</h2>
          <div className="space-y-6 rounded-3xl border border-outline-variant/5 bg-surface-container p-6">
            <div className="space-y-2">
              <label className="text-[10px] font-extrabold uppercase tracking-widest text-on-surface-variant">
                Active Focus
              </label>
              <div className="flex flex-wrap gap-2">
                <span className="rounded-full border border-amber-500/20 bg-surface-container-highest px-3 py-1 text-xs text-on-surface">
                  FinTech
                </span>
                <span className="rounded-full border border-outline-variant/10 bg-surface-container-highest px-3 py-1 text-xs text-on-surface-variant">
                  SaaS Patterns
                </span>
                <span className="rounded-full border border-outline-variant/10 bg-surface-container-highest px-3 py-1 text-xs text-on-surface-variant">
                  AI Ethics
                </span>
              </div>
            </div>
            <div className="space-y-4">
              <label className="text-[10px] font-extrabold uppercase tracking-widest text-on-surface-variant">
                Knowledge Clusters
              </label>
              <div className="flex items-center gap-4">
                <div className="h-12 w-1.5 rounded-full bg-amber-500" />
                <div>
                  <div className="text-sm font-bold text-on-surface">
                    Marketing Automation
                  </div>
                  <div className="text-[10px] text-on-surface-variant">
                    8,421 Related Entities
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="h-12 w-1.5 rounded-full bg-zinc-700" />
                <div>
                  <div className="text-sm font-bold text-on-surface">
                    Global Logistics
                  </div>
                  <div className="text-[10px] text-on-surface-variant">
                    2,109 Related Entities
                  </div>
                </div>
              </div>
            </div>
            <button
              type="button"
              className="w-full rounded-xl border border-outline-variant/10 bg-surface-container-high py-3 text-sm font-bold transition-colors hover:bg-surface-bright"
            >
              Update Context Library
            </button>
          </div>

          <div className="amber-gradient relative overflow-hidden rounded-3xl p-6 text-on-primary">
            <Wand2
              className="pointer-events-none absolute -bottom-4 -right-4 h-24 w-24 opacity-10"
              aria-hidden
            />
            <h4 className="mb-2 text-lg font-extrabold leading-tight">
              Unlock Advanced Models
            </h4>
            <p className="mb-4 text-xs opacity-90">
              Integrate Claude 3.5 Sonnet and custom GPT fine-tunes into your workflow.
            </p>
            <button
              type="button"
              className="rounded-lg bg-white/20 px-4 py-2 text-xs font-bold backdrop-blur-md transition-all hover:bg-white/30"
            >
              Upgrade Now
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
