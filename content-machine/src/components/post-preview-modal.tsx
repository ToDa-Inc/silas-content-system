"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { Copy, Download, X } from "lucide-react";

/**
 * Reusable "this is the finished post" preview.
 *
 * Used from any surface that has a session in hand and wants to show the full
 * deliverable in one place — video player at proper 9:16, the full caption (no
 * line clamp, no expand toggle to debug), hashtags, plus copy / download actions.
 *
 * Currently mounted from:
 *   - the deliverable recap card on the Generate workspace (Done sessions)
 *   - the Renders + Covers cards on /media
 *
 * Falls back gracefully when only a thumbnail exists (e.g. cover-only sessions).
 *
 * Backdrop click + ESC close. Body scroll locked while open. Matches the existing
 * `ConfirmDialog` modal pattern (z-[100], dark overlay, glass card).
 */
export type PostPreviewModalProps = {
  open: boolean;
  onClose: () => void;
  title?: string;
  /** Caption body. Rendered with `whitespace-pre-line` so newlines from the LLM survive. */
  caption?: string | null;
  hashtags?: string[] | null;
  thumbnailUrl?: string | null;
  /** When present, shows a `<video>` player with the thumbnail as poster. */
  videoUrl?: string | null;
  /** Optional — opens the source session in Generate. Hidden when not provided. */
  openSessionHref?: string | null;
};

export function PostPreviewModal({
  open,
  onClose,
  title,
  caption,
  hashtags,
  thumbnailUrl,
  videoUrl,
  openSessionHref,
}: PostPreviewModalProps) {
  const titleId = useId();
  const [copied, setCopied] = useState(false);

  const fullCaption = useMemo(() => {
    const body = (caption ?? "").trim();
    const tags = (hashtags ?? []).filter(Boolean).join(" ");
    if (!body && !tags) return "";
    if (!tags) return body;
    if (!body) return tags;
    return `${body}\n\n${tags}`;
  }, [caption, hashtags]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) setCopied(false);
  }, [open]);

  if (!open) return null;

  const onCopy = async () => {
    if (!fullCaption) return;
    try {
      await navigator.clipboard.writeText(fullCaption);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard can fail in non-secure contexts; the Copy button just no-ops.
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-zinc-200/90 bg-zinc-50 shadow-2xl dark:border-white/12 dark:bg-zinc-950/95"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-200/80 px-5 py-3 dark:border-white/10">
          <h2 id={titleId} className="truncate pr-4 text-sm font-semibold text-zinc-900 dark:text-app-fg">
            {title || "Post preview"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close preview"
            className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-zinc-200/70 hover:text-zinc-900 dark:text-app-fg-muted dark:hover:bg-white/10 dark:hover:text-app-fg"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body — video left, caption right on desktop; stacked on mobile */}
        <div className="flex flex-col gap-5 overflow-y-auto p-5 md:flex-row md:gap-6">
          {/* Media column */}
          <div className="mx-auto w-full max-w-[280px] shrink-0 md:mx-0">
            <div className="overflow-hidden rounded-xl border border-zinc-200/80 bg-black shadow-md dark:border-white/10">
              {videoUrl ? (
                <video
                  src={videoUrl}
                  poster={thumbnailUrl ?? undefined}
                  controls
                  playsInline
                  className="block aspect-[9/16] w-full object-cover"
                />
              ) : thumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={thumbnailUrl}
                  alt="Post cover"
                  className="block aspect-[9/16] w-full object-cover"
                />
              ) : (
                <div className="flex aspect-[9/16] w-full items-center justify-center">
                  <p className="text-xs text-white/40">No media</p>
                </div>
              )}
            </div>
          </div>

          {/* Caption column */}
          <div className="flex min-w-0 flex-1 flex-col gap-4">
            <div>
              <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-app-fg-subtle">
                Caption
              </p>
              {caption?.trim() ? (
                <p className="whitespace-pre-line text-sm leading-relaxed text-zinc-800 dark:text-app-fg-secondary">
                  {caption}
                </p>
              ) : (
                <p className="text-xs text-app-fg-muted">No caption.</p>
              )}
            </div>

            {hashtags && hashtags.length > 0 ? (
              <div>
                <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-app-fg-subtle">
                  Hashtags
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {hashtags.map((t, i) => (
                    <span
                      key={`${t}-${i}`}
                      className="rounded-full bg-sky-500/10 px-2 py-0.5 text-[11px] font-medium text-sky-600 dark:text-sky-400"
                    >
                      {t.startsWith("#") ? t : `#${t}`}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {/* Footer actions */}
        <div className="flex flex-wrap items-center gap-2 border-t border-zinc-200/80 px-5 py-3 dark:border-white/10">
          <button
            type="button"
            onClick={() => void onCopy()}
            disabled={!fullCaption}
            className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500/15 px-3 py-1.5 text-xs font-bold text-app-on-amber-title hover:bg-amber-500/25 disabled:opacity-40"
          >
            <Copy className="h-3 w-3" />
            {copied ? "Copied" : "Copy caption"}
          </button>
          {videoUrl ? (
            <a
              href={videoUrl}
              download="reel.mp4"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-bold text-zinc-950 shadow-sm hover:opacity-90"
            >
              <Download className="h-3 w-3" /> Download MP4
            </a>
          ) : null}
          {openSessionHref ? (
            <a
              href={openSessionHref}
              className="ml-auto text-[11px] font-semibold text-sky-500 hover:underline dark:text-sky-400"
            >
              Open session →
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}
