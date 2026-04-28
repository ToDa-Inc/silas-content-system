"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Download,
  Eye,
  Film,
  Image as ImageIcon,
  Loader2,
  Plus,
  Trash2,
  Video,
} from "lucide-react";
import { useToast } from "@/components/ui/toast-provider";
import { PostPreviewModal } from "@/components/post-preview-modal";
import {
  brollDelete,
  brollList,
  clientApiContext,
  clientImagesDelete,
  clientImagesList,
  contentApiFetch,
  creationListSessions,
  type BrollClipRow,
  type ClientImageRow,
  type GenerationSession,
} from "@/lib/api-client";
import { getContentApiBase } from "@/lib/env";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return "";
  }
}

function sessionTitle(s: GenerationSession): string {
  const hooks = s.hooks;
  if (Array.isArray(hooks) && hooks[0]?.text) return hooks[0].text;
  const angles = s.angles;
  if (Array.isArray(angles) && angles[0]) {
    const a = angles[0] as Record<string, unknown>;
    if (typeof a.title === "string" && a.title) return a.title;
  }
  return s.id.slice(0, 8);
}

type Tab = "renders" | "covers" | "broll" | "images";

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

function imageValidationError(file: File): string | null {
  const accepted = /\.(png|jpe?g|webp)$/i.test(file.name);
  if (!accepted) return "Only PNG, JPG or WEBP images are supported.";
  if (file.size > MAX_IMAGE_BYTES) return "Image too large (max 12 MB).";
  return null;
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function EmptyState({ icon: Icon, label }: { icon: React.ElementType; label: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-app-divider/60 py-20 text-center">
      <Icon className="h-8 w-8 text-app-fg-subtle opacity-25" />
      <p className="text-sm text-app-fg-subtle">{label}</p>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function MediaPage() {
  const { show } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [bootstrapDone, setBootstrapDone] = useState(false);
  const [clientSlug, setClientSlug] = useState("");
  const [orgSlug, setOrgSlug] = useState("");
  const [tab, setTab] = useState<Tab>("renders");

  const [sessions, setSessions] = useState<GenerationSession[]>([]);
  const [clips, setClips] = useState<BrollClipRow[]>([]);
  const [images, setImages] = useState<ClientImageRow[]>([]);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [imageUploadBusy, setImageUploadBusy] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  /** Whichever Renders/Covers card the user clicked "Preview" on. The full
   *  PostPreviewModal renders the playable video, the cover, and the full caption +
   *  hashtags in one place — replaces the old plain-MP4 new-tab link, which gave no
   *  context (no caption, no cover, no actions). */
  const [previewSession, setPreviewSession] = useState<GenerationSession | null>(null);

  // ── Bootstrap ────────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const ctx = await clientApiContext();
      if (cancelled) return;
      const cs = ctx.clientSlug?.trim() ?? "";
      const os = ctx.orgSlug?.trim() ?? "";
      setClientSlug(cs);
      setOrgSlug(os);
      if (cs && os) {
        const [sRes, bRes, iRes] = await Promise.all([
          creationListSessions(cs, os, 200),
          brollList(cs, os),
          clientImagesList(cs, os),
        ]);
        if (cancelled) return;
        if (sRes.ok) setSessions(sRes.data);
        if (bRes.ok) setClips(bRes.data);
        if (iRes.ok) setImages(iRes.data);
      }
      setBootstrapDone(true);
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Derived lists ────────────────────────────────────────────────────────

  const renders = sessions.filter((s) => !!s.rendered_video_url);
  const covers = sessions.filter((s) => !!s.thumbnail_url);

  // ── Actions ──────────────────────────────────────────────────────────────

  const onUpload = useCallback(async (file: File | null) => {
    if (!file) return;
    const cs = clientSlug.trim();
    const os = orgSlug.trim();
    if (!cs || !os) return;
    if (!file.name.toLowerCase().endsWith(".mp4")) {
      show("Only .mp4 files are supported.", "error");
      return;
    }
    setUploadBusy(true);
    try {
      const base = getContentApiBase();
      const { headers } = await clientApiContext({ orgSlug: os });
      const fd = new FormData();
      fd.append("file", file);
      const res = await contentApiFetch(
        `${base}/api/v1/clients/${encodeURIComponent(cs)}/broll`,
        { method: "POST", headers, body: fd },
      );
      const json = (await res.json().catch(() => ({}))) as { detail?: unknown };
      if (!res.ok) {
        show(typeof json.detail === "string" ? json.detail : `Upload failed (${res.status})`, "error");
        return;
      }
      show("Clip uploaded.", "success");
      const bRes = await brollList(cs, os);
      if (bRes.ok) setClips(bRes.data);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } finally {
      setUploadBusy(false);
    }
  }, [clientSlug, orgSlug, show]);

  const onUploadImage = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    const cs = clientSlug.trim();
    const os = orgSlug.trim();
    if (!cs || !os) return;
    setImageUploadBusy(true);
    try {
      const base = getContentApiBase();
      const { headers } = await clientApiContext({ orgSlug: os });
      let uploaded = 0;
      const failures: string[] = [];

      for (const file of files) {
        const validationError = imageValidationError(file);
        if (validationError) {
          failures.push(`${file.name}: ${validationError}`);
          continue;
        }

        const fd = new FormData();
        fd.append("file", file);
        const res = await contentApiFetch(
          `${base}/api/v1/clients/${encodeURIComponent(cs)}/images`,
          { method: "POST", headers, body: fd },
        );
        const json = (await res.json().catch(() => ({}))) as { detail?: unknown };
        if (!res.ok) {
          failures.push(
            `${file.name}: ${
              typeof json.detail === "string" ? json.detail : `Upload failed (${res.status})`
            }`,
          );
          continue;
        }
        uploaded += 1;
      }

      if (uploaded > 0) {
        const iRes = await clientImagesList(cs, os);
        if (iRes.ok) setImages(iRes.data);
      }

      if (failures.length > 0) {
        const prefix = uploaded > 0
          ? `${uploaded} image${uploaded === 1 ? "" : "s"} uploaded. `
          : "";
        show(`${prefix}${failures.length} failed: ${failures[0]}`, "error");
      } else {
        show(`${uploaded} image${uploaded === 1 ? "" : "s"} uploaded.`, "success");
      }
      if (imageInputRef.current) imageInputRef.current.value = "";
    } finally {
      setImageUploadBusy(false);
    }
  }, [clientSlug, orgSlug, show]);

  const onDeleteImage = useCallback(async (imageId: string) => {
    const cs = clientSlug.trim();
    const os = orgSlug.trim();
    if (!cs || !os) return;
    setDeletingId(imageId);
    try {
      const res = await clientImagesDelete(cs, os, imageId);
      if (!res.ok) { show(res.error, "error"); return; }
      setImages((prev) => prev.filter((i) => i.id !== imageId));
    } finally {
      setDeletingId(null);
    }
  }, [clientSlug, orgSlug, show]);

  const onDeleteClip = useCallback(async (clipId: string) => {
    const cs = clientSlug.trim();
    const os = orgSlug.trim();
    if (!cs || !os) return;
    setDeletingId(clipId);
    try {
      const res = await brollDelete(cs, os, clipId);
      if (!res.ok) { show(res.error, "error"); return; }
      setClips((prev) => prev.filter((c) => c.id !== clipId));
    } finally {
      setDeletingId(null);
    }
  }, [clientSlug, orgSlug, show]);

  // ── Loading guard ────────────────────────────────────────────────────────

  if (!bootstrapDone) {
    return (
      <main className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-app-fg-subtle" />
      </main>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: "renders", label: "Renders", count: renders.length },
    { id: "covers", label: "Covers", count: covers.length },
    { id: "broll", label: "B-roll", count: clips.length },
    { id: "images", label: "Images", count: images.length },
  ];

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-app-fg">Media</h1>
          <p className="mt-0.5 text-sm text-app-fg-muted">All generated renders, covers, and B-roll clips.</p>
        </div>
        {tab === "broll" && (
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-amber-500/15 px-4 py-2 text-xs font-bold text-app-on-amber-title hover:bg-amber-500/25 disabled:opacity-50">
            {uploadBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            {uploadBusy ? "Uploading…" : "Upload .mp4"}
            <input
              ref={fileInputRef}
              type="file"
              accept=".mp4,video/mp4"
              className="hidden"
              disabled={uploadBusy}
              onChange={(e) => void onUpload(e.target.files?.[0] ?? null)}
            />
          </label>
        )}
        {tab === "images" && (
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-amber-500/15 px-4 py-2 text-xs font-bold text-app-on-amber-title hover:bg-amber-500/25 disabled:opacity-50">
            {imageUploadBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            {imageUploadBusy ? "Uploading…" : "Upload images"}
            <input
              ref={imageInputRef}
              type="file"
              multiple
              accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
              className="hidden"
              disabled={imageUploadBusy}
              onChange={(e) => void onUploadImage(Array.from(e.target.files ?? []))}
            />
          </label>
        )}
      </div>

      {/* Tabs */}
      <div className="mb-6 flex gap-1 rounded-xl border border-app-divider bg-app-chip-bg/40 p-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition-colors ${
              tab === t.id
                ? "bg-white/10 text-app-fg shadow-sm dark:bg-white/[0.08]"
                : "text-app-fg-muted hover:text-app-fg"
            }`}
          >
            {t.label}
            <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
              tab === t.id ? "bg-amber-500/20 text-amber-500" : "bg-app-chip-bg text-app-fg-subtle"
            }`}>
              {t.count}
            </span>
          </button>
        ))}
      </div>

      {/* ── Renders tab ─────────────────────────────────────────────────── */}
      {tab === "renders" && (
        renders.length === 0
          ? <EmptyState icon={Video} label="No renders yet — finish the Render step in Create." />
          : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {renders.map((s) => (
                <div key={s.id} className="glass flex flex-col gap-2 rounded-2xl p-3">
                  {/* 9:16 cover — clicking opens the session in Generate so users can
                      go from "browsing finished posts" → "edit / re-publish this one" without
                      having to copy the session ID by hand. */}
                  <Link
                    href={`/generate?session=${encodeURIComponent(s.id)}`}
                    title="Open session"
                    className="group block overflow-hidden rounded-xl bg-black"
                    style={{ aspectRatio: "9/16" }}
                  >
                    {s.thumbnail_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={s.thumbnail_url}
                        alt=""
                        className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center">
                        <Video className="h-6 w-6 text-white/20" />
                      </div>
                    )}
                  </Link>
                  {/* Meta */}
                  <p className="line-clamp-2 text-[11px] font-medium leading-snug text-app-fg">
                    {sessionTitle(s)}
                  </p>
                  {s.caption_body ? (
                    <p className="line-clamp-3 text-[10px] leading-snug text-app-fg-muted">
                      {s.caption_body}
                    </p>
                  ) : null}
                  <p className="text-[10px] text-app-fg-subtle">{formatDate(s.created_at)}</p>
                  {/* Actions. Thumbnail click opens the session in Generate; Preview
                      opens the full deliverable modal (playable video + cover + full
                      caption + hashtags). Download is the quick "grab the file" job. */}
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => setPreviewSession(s)}
                      title="Preview post"
                      className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg bg-amber-500/15 py-1.5 text-[11px] font-bold text-app-on-amber-title hover:bg-amber-500/25"
                    >
                      <Eye className="h-3 w-3" />
                      Preview
                    </button>
                    <a
                      href={s.rendered_video_url!}
                      target="_blank"
                      rel="noreferrer"
                      download
                      title="Download MP4"
                      className="inline-flex items-center justify-center rounded-lg border border-app-divider px-2 py-1.5 text-[11px] text-app-fg-muted hover:bg-white/5"
                    >
                      <Download className="h-3 w-3" />
                    </a>
                  </div>
                  <Link
                    href={`/generate?session=${encodeURIComponent(s.id)}`}
                    className="text-center text-[11px] font-semibold text-sky-500 hover:underline dark:text-sky-400"
                  >
                    Open session →
                  </Link>
                </div>
              ))}
            </div>
          )
      )}

      {/* ── Covers tab ──────────────────────────────────────────────────── */}
      {tab === "covers" && (
        covers.length === 0
          ? <EmptyState icon={ImageIcon} label="No covers yet — use Generate cover in Create." />
          : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
              {covers.map((s) => (
                <div key={s.id} className="glass flex flex-col gap-2 rounded-2xl p-3">
                  {/* Cover thumbnail clicks back to the source session, same as Renders. */}
                  <Link
                    href={`/generate?session=${encodeURIComponent(s.id)}`}
                    title="Open session"
                    className="group block overflow-hidden rounded-xl border border-app-divider"
                    style={{ aspectRatio: "9/16" }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={s.thumbnail_url!}
                      alt=""
                      className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
                    />
                  </Link>
                  {/* Meta */}
                  <p className="line-clamp-2 text-[11px] font-medium leading-snug text-app-fg">
                    {sessionTitle(s)}
                  </p>
                  {s.caption_body ? (
                    <p className="line-clamp-3 text-[10px] leading-snug text-app-fg-muted">
                      {s.caption_body}
                    </p>
                  ) : null}
                  <p className="text-[10px] text-app-fg-subtle">{formatDate(s.created_at)}</p>
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => setPreviewSession(s)}
                      title="Preview post"
                      className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg bg-amber-500/15 py-1.5 text-[11px] font-bold text-app-on-amber-title hover:bg-amber-500/25"
                    >
                      <Eye className="h-3 w-3" />
                      Preview
                    </button>
                    <a
                      href={s.thumbnail_url!}
                      target="_blank"
                      rel="noreferrer"
                      download
                      title="Download cover"
                      className="inline-flex items-center justify-center rounded-lg border border-app-divider px-2 py-1.5 text-[11px] text-app-fg-muted hover:bg-white/5"
                    >
                      <Download className="h-3 w-3" />
                    </a>
                  </div>
                  <Link
                    href={`/generate?session=${encodeURIComponent(s.id)}`}
                    className="text-center text-[11px] font-semibold text-sky-500 hover:underline dark:text-sky-400"
                  >
                    Open session →
                  </Link>
                </div>
              ))}
            </div>
          )
      )}

      {/* ── Images tab ──────────────────────────────────────────────────── */}
      {tab === "images" && (
        images.length === 0
          ? <EmptyState icon={ImageIcon} label="No images yet — upload a PNG, JPG or WEBP." />
          : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
              {images.map((img) => {
                const isDeleting = deletingId === img.id;
                return (
                  <div key={img.id} className="glass flex flex-col gap-2 rounded-2xl p-3">
                    {/* portrait preview */}
                    <div className="overflow-hidden rounded-xl border border-app-divider bg-black/5" style={{ aspectRatio: "9/16" }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={img.file_url}
                        alt={img.label ?? ""}
                        className="h-full w-full object-cover"
                      />
                    </div>
                    <p className="line-clamp-1 text-[11px] font-medium text-app-fg">
                      {img.label ?? `Image ${img.id.slice(0, 6)}`}
                    </p>
                    <p className="text-[10px] text-app-fg-subtle">{formatDate(img.created_at)}</p>
                    <div className="flex gap-1.5">
                      <a
                        href={img.file_url}
                        target="_blank"
                        rel="noreferrer"
                        download
                        className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg border border-app-divider py-1.5 text-[11px] font-semibold text-app-fg hover:bg-white/5"
                      >
                        <Download className="h-3 w-3" />
                        Download
                      </a>
                      <button
                        type="button"
                        disabled={isDeleting}
                        onClick={() => void onDeleteImage(img.id)}
                        title="Delete image"
                        className="inline-flex items-center justify-center rounded-lg border border-app-divider px-2 py-1.5 text-[11px] text-red-500 hover:bg-red-500/10 disabled:opacity-40"
                      >
                        {isDeleting
                          ? <Loader2 className="h-3 w-3 animate-spin" />
                          : <Trash2 className="h-3 w-3" />
                        }
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )
      )}

      {/* ── B-roll tab ──────────────────────────────────────────────────── */}
      {tab === "broll" && (
        clips.length === 0
          ? <EmptyState icon={Film} label="No clips yet — upload a .mp4 above." />
          : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {clips.map((c) => {
                const isDeleting = deletingId === c.id;
                return (
                  <div key={c.id} className="glass flex flex-col gap-2 rounded-2xl p-3">
                    {/* 16:9 thumbnail */}
                    <div className="overflow-hidden rounded-xl bg-black/40" style={{ aspectRatio: "16/9" }}>
                      {c.thumbnail_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={c.thumbnail_url}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center">
                          <Film className="h-5 w-5 text-white/20" />
                        </div>
                      )}
                    </div>
                    {/* Meta */}
                    <p className="line-clamp-1 text-[11px] font-medium text-app-fg">
                      {c.label ?? `Clip ${c.id.slice(0, 6)}`}
                    </p>
                    <p className="text-[10px] text-app-fg-subtle">{formatDate(c.created_at)}</p>
                    {/* Actions */}
                    <div className="flex gap-1.5">
                      <a
                        href={c.file_url}
                        target="_blank"
                        rel="noreferrer"
                        download
                        className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg border border-app-divider py-1.5 text-[11px] font-semibold text-app-fg hover:bg-white/5"
                      >
                        <Download className="h-3 w-3" />
                        MP4
                      </a>
                      <button
                        type="button"
                        disabled={isDeleting}
                        onClick={() => void onDeleteClip(c.id)}
                        title="Delete clip"
                        className="inline-flex items-center justify-center rounded-lg border border-app-divider px-2 py-1.5 text-[11px] text-red-500 hover:bg-red-500/10 disabled:opacity-40"
                      >
                        {isDeleting
                          ? <Loader2 className="h-3 w-3 animate-spin" />
                          : <Trash2 className="h-3 w-3" />
                        }
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )
      )}

      <PostPreviewModal
        open={previewSession !== null}
        onClose={() => setPreviewSession(null)}
        title={previewSession ? sessionTitle(previewSession) : "Post preview"}
        caption={previewSession?.caption_body}
        hashtags={previewSession?.hashtags}
        thumbnailUrl={previewSession?.thumbnail_url}
        videoUrl={previewSession?.rendered_video_url}
        openSessionHref={
          previewSession ? `/generate?session=${encodeURIComponent(previewSession.id)}` : null
        }
      />
    </main>
  );
}
