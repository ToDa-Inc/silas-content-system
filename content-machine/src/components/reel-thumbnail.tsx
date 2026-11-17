"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";

type Size = "sm" | "md" | "lg";

/** Same-origin proxy: IG signed URLs 403 if stripped; browser embed is flaky. */
function thumbnailImgSrc(raw: string): string {
  const t = raw.trim();
  try {
    const u = new URL(t);
    const h = u.hostname.toLowerCase();
    if (h.endsWith(".cdninstagram.com") || h.endsWith(".fbcdn.net")) {
      return `/api/thumbnail-proxy?url=${encodeURIComponent(t)}`;
    }
  } catch {
    /* fall through */
  }
  return t;
}

type Props = {
  /** Instagram / CDN URL from `thumbnail_url` (Apify `displayUrl` / `thumbnailUrl`). */
  src: string | null | undefined;
  alt?: string;
  /** When set, the whole thumb is a link (e.g. `post_url`). */
  href?: string | null;
  size?: Size;
  className?: string;
};

const dim: Record<Size, string> = {
  sm: "h-12 w-8 rounded",
  md: "h-24 w-16 rounded-lg",
  /** ~9:16 cover at readable size (Generate reference preview). */
  lg: "h-40 w-[90px] rounded-xl",
};

export function ReelThumbnail({ src, alt = "Reel thumbnail", href, size = "md", className }: Props) {
  /** Which `url` last fired onError — avoids an effect when the thumbnail URL changes. */
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  /** Which `url` finished loading — drives the placeholder shimmer. */
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);

  const url = src?.trim() ?? "";
  const imgBroken = failedUrl === url && url.length > 0;
  const imgLoaded = loadedUrl === url;

  const empty = (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center bg-zinc-800 font-medium text-app-fg-faint",
        dim[size],
        size === "sm" ? "text-[8px]" : "text-[10px]",
        className,
      )}
    >
      {size === "sm" ? "—" : "Reel"}
    </div>
  );

  const link = href?.trim();

  const imgSrc = useMemo(() => (url ? thumbnailImgSrc(url) : ""), [url]);

  if (!url || imgBroken) {
    return empty;
  }

  const shell = cn(
    "group relative isolate shrink-0 overflow-hidden bg-zinc-900 shadow-md ring-1 ring-black/[0.08] transition duration-300 ease-out",
    "hover:-translate-y-0.5 hover:shadow-xl hover:shadow-black/25 hover:ring-amber-400/45",
    "dark:shadow-black/50 dark:ring-white/[0.12] dark:hover:shadow-black/70",
    dim[size],
    className,
  );

  const body = (
    <>
      {imgLoaded ? null : (
        <span
          className="absolute inset-0 animate-pulse bg-zinc-200 dark:bg-zinc-800"
          aria-hidden
        />
      )}
      {/* eslint-disable-next-line @next/next/no-img-element -- IG via /api/thumbnail-proxy or other CDNs */}
      <img
        ref={(el) => {
          // Cached images can finish before React attaches onLoad.
          if (el?.complete && el.naturalWidth > 0) setLoadedUrl(url);
        }}
        src={imgSrc}
        alt={alt}
        className="h-full w-full object-cover transition duration-300 ease-out group-hover:scale-[1.06] group-hover:brightness-[1.14]"
        loading="lazy"
        decoding="async"
        onLoad={() => setLoadedUrl(url)}
        onError={() => setFailedUrl(url)}
      />
      <span
        className="pointer-events-none absolute inset-0 rounded-[inherit] shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] opacity-70 transition-opacity duration-300 group-hover:opacity-100 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]"
        aria-hidden
      />
      <span
        className="pointer-events-none absolute inset-0 rounded-[inherit] bg-white/0 transition-colors duration-300 group-hover:bg-white/12"
        aria-hidden
      />
    </>
  );

  if (link) {
    return (
      <a
        href={link}
        target="_blank"
        rel="noreferrer"
        title="Open reel"
        className={cn(
          shell,
          "inline-flex focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/55",
        )}
      >
        {body}
      </a>
    );
  }

  return <div className={shell}>{body}</div>;
}
