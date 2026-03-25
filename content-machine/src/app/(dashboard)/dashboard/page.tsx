import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileText,
  Wand2,
  Zap,
} from "lucide-react";
import {
  DashboardContextRefreshButton,
  DashboardExportLogsButton,
  DashboardUpgradeCta,
  DashboardViewConflictButton,
} from "./dashboard-actions";

const activity = [
  {
    id: "1",
    title: 'Draft Generated: "Sustainable Tech 2024"',
    time: "12 mins ago",
    body: "Intelligence agent matched 14 data points with the current context library.",
    icon: FileText,
    iconClass: "text-amber-400",
    tags: [
      { label: "Pending review", className: "text-amber-400" },
      { label: "Agent 04", className: "text-zinc-500" },
    ],
  },
  {
    id: "2",
    title: "Data scrape completed",
    time: "1 hour ago",
    body: "Successfully crawled 8 target domains. 1.2k new entries added to context.",
    icon: Download,
    iconClass: "text-teal-400",
    tags: [{ label: "Success", className: "text-emerald-400" }],
  },
  {
    id: "3",
    title: "Prompt rejection",
    time: "3 hours ago",
    body: "Conflict detected between brand guidelines and request #882. Generation halted.",
    icon: AlertTriangle,
    iconClass: "text-rose-400",
    tags: [{ label: "Blocked", className: "text-rose-400" }],
    hasConflictAction: true,
  },
] as const;

