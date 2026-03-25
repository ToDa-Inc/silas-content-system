import Link from "next/link";
import { ReelThumbnail } from "@/components/reel-thumbnail";
import { fetchScrapedReels, getCachedServerApiContext, type ScrapedReelRow } from "@/lib/api";

type PageProps = {
  searchParams: Promise<{ outliers?: string }>;
};

function formatPosted(d: string | null | undefined): string {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return "—";
  }
}

export default async function IntelligenceReelsPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const outliersOnly = sp.outliers === "1" || sp.outliers === "true";

  await getCachedServerApiContext();
  const reelsRes = await fetchScrapedReels(false);

  const reelsAll = reelsRes.ok ? reelsRes.data : [];
  const rows: ScrapedReelRow[] = outliersOnly
    ? reelsAll.filter((r) => r.is_outlier === true)
    : reelsAll;

  return (
    <main className="mx-auto max-w-[1200px] px-4 py-8 md:px-8">
      <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Link
            href="/intelligence"
            className="font-medium text-app-fg-muted transition-colors hover:text-amber-400"
          >
            ← Intelligence
          </Link>
          <span className="text-zinc-400 dark:text-zinc-600">|</span>
          <span className="font-semibold text-app-fg">Reels</span>
        </div>
        <div className="flex gap-2 text-xs">
          <Link
            href="/intelligence/reels"
            className={
              !outliersOnly
                ? "rounded-lg bg-zinc-200 px-3 py-1.5 font-semibold text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
                : "rounded-lg px-3 py-1.5 text-app-fg-muted hover:bg-zinc-200 dark:hover:bg-zinc-800"
            }
          >
            All
          </Link>
          <Link
            href="/intelligence/reels?outliers=1"
            className={
              outliersOnly
                ? "rounded-lg bg-amber-500/20 px-3 py-1.5 font-semibold text-amber-700 dark:text-amber-400"
                : "rounded-lg px-3 py-1.5 text-app-fg-muted hover:bg-zinc-200 dark:hover:bg-zinc-800"
            }
          >
            Outliers only
          </Link>
        </div>
      </header>

      {!reelsRes.ok ? (
        <p className="text-sm text-app-fg-muted">Couldn&apos;t load reels. Try again later.</p>
      ) : rows.length === 0 ? (
        <div className="glass rounded-xl px-6 py-12 text-center">
          <p className="text-sm text-app-fg-muted">
            No reels scraped yet. Go back to Intelligence and run a sync.
          </p>
          <Link
            href="/intelligence"
            className="mt-4 inline-block text-sm font-semibold text-amber-400 hover:underline"
          >
            ← Intelligence
          </Link>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left">
            <thead>
              <tr className="text-[10px] uppercase tracking-widest text-app-fg-subtle">
                <th className="pb-3 pr-2 font-medium">#</th>
                <th className="pb-3 pr-2 font-medium">Thumbnail</th>
                <th className="pb-3 pr-2 font-medium">Account</th>
                <th className="pb-3 pr-2 font-medium">Views</th>
                <th className="pb-3 pr-2 font-medium">×Baseline</th>
                <th className="pb-3 pr-2 font-medium">Likes</th>
                <th className="pb-3 pr-2 font-medium">Comments</th>
                <th className="pb-3 pr-2 font-medium">Date</th>
                <th className="pb-3 font-medium">Link</th>
              </tr>
            </thead>
            <tbody className="text-xs text-app-fg-secondary">
              {rows.map((row, i) => (
                <tr
                  key={row.id}
                  className="transition-colors hover:bg-zinc-100 dark:hover:bg-white/[0.06]"
                >
                  <td className="py-2.5 pr-2 align-middle tabular-nums text-app-fg-subtle">{i + 1}</td>
                  <td className="py-2.5 pr-2 align-middle">
                    <ReelThumbnail
                      src={row.thumbnail_url}
                      alt={`@${row.account_username} reel`}
                      href={row.post_url}
                      size="sm"
                    />
                  </td>
                  <td className="py-2.5 pr-2 align-middle font-medium">@{row.account_username}</td>
                  <td className="py-2.5 pr-2 align-middle tabular-nums">
                    {row.views != null ? row.views.toLocaleString() : "—"}
                  </td>
                  <td
                    className={
                      row.is_outlier === true
                        ? "py-2.5 pr-2 align-middle font-bold text-amber-400"
                        : "py-2.5 pr-2 align-middle text-app-fg-faint"
                    }
                  >
                    {row.outlier_ratio != null ? `${Number(row.outlier_ratio).toFixed(1)}×` : "—"}
                  </td>
                  <td className="py-2.5 pr-2 align-middle tabular-nums">
                    {row.likes != null ? row.likes.toLocaleString() : "—"}
                  </td>
                  <td className="py-2.5 pr-2 align-middle tabular-nums">
                    {row.comments != null ? row.comments.toLocaleString() : "—"}
                  </td>
                  <td className="py-2.5 pr-2 align-middle">{formatPosted(row.posted_at)}</td>
                  <td className="py-2.5 align-middle">
                    {row.post_url ? (
                      <a
                        href={row.post_url}
                        target="_blank"
                        rel="noreferrer"
                        className="font-semibold text-amber-400 hover:underline"
                      >
                        ↗
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
