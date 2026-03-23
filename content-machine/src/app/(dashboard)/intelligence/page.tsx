import Image from "next/image";
import Link from "next/link";
import {
  BarChart3,
  ChevronRight,
  Heart,
  ListFilter,
  MessageCircle,
  Sparkles,
} from "lucide-react";

const rows = [
  {
    id: "1",
    label: "Hook Alpha",
    title: '"Stop building features, start..."',
    outlier: "12.1x",
    pattern: "Pattern: Cognitive Dissonance",
    thumb:
      "https://lh3.googleusercontent.com/aida-public/AB6AXuA41Zy_xJm1DAPn9PC6aROKJP0rI935PCaZMjdVxEAcNm8IxFzFrkxZBX2r0FGscJ8SJnZCJB8gCgO7aARREYdQqiAZwuFFWZ6CqDP0hgYjIyiyf6oWOnYcRkNPVF5XJP92vrsv6C8esJfjdEtNQoYl4ct-3cLLlwnzefIJwgdez_PpSYo5BrGEMivgAJ66jD-8ORe4tsV0MEBgVNLDVURq8M838trE4W6zV7l-fcKNKuGxW7-b6NbLsZ2gwtnG3f_C9lHVxkhyZvk-",
  },
  {
    id: "2",
    label: "Hook Beta",
    title: '"Most UI designers are making this..."',
    outlier: "7.8x",
    pattern: "Pattern: Negative Constraint",
    thumb:
      "https://lh3.googleusercontent.com/aida-public/AB6AXuBw8x3J-iyvqxfQDeYgI4HWsv54iA8kmUQGiOV-PF8u1fCKgqLCBLao_vj3DcHOgKdGRXHiiiun4Z4hLTFNxO2-o5Pd8D0Vjg0oxw51oRcrm4h0aTsaJbOVKuea4Eq7ayyrm4hjJ5qpSsQRS1LPUZEcJPAGiYNkpzWUmlh4ryOSTla65kuBFEV9XXzE6C3WbwMamynDEjiMZkHiB6qnYRUayKEURGKYvEOkk5U4uFQXHHXAaM_BOciAZx2NLIlU-gj37uZ5YetyuIH",
  },
  {
    id: "3",
    label: "Hook Gamma",
    title: '"Why 99% of startups fail at launch"',
    outlier: "5.2x",
    pattern: "Pattern: Statistics Anchoring",
    thumb:
      "https://lh3.googleusercontent.com/aida-public/AB6AXuA0c5Aef0Tyqm2VkkrcpjEBtdA2y9U3oLI7C5BIx4sS9pCubiBB0roPNlMcNN9zUIy7IF1r18f9MzzQBC6i2rD3tAXp4fWDxzgKBzEtLBRq8kutIvqp0gauFrPsOdzys6X-rLLeVytJyjCbBjupq_HDeGPVepbLjskLw8CZPf5zx5l0ex-Ub1ys8FGr2nycgREU9mAoKFtHHMOTjsAZ-KKOUOkMaxDyZDXpHItsmWuXUoNfsJqaqCmVHK0eLjihLk4TUrHR4Dcq5PMC",
  },
];