export default function DashboardPage() {
  return (
    <main className="mx-auto max-w-7xl px-4 py-8 md:px-6">
      <header className="mb-8 flex flex-col justify-end gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-lg font-semibold text-app-fg">
            What needs you
          </h1>
          <p className="max-w-md text-xs text-app-fg-muted">
            Pipeline health and actions that unblock publishing.
          </p>
        </div>
        <div className="glass-pill flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-medium text-app-fg-muted">
          <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]" />
          API reachable
        </div>
      </header>

      <div className="glass glass-strong mb-8 flex flex-col gap-4 rounded-2xl border border-amber-500/25 bg-amber-500/[0.07] p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-4 sm:items-center">
          <div className="rounded-xl bg-amber-500 p-2 text-zinc-950">
            <AlertTriangle className="h-5 w-5" aria-hidden />
          </div>
          <div>
            <h3 className="font-semibold text-app-on-amber-title">Review required</h3>
            <p className="text-sm text-app-on-amber-body">
              There are{" "}
              <span className="font-semibold text-app-on-amber-emphasis">3 reviews</span>{" "}
              pending before anything can go live.
            </p>
          </div>
        </div>
        <Link
          href="/scheduling"
          className="shrink-0 rounded-lg bg-amber-500 px-6 py-2 text-center text-sm font-bold text-zinc-950 transition-opacity hover:opacity-90 active:scale-[0.98]"
        >
          Open queue
        </Link>
      </div>

      <div className="mb-12 grid grid-cols-1 gap-6 md:grid-cols-3">
        <div className="glass group relative overflow-hidden rounded-2xl p-6 transition-colors hover:bg-zinc-100/70 dark:hover:bg-white/[0.05]">
          <div className="absolute right-0 top-0 h-32 w-32 opacity-[0.07] blur-3xl transition-opacity group-hover:opacity-[0.12] amber-gradient" />
          <div className="relative mb-4 flex justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-app-fg-subtle">
              Scrape efficiency
            </span>
            <span className="text-[10px] text-app-fg-subtle">2h ago</span>
          </div>
          <div className="relative flex items-baseline gap-2">
            <span className="text-3xl font-semibold tabular-nums text-app-fg">
              94.2%
            </span>
            <span className="text-[11px] font-medium text-emerald-400">+2.4%</span>
          </div>
          <div className="relative mt-6 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-amber-400" aria-hidden />
            <span className="text-xs text-app-fg-muted">
              12,402 sources indexed successfully
            </span>
          </div>
        </div>

        <div className="glass group relative overflow-hidden rounded-2xl p-6 transition-colors hover:bg-zinc-100/70 dark:hover:bg-white/[0.05]">
          <div className="absolute right-0 top-0 h-32 w-32 bg-teal-400 opacity-[0.06] blur-3xl transition-opacity group-hover:opacity-[0.1]" />
          <div className="relative mb-4 flex justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-app-fg-subtle">
              Generation speed
            </span>
            <span className="text-[10px] text-app-fg-subtle">5h ago</span>
          </div>
          <div className="relative flex items-baseline gap-2">
            <span className="text-3xl font-semibold tabular-nums text-app-fg">
              1.8s
            </span>
            <span className="text-[11px] font-medium text-amber-400">Optimal</span>
          </div>
          <div className="relative mt-6 flex items-center gap-2">
            <Zap className="h-4 w-4 text-teal-400" aria-hidden />
            <span className="text-xs text-app-fg-muted">
              Average response time for your model cluster
            </span>
          </div>
        </div>

        <div className="glass rounded-2xl p-6 transition-colors hover:bg-zinc-100/70 dark:hover:bg-white/[0.05]">
          <div className="mb-4 flex justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-app-fg-subtle">
              Active credits
            </span>
            <span className="text-[10px] text-app-fg-subtle">Live</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-semibold tabular-nums text-app-fg">
              42.8k
            </span>
          </div>
          <div className="mt-6">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/20 dark:bg-black/30">
              <div className="h-full w-3/4 rounded-full bg-amber-500" />
            </div>
            <div className="mt-2 flex justify-between">
              <span className="text-[10px] uppercase tracking-wide text-app-fg-subtle">
                Current usage
              </span>
              <span className="text-[10px] text-app-fg-subtle">75% of limit</span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-app-fg">Recent activity</h2>
            <DashboardExportLogsButton />
          </div>
          <div className="space-y-2">
            {activity.map((item) => (
              <div
                key={item.id}
                className="glass flex items-start gap-4 rounded-2xl p-4 transition-colors hover:bg-zinc-100/70 dark:hover:bg-white/[0.04]"
              >
                <div
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-app-icon-btn-bg ${item.iconClass}`}
                >
                  <item.icon className="h-5 w-5" aria-hidden />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap justify-between gap-2">
                    <h4 className="text-sm font-semibold text-app-fg">
                      {item.title}
                    </h4>
                    <span className="text-[10px] text-app-fg-subtle">{item.time}</span>
                  </div>
                  <p className="mt-1 text-xs text-app-fg-muted">{item.body}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {item.tags.map((t) => (
                      <span
                        key={t.label}
                        className={`rounded-md bg-app-chip-bg px-2 py-0.5 text-[10px] font-semibold ${t.className}`}
                      >
                        {t.label}
                      </span>
                    ))}
                    {"hasConflictAction" in item && item.hasConflictAction ? (
                      <DashboardViewConflictButton />
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-6">
          <h2 className="text-sm font-semibold text-app-fg">Context focus</h2>
          <div className="glass space-y-6 rounded-2xl p-6">
            <div className="space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-app-fg-subtle">
                Active focus
              </p>
              <div className="flex flex-wrap gap-2">
                <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs text-app-on-amber-title">
                  FinTech
                </span>
                <span className="rounded-full border border-app-card-border bg-app-chip-bg px-3 py-1 text-xs text-app-fg-secondary">
                  SaaS patterns
                </span>
                <span className="rounded-full border border-app-card-border bg-app-chip-bg px-3 py-1 text-xs text-app-fg-secondary">
                  AI ethics
                </span>
              </div>
            </div>
            <div className="space-y-4">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-app-fg-subtle">
                Knowledge clusters
              </p>
              <div className="flex items-center gap-4">
                <div className="h-12 w-1.5 rounded-full bg-amber-500" />
                <div>
                  <div className="text-sm font-semibold text-app-fg">
                    Marketing automation
                  </div>
                  <div className="text-[10px] text-app-fg-muted">
                    8,421 related entities
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="h-12 w-1.5 rounded-full bg-zinc-600" />
                <div>
                  <div className="text-sm font-semibold text-app-fg">
                    Global logistics
                  </div>
                  <div className="text-[10px] text-app-fg-muted">
                    2,109 related entities
                  </div>
                </div>
              </div>
            </div>
            <DashboardContextRefreshButton />
          </div>

          <div className="amber-gradient relative overflow-hidden rounded-2xl p-6 text-zinc-950">
            <Wand2
              className="pointer-events-none absolute -bottom-4 -right-4 h-24 w-24 opacity-10"
              aria-hidden
            />
            <h4 className="mb-1.5 text-sm font-semibold leading-snug">
              Advanced models
            </h4>
            <p className="mb-3 text-[11px] opacity-90">
              Claude and custom fine-tunes will plug in here when billing is ready.
            </p>
            <DashboardUpgradeCta />
          </div>
        </div>
      </div>
    </main>
  );
}