export default function IntelligencePage() {
  return (
    <main className="mx-auto max-w-[1400px] px-4 py-8 md:px-8">
      <header className="mb-10 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <nav className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
            <span>Intelligence</span>
            <ChevronRight className="h-3 w-3" aria-hidden />
            <span className="text-primary">Viral Feed</span>
          </nav>
          <h2 className="text-4xl font-extrabold leading-none tracking-tighter text-on-surface md:text-5xl lg:text-6xl">
            The Luminous Feed.
          </h2>
        </div>
        <div className="flex flex-wrap gap-4">
          <div className="flex items-center gap-3 rounded-lg bg-surface-container-high px-4 py-2">
            <span className="text-xs font-medium text-zinc-500">Outlier Threshold</span>
            <span className="font-bold text-primary">3.5x</span>
          </div>
          <button
            type="button"
            className="flex items-center gap-2 rounded-lg border border-outline-variant/10 bg-surface-bright px-6 py-2 text-sm font-semibold"
          >
            <ListFilter className="h-4 w-4" aria-hidden />
            Refine Signal
          </button>
        </div>
      </header>

      <section className="mb-12 grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="relative col-span-1 overflow-hidden rounded-xl bg-surface-container lg:col-span-4">
          <div className="relative aspect-[9/16] max-h-[520px] bg-zinc-900">
            <Image
              src="https://lh3.googleusercontent.com/aida-public/AB6AXuCVHRlC1M24rc2g0Bn-Vm0IpkNy97krpoeWZXk7Emnh9CNYH8LfPDwpGq0RcY8NdxTuOdJht1gnSk7c6oU85HLojklYZySijtDRNADcDOzY-uJCxWT8xgocNw7eltt0_8eCxmJA7aJch_78tPYyN14mRWzkuH9oup1PiTrJ1CeUy3f2r_AoqasyrPzIibBEkLw4LPmfA64kzoXSo2igH6UePU3nx-H-otg4Z0XfdnlqohSdxONfVjV-rP9gUohVLMimpLnxu-O3ht9P"
              alt=""
              fill
              className="object-cover opacity-60"
              sizes="(max-width: 1024px) 100vw, 33vw"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
            <div className="absolute inset-x-4 bottom-6 space-y-3">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 overflow-hidden rounded-full border border-white/20 bg-zinc-400">
                  <Image
                    src="https://lh3.googleusercontent.com/aida-public/AB6AXuBs6CeSyQsshmhGlZMwP88rT91bqwv04_e-jPWSZRxeT94RQrhStWM-MENN3MU_ApjPDxYs-AKfavNAbtV005X_0UJRPlWlir0_qjXuXNuKFcWVdFfTTd0nUIZnxOGNC1rq3AUei7w3WnMWhKlXzALnYVZHcbmEfKoOEwQCHLAm70ebxMmwcZE6RHkG_zYufJIybic4BbVe7AH5M4TVE-Hu5N6K2vZY6vY_-FVshpjrQBo27hTeU_0dgNmcCKc6MfWvIGE0UAFW-9xg"
                    alt=""
                    width={32}
                    height={32}
                    className="h-full w-full object-cover"
                  />
                </div>
                <span className="text-xs font-bold text-white">@neuro_growth</span>
              </div>
              <p className="line-clamp-2 text-xs text-white/90">
                The psychological reason your hooks are failing in the first 0.5 seconds of viewing...
              </p>
              <div className="flex gap-3 text-[10px] text-white/60">
                <span className="flex items-center gap-1">
                  <Heart className="h-3 w-3" aria-hidden /> 42.1k
                </span>
                <span className="flex items-center gap-1">
                  <MessageCircle className="h-3 w-3" aria-hidden /> 1.2k
                </span>
              </div>
            </div>
          </div>
          <div className="absolute right-4 top-4 rounded-full bg-primary-container/90 px-3 py-1 text-[10px] font-extrabold text-on-primary-container backdrop-blur-md">
            OUTLIER: 8.4X
          </div>
        </div>

        <div className="col-span-1 space-y-6 lg:col-span-8">
          <div className="rounded-xl bg-surface-container p-6 md:p-8">
            <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
              <h3 className="text-xl font-bold tracking-tight text-on-surface">
                Emerging Patterns
              </h3>
              <span className="rounded-full bg-surface-container-high px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-zinc-400">
                24H Window
              </span>
            </div>
            <div className="space-y-4">
              {rows.map((row) => (
                <div
                  key={row.id}
                  className="group grid cursor-pointer grid-cols-1 items-center gap-4 rounded-xl bg-surface-container-low p-4 transition-colors hover:border hover:border-outline-variant/10 hover:bg-surface-container-high md:grid-cols-12"
                >
                  <div className="flex items-center gap-4 md:col-span-5">
                    <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-zinc-800">
                      <Image
                        src={row.thumb}
                        alt=""
                        fill
                        className="object-cover"
                        sizes="48px"
                      />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[11px] font-bold uppercase tracking-tighter text-zinc-500">
                        {row.label}
                      </p>
                      <h4 className="text-sm font-semibold text-on-surface">{row.title}</h4>
                    </div>
                  </div>
                  <div className="text-center md:col-span-2">
                    <p className="mb-1 text-[10px] text-zinc-500">Outlier Ratio</p>
                    <span className="text-lg font-bold text-amber-400">{row.outlier}</span>
                  </div>
                  <div className="md:col-span-3">
                    <p className="mb-1 text-[10px] uppercase tracking-widest text-zinc-500">
                      AI Analysis
                    </p>
                    <div className="flex items-center gap-1">
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                      <span className="truncate text-[11px] font-medium text-on-surface">
                        {row.pattern}
                      </span>
                    </div>
                  </div>
                  <div className="flex justify-end md:col-span-2">
                    <button
                      type="button"
                      className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-800 transition-colors group-hover:bg-primary-container"
                      aria-label="Open"
                    >
                      <ChevronRight className="h-4 w-4 text-on-surface group-hover:text-on-primary-container" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="relative overflow-hidden rounded-xl border border-primary/10 bg-primary-container/5 p-8">
            <div className="absolute -right-32 -top-32 h-64 w-64 bg-primary/5 blur-[80px]" />
            <div className="relative flex flex-col gap-8 sm:flex-row">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary-container text-on-primary-container">
                <Sparkles className="h-6 w-6" aria-hidden />
              </div>
              <div className="space-y-4">
                <h3 className="text-lg font-bold text-on-surface">Intelligence Breakdown</h3>
                <p className="max-w-xl text-sm leading-relaxed text-zinc-400">
                  Content tagged with{" "}
                  <span className="font-semibold text-primary">Cognitive Dissonance</span> is
                  currently outperforming the niche average by 412%. High-velocity thumbnails
                  featuring monochrome backgrounds with high-contrast amber text overlays show the
                  strongest retention rates.
                </p>
                <div className="flex flex-wrap gap-6 pt-2">
                  <div>
                    <span className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                      Suggested Hook
                    </span>
                    <p className="rounded bg-surface-container px-3 py-1 font-mono text-xs">
                      &quot;Everything you know about [X] is wrong.&quot;
                    </p>
                  </div>
                  <div>
                    <span className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                      Visual Weight
                    </span>
                    <p className="rounded bg-surface-container px-3 py-1 font-mono text-xs">
                      Heavy Left Alignment
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mt-16 md:mt-20">
        <h3 className="mb-8 text-2xl font-extrabold tracking-tight text-on-surface">
          Content Trajectories.
        </h3>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-outline-variant/5 bg-surface-container-low p-6">
            <div className="mb-6 flex justify-between">
              <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                Growth Velocity
              </span>
              <span className="text-xs font-bold text-emerald-400">+24%</span>
            </div>
            <div className="mb-4 flex h-16 items-end gap-1">
              {[30, 45, 35, 60, 50, 85, 100].map((h, i) => (
                <div
                  key={i}
                  className={`flex-1 rounded-sm ${i >= 5 ? "bg-primary" : "bg-zinc-800"}`}
                  style={{ height: `${h}%` }}
                />
              ))}
            </div>
            <p className="mb-1 text-sm font-semibold text-on-surface">Direct Response</p>
            <p className="text-[11px] italic text-zinc-500">Trending upward in Tier 1 regions</p>
          </div>

          <div className="rounded-xl border border-outline-variant/5 bg-surface-container-low p-6">
            <div className="mb-6 flex justify-between">
              <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                Retention Arc
              </span>
              <span className="text-xs font-bold text-primary">Stable</span>
            </div>
            <div className="mb-4 flex h-16 items-center justify-center">
              <BarChart3 className="h-10 w-10 text-zinc-700" aria-hidden />
            </div>
            <p className="mb-1 text-sm font-semibold text-on-surface">Narrative Bridge</p>
            <p className="text-[11px] italic text-zinc-500">Drop-off occurs at 0:12 mark</p>
          </div>

          <div className="rounded-xl border border-outline-variant/5 bg-surface-container-low p-6">
            <div className="mb-6 flex justify-between">
              <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                Sentiment
              </span>
              <span className="text-xs font-bold text-primary">92%</span>
            </div>
            <div className="mb-4 flex h-16 items-center justify-center text-4xl text-zinc-700">
              🙂
            </div>
            <p className="mb-1 text-sm font-semibold text-on-surface">Trust Score</p>
            <p className="text-[11px] italic text-zinc-500">
              Authority-based content peaking
            </p>
          </div>

          <div className="flex flex-col justify-between rounded-xl bg-primary-container p-6">
            <p className="text-xs font-extrabold uppercase tracking-widest text-on-primary-container">
              Actionable
            </p>
            <h4 className="font-bold leading-tight text-on-primary-container">
              Generate script based on this signal?
            </h4>
            <Link
              href="/generate"
              className="mt-4 w-full rounded-lg bg-on-primary-container py-2 text-center text-xs font-bold uppercase text-primary-container transition-opacity hover:opacity-90"
            >
              Initialize Factory
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
