"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  Film,
  Image as ImageIcon,
  Loader2,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Video,
} from "lucide-react";
import { useToast } from "@/components/ui/toast-provider";
import {
  brollDelete,
  brollList,
  clientApiContext,
  creationGenerateBackground,
  creationListSessions,
  creationRenderVideo,
  creationSetBroll,
  fetchBackgroundJob,
  generationGenerateThumbnail,
  generationGetSession,
  patchCreateSession,
  type BrollClipRow,
  type GenerationSession,
  type TextBlock,
} from "@/lib/api-client";

const POLL_MS = 4000;
const MAX_POLLS = 90;

// ── Helpers ──────────────────────────────────────────────────────────────────

function canonicalFormatKey(k: string | null | undefined): string | null {
  if (!k?.trim()) return null;
  if (k === "b_roll") return "b_roll_reel";
  return k;
}

function sessionTitle(s: GenerationSession): string {
  const angles = s.angles ?? [];
  const idx = s.chosen_angle_index ?? 0;
  const angle = angles[idx] ?? angles[0];
  if (angle && typeof angle === "object" && "title" in angle) {
    const t = (angle as { title?: unknown }).title;
    if (typeof t === "string" && t.trim()) return t.trim();
  }
  const fk = canonicalFormatKey(s.source_format_key) ?? s.source_format_key;
  if (fk) return fk.replace(/_/g, " ");
  if (s.source_type === "url_adapt") return "URL adapt";
  return "Session";
}

function formatBadge(s: GenerationSession): string {
  const fk = canonicalFormatKey(s.source_format_key) ?? s.source_format_key;
  if (fk) return fk.replace(/_/g, " ");
  if (s.source_type === "url_adapt") return "text overlay";
  return "—";
}

function renderStatusLabel(s: GenerationSession): { label: string; cls: string } {
  switch (s.render_status) {
    case "done":
      return { label: "Done", cls: "bg-emerald-500/20 text-emerald-400" };
    case "rendering":
      return { label: "Rendering…", cls: "bg-amber-500/20 text-amber-400" };
    case "failed":
      return { label: "Failed", cls: "bg-red-500/20 text-red-400" };
    case "cleaned":
      return { label: "Cleaned", cls: "bg-zinc-500/15 text-zinc-400" };
    default:
      return { label: "Not started", cls: "bg-zinc-500/15 text-zinc-400" };
  }
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

// ── Step header ───────────────────────────────────────────────────────────────

function StepHeader({
  n,
  label,
  done,
  children,
}: {
  n: number;
  label: string;
  done: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <div
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
          done
            ? "bg-emerald-500/20 text-emerald-400"
            : "bg-amber-500/20 text-amber-600 dark:text-amber-400"
        }`}
      >
        {done ? <CheckCircle2 className="h-4 w-4" /> : n}
      </div>
      <h2 className="flex-1 text-sm font-semibold text-app-fg">{label}</h2>
      {children}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function CreatePage() {
  const { show } = useToast();
  const [bootstrapDone, setBootstrapDone] = useState(false);
  const [clientSlug, setClientSlug] = useState("");
  const [orgSlug, setOrgSlug] = useState("");
  const [sessions, setSessions] = useState<GenerationSession[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [session, setSession] = useState<GenerationSession | null>(null);
  const [clips, setClips] = useState<BrollClipRow[]>([]);
  const [selectedClipId, setSelectedClipId] = useState("");
  const [textDraft, setTextDraft] = useState<TextBlock[]>([]);
  const [captionOpen, setCaptionOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [bgBusy, setBgBusy] = useState(false);
  const [renderBusy, setRenderBusy] = useState(false);
  const [deletingClipId, setDeletingClipId] = useState<string | null>(null);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [thumbnailBusy, setThumbnailBusy] = useState(false);
  const [coverText, setCoverText] = useState("");

  // ── Bootstrap ──────────────────────────────────────────────────────────────

  const reloadListAndClips = useCallback(async () => {
    const cs = clientSlug.trim();
    const os = orgSlug.trim();
    if (!cs || !os) return;
    const [sRes, bRes] = await Promise.all([creationListSessions(cs, os), brollList(cs, os)]);
    if (!sRes.ok) { show(sRes.error, "error"); return; }
    setSessions(sRes.data);
    if (bRes.ok) setClips(bRes.data);
  }, [clientSlug, orgSlug, show]);

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
        const [sRes, bRes] = await Promise.all([creationListSessions(cs, os), brollList(cs, os)]);
        if (cancelled) return;
        if (!sRes.ok) show(sRes.error, "error");
        else setSessions(sRes.data);
        if (bRes.ok) setClips(bRes.data);
      }
      setBootstrapDone(true);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Session selection ──────────────────────────────────────────────────────

  const selectSession = useCallback(async (id: string) => {
    const cs = clientSlug.trim();
    const os = orgSlug.trim();
    if (!cs || !os) return;
    setSelectedId(id);
    setLoading(true);
    try {
      const res = await generationGetSession(cs, os, id);
      if (!res.ok) { show(res.error, "error"); return; }
      setSession(res.data);
      const tb = res.data.text_blocks;
      setTextDraft(Array.isArray(tb) ? tb.map((b) => ({ ...b })) : []);
      setSelectedClipId(res.data.broll_clip_id ?? "");
      setCaptionOpen(false);
      setThumbnailUrl(null);
      setCoverText("");
    } finally {
      setLoading(false);
    }
  }, [clientSlug, orgSlug, show]);

  useEffect(() => {
    if (sessions.length === 0) { setSelectedId(null); setSession(null); setTextDraft([]); return; }
    const valid = Boolean(selectedId && sessions.some((s) => s.id === selectedId));
    if (!valid) void selectSession(sessions[0].id);
  }, [sessions, selectedId, selectSession]);

  // ── Derived format flags ───────────────────────────────────────────────────

  const fk = useMemo(() => {
    const raw = session?.source_format_key ?? null;
    return canonicalFormatKey(raw) ?? raw ?? (session?.source_type === "url_adapt" ? "text_overlay" : null);
  }, [session]);
  const isTextOverlay = fk === "text_overlay" || fk === "carousel";
  const isBroll = fk === "b_roll_reel";

  // ── Step completion flags ─────────────────────────────────────────────────

  const savedBlocks = session?.text_blocks ?? [];
  const hasUnsavedBlocks = useMemo(() => {
    if (textDraft.length !== savedBlocks.length) return true;
    return textDraft.some((b, i) => b.text !== savedBlocks[i]?.text || b.isCTA !== savedBlocks[i]?.isCTA);
  }, [textDraft, savedBlocks]);
  const step1Done = !hasUnsavedBlocks && textDraft.length > 0;
  const step2Done = Boolean(session?.background_url);
  const step3Done = session?.render_status === "done" || session?.render_status === "cleaned";
  const isRendering = session?.render_status === "rendering";

  // ── Actions ────────────────────────────────────────────────────────────────

  const saveTextBlocks = useCallback(async () => {
    const cs = clientSlug.trim(); const os = orgSlug.trim();
    if (!session || !cs || !os) return;
    setLoading(true);
    try {
      const res = await patchCreateSession(cs, os, session.id, {
        text_blocks: textDraft.filter((b) => b.text.trim()),
      });
      if (!res.ok) { show(res.error, "error"); return; }
      setSession(res.data);
      setTextDraft(res.data.text_blocks?.map((b) => ({ ...b })) ?? []);
      show("Text blocks saved.", "success");
    } finally { setLoading(false); }
  }, [clientSlug, orgSlug, session, textDraft, show]);

  const onGenerateBg = useCallback(async () => {
    const cs = clientSlug.trim(); const os = orgSlug.trim();
    if (!session || !cs || !os) return;
    setBgBusy(true);
    try {
      const res = await creationGenerateBackground(cs, os, session.id);
      if (!res.ok) { show(res.error, "error"); return; }
      setSession(res.data);
      show("Background generated.", "success");
    } finally { setBgBusy(false); }
  }, [clientSlug, orgSlug, session, show]);

  const onSetBroll = useCallback(async (clipId: string) => {
    const cs = clientSlug.trim(); const os = orgSlug.trim();
    if (!session || !cs || !os || !clipId.trim()) return;
    setLoading(true);
    try {
      const res = await creationSetBroll(cs, os, session.id, clipId.trim());
      if (!res.ok) { show(res.error, "error"); return; }
      setSession(res.data);
      setSelectedClipId(clipId);
      show("B-roll set.", "success");
    } finally { setLoading(false); }
  }, [clientSlug, orgSlug, session, show]);

  const onDeleteClip = useCallback(async (clipId: string) => {
    const cs = clientSlug.trim(); const os = orgSlug.trim();
    if (!cs || !os) return;
    setDeletingClipId(clipId);
    try {
      const res = await brollDelete(cs, os, clipId);
      if (!res.ok) { show(res.error, "error"); return; }
      setClips((prev) => prev.filter((c) => c.id !== clipId));
      if (selectedClipId === clipId) setSelectedClipId("");
      show("Clip deleted.", "success");
    } finally { setDeletingClipId(null); }
  }, [clientSlug, orgSlug, selectedClipId, show]);

  const pollRenderJob = useCallback(async (jobId: string, sessionId: string) => {
    const cs = clientSlug.trim(); const os = orgSlug.trim();
    if (!cs || !os) return;
    for (let i = 0; i < MAX_POLLS; i++) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      const jr = await fetchBackgroundJob(os, jobId);
      if (!jr.ok) { show(jr.error, "error"); return; }
      if (jr.data.status === "failed") {
        show(jr.data.error_message || "Render failed.", "error");
        const s = await generationGetSession(cs, os, sessionId);
        if (s.ok) setSession(s.data);
        return;
      }
      if (jr.data.status === "completed") {
        const s = await generationGetSession(cs, os, sessionId);
        if (s.ok) { setSession(s.data); show("Video ready — download below.", "success"); void reloadListAndClips(); }
        return;
      }
    }
    show("Render is taking longer than expected. Refresh later.", "error");
  }, [clientSlug, orgSlug, show, reloadListAndClips]);

  const onRender = useCallback(async () => {
    const cs = clientSlug.trim(); const os = orgSlug.trim();
    if (!session || !cs || !os) return;
    setRenderBusy(true);
    try {
      const res = await creationRenderVideo(cs, os, session.id);
      if (!res.ok) { show(res.error, "error"); return; }
      setSession((prev) => prev ? { ...prev, render_status: "rendering", render_error: null } : prev);
      show("Render started — usually 1–3 minutes.", "success");
      void pollRenderJob(res.job_id, session.id);
    } finally { setRenderBusy(false); }
  }, [clientSlug, orgSlug, session, show, pollRenderJob]);

  const onGenerateThumbnail = useCallback(async (textOverride?: string) => {
    const cs = clientSlug.trim(); const os = orgSlug.trim();
    if (!session || !cs || !os) return;
    const text = (textOverride ?? coverText).trim() || undefined;
    setThumbnailBusy(true);
    try {
      const res = await generationGenerateThumbnail(cs, os, session.id, text);
      if (!res.ok) { show(res.error, "error"); return; }
      setThumbnailUrl(res.data.thumbnail_url);
    } finally { setThumbnailBusy(false); }
  }, [clientSlug, orgSlug, session, coverText, show]);

  // ── Hook text from session ─────────────────────────────────────────────────

  const hookText = useMemo(() => {
    const h = session?.hooks;
    if (Array.isArray(h) && h[0]?.text) return h[0].text;
    return null;
  }, [session]);

  // ── Early exits ────────────────────────────────────────────────────────────

  if (!bootstrapDone) {
    return (
      <main className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-app-fg-subtle" />
      </main>
    );
  }

  if (!clientSlug.trim() || !orgSlug.trim()) {
    return (
      <main className="mx-auto max-w-lg px-4 py-16 text-center">
        <Video className="mx-auto mb-4 h-10 w-10 text-app-fg-subtle opacity-50" />
        <h1 className="text-base font-semibold text-app-fg">No workspace linked</h1>
        <p className="mt-2 text-sm text-app-fg-muted">Open the app from a client dashboard link so the API can resolve your org and client.</p>
      </main>
    );
  }

  if (sessions.length === 0) {
    return (
      <main className="mx-auto max-w-lg px-4 py-16 text-center">
        <Video className="mx-auto mb-4 h-10 w-10 text-app-fg-subtle opacity-50" />
        <h1 className="text-base font-semibold text-app-fg">No sessions ready</h1>
        <p className="mt-3 text-sm leading-relaxed text-app-fg-muted">
          Only <span className="font-medium text-app-fg">approved</span> sessions with visual formats
          (text overlay, B-roll, carousel) appear here. Go to{" "}
          <Link href="/generate" className="font-medium text-amber-600 hover:underline dark:text-amber-400">
            Generate
          </Link>
          , pick an angle, and approve the session.
        </p>
      </main>
    );
  }

  // ── Main layout ────────────────────────────────────────────────────────────

  return (
    <main className="mx-auto flex min-h-0 max-w-[1300px] flex-col gap-0 px-4 pb-20 pt-6 md:flex-row md:gap-6 md:px-6 md:pt-8">

      {/* ── Sidebar ── */}
      <aside className="shrink-0 md:w-64">
        <div className="mb-3 flex items-center justify-between">
          <h1 className="text-sm font-semibold text-app-fg">Sessions</h1>
          <button
            type="button"
            onClick={() => void reloadListAndClips()}
            title="Refresh"
            className="rounded-lg p-1.5 text-app-fg-subtle hover:bg-white/8"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
        <ul className="space-y-1.5">
          {sessions.map((s) => {
            const st = renderStatusLabel(s);
            const active = selectedId === s.id;
            return (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => void selectSession(s.id)}
                  className={`w-full rounded-xl border px-3 py-2.5 text-left transition-colors ${
                    active
                      ? "border-amber-500/45 bg-amber-500/10"
                      : "border-app-divider hover:border-white/20 hover:bg-white/[0.03]"
                  }`}
                >
                  <p className="mb-1 line-clamp-2 text-xs font-semibold leading-snug text-app-fg">
                    {sessionTitle(s)}
                  </p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="rounded-full bg-violet-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-violet-300">
                      {formatBadge(s)}
                    </span>
                    <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${st.cls}`}>
                      {st.label}
                    </span>
                    {s.updated_at && (
                      <span className="text-[9px] text-app-fg-subtle">{formatDate(s.updated_at)}</span>
                    )}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>

      {/* ── Main workspace ── */}
      <section className="min-w-0 flex-1 space-y-4 pt-5 md:pt-0">

        {loading && !session ? (
          <div className="flex items-center gap-2 py-10 text-sm text-app-fg-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading session…
          </div>
        ) : session ? (
          <>
            {/* ── Step 1: Content ── */}
            <div className="glass rounded-2xl border border-app-divider/80 p-5 md:p-6">
              <StepHeader n={1} label="Content" done={step1Done} />

              {/* Hook */}
              {hookText && (
                <div className="mb-4 rounded-xl border border-amber-500/25 bg-amber-500/[0.07] px-4 py-3">
                  <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-amber-600/80 dark:text-amber-400/70">
                    Hook (tier 1)
                  </p>
                  <p className="text-sm leading-relaxed text-app-fg">{hookText}</p>
                </div>
              )}

              {/* Text blocks */}
              <div className="mb-3">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs font-semibold text-app-fg">
                    On-screen text blocks
                    <span className="ml-1.5 font-normal text-app-fg-muted">
                      ({textDraft.length}/6 · 6–7 words max)
                    </span>
                  </p>
                  <button
                    type="button"
                    onClick={() => setTextDraft((prev) => [...prev, { text: "", isCTA: false }])}
                    disabled={textDraft.length >= 6}
                    className="inline-flex items-center gap-1 rounded-lg border border-app-divider px-2 py-1 text-[11px] font-semibold text-app-fg-muted hover:text-app-fg disabled:opacity-40"
                  >
                    <Plus className="h-3 w-3" /> Add block
                  </button>
                </div>
                <div className="space-y-2">
                  {textDraft.map((b, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input
                        value={b.text}
                        onChange={(e) => {
                          const next = [...textDraft];
                          next[i] = { ...next[i], text: e.target.value };
                          setTextDraft(next);
                        }}
                        placeholder={b.isCTA ? "👇 Schreib 'Keyword' für …" : "❌ Short punchy line…"}
                        className="glass-inset min-w-0 flex-1 rounded-xl px-3 py-2 text-sm text-app-fg placeholder:text-app-fg-subtle focus:outline-none focus:ring-2 focus:ring-amber-500/35"
                      />
                      <label
                        className="flex cursor-pointer select-none items-center gap-1 rounded-lg border border-app-divider px-2 py-2 text-[10px] font-semibold text-app-fg-muted hover:border-amber-500/30"
                        title="Mark as CTA block"
                      >
                        <input
                          type="checkbox"
                          checked={b.isCTA ?? false}
                          onChange={(e) => {
                            const next = [...textDraft];
                            next[i] = { ...next[i], isCTA: e.target.checked };
                            setTextDraft(next);
                          }}
                          className="h-3 w-3 accent-amber-500"
                        />
                        CTA
                      </label>
                      <button
                        type="button"
                        onClick={() => setTextDraft((prev) => prev.filter((_, j) => j !== i))}
                        className="rounded-lg p-2 text-app-fg-subtle hover:bg-red-500/10 hover:text-red-400"
                        aria-label="Remove block"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                  {textDraft.length === 0 && (
                    <p className="rounded-xl border border-dashed border-app-divider/60 py-4 text-center text-xs text-app-fg-subtle">
                      No text blocks yet — click Add block above, or regenerate in Generate.
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={loading || !hasUnsavedBlocks}
                  onClick={() => void saveTextBlocks()}
                  className="inline-flex items-center gap-2 rounded-xl bg-amber-500/15 px-4 py-2 text-xs font-bold text-app-on-amber-title hover:bg-amber-500/25 disabled:opacity-40"
                >
                  {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  {loading ? "Saving…" : "Save text blocks"}
                </button>
                {!hasUnsavedBlocks && textDraft.length > 0 && (
                  <span className="text-[11px] text-emerald-600 dark:text-emerald-400">Saved ✓</span>
                )}
              </div>

              {/* Caption collapsible */}
              {session.caption_body && (
                <div className="mt-4 border-t border-app-divider/50 pt-4">
                  <button
                    type="button"
                    onClick={() => setCaptionOpen((o) => !o)}
                    className="flex w-full items-center justify-between text-xs font-semibold text-app-fg-muted hover:text-app-fg"
                  >
                    Caption preview
                    {captionOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  </button>
                  {captionOpen && (
                    <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-app-fg-secondary">
                      {session.caption_body}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* ── Step 2: Background ── */}
            <div className="glass rounded-2xl border border-app-divider/80 p-5 md:p-6">
              <StepHeader n={2} label="Background" done={step2Done} />

              {isTextOverlay && (
                <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
                  {/* Preview */}
                  <div className="mx-auto shrink-0 sm:mx-0">
                    {bgBusy ? (
                      <div className="flex aspect-[2/3] w-[140px] flex-col items-center justify-center gap-2 rounded-xl border border-app-divider bg-app-chip-bg/40">
                        <Loader2 className="h-6 w-6 animate-spin text-app-fg-subtle" />
                        <p className="text-[10px] text-app-fg-muted">~30–60s</p>
                      </div>
                    ) : session.background_url ? (
                      <a href={session.background_url} target="_blank" rel="noreferrer" title="Open full size">
                        <div className="w-[140px] overflow-hidden rounded-xl border border-app-divider shadow-md">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={session.background_url}
                            alt="Background"
                            width={140}
                            className="block aspect-[2/3] w-full object-cover"
                            style={{ aspectRatio: "2/3" }}
                          />
                        </div>
                      </a>
                    ) : (
                      <div className="flex aspect-[2/3] w-[140px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-app-divider/70 bg-app-chip-bg/20">
                        <ImageIcon className="h-6 w-6 text-app-fg-subtle opacity-30" />
                        <p className="px-3 text-center text-[10px] text-app-fg-subtle">No background</p>
                      </div>
                    )}
                  </div>

                  {/* Controls */}
                  <div className="flex flex-col gap-3">
                    <p className="text-xs leading-relaxed text-app-fg-muted">
                      Generates an atmospheric workplace scene matched to the chosen angle.
                      Uses <span className="font-semibold text-app-fg-secondary">gpt-5-image</span> via OpenRouter.
                    </p>
                    <button
                      type="button"
                      disabled={bgBusy}
                      onClick={() => void onGenerateBg()}
                      className="inline-flex items-center gap-2 self-start rounded-xl bg-amber-500/15 px-4 py-2 text-xs font-bold text-app-on-amber-title hover:bg-amber-500/25 disabled:opacity-50"
                    >
                      {bgBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                      {bgBusy ? "Generating…" : session.background_url ? "Regenerate" : "Generate image"}
                    </button>
                  </div>
                </div>
              )}

              {isBroll && (
                <div>
                  {/* Current background */}
                  {session.background_url && (
                    <div className="mb-4 flex items-center gap-3 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.07] px-4 py-3">
                      <Film className="h-4 w-4 shrink-0 text-emerald-500" />
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">B-roll set</p>
                        <p className="truncate text-[11px] text-app-fg-muted">{session.background_url}</p>
                      </div>
                    </div>
                  )}

                  {/* Library header */}
                  <div className="mb-3 flex items-center justify-between">
                    <p className="text-xs font-semibold text-app-fg">
                      B-roll library <span className="font-normal text-app-fg-muted">({clips.length} clip{clips.length !== 1 ? "s" : ""})</span>
                    </p>
                    <Link
                      href="/media?tab=broll"
                      className="text-[11px] font-semibold text-sky-500 hover:underline dark:text-sky-400"
                    >
                      Manage in Media →
                    </Link>
                  </div>

                  {clips.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-app-divider/60 py-8 text-center">
                      <Film className="mx-auto mb-2 h-6 w-6 text-app-fg-subtle opacity-30" />
                      <p className="mb-3 text-xs text-app-fg-subtle">No clips yet.</p>
                      <Link
                        href="/media?tab=broll"
                        className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500/15 px-3 py-1.5 text-xs font-bold text-app-on-amber-title hover:bg-amber-500/25"
                      >
                        <Plus className="h-3 w-3" />
                        Upload B-roll
                      </Link>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {clips.map((c) => {
                        const isActive = selectedClipId === c.id || session.broll_clip_id === c.id;
                        return (
                          <div
                            key={c.id}
                            className={`group relative flex flex-col gap-1.5 rounded-xl border p-3 transition-colors ${
                              isActive
                                ? "border-amber-500/45 bg-amber-500/10"
                                : "border-app-divider hover:border-white/20"
                            }`}
                          >
                            <div className="flex aspect-video items-center justify-center overflow-hidden rounded-lg bg-black/30">
                              {c.thumbnail_url ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={c.thumbnail_url}
                                  alt=""
                                  className="h-full w-full object-cover"
                                />
                              ) : (
                                <Film className="h-5 w-5 text-app-fg-subtle opacity-40" />
                              )}
                            </div>
                            <p className="line-clamp-1 text-[11px] font-medium text-app-fg">
                              {c.label || `Clip ${c.id.slice(0, 6)}`}
                            </p>
                            <div className="flex gap-1">
                              <button
                                type="button"
                                disabled={loading || isActive}
                                onClick={() => void onSetBroll(c.id)}
                                className="flex-1 rounded-lg bg-amber-500/15 py-1 text-[10px] font-bold text-app-on-amber-title hover:bg-amber-500/25 disabled:opacity-40"
                              >
                                {isActive ? "Active" : "Use clip"}
                              </button>
                              <button
                                type="button"
                                disabled={deletingClipId === c.id}
                                onClick={() => void onDeleteClip(c.id)}
                                className="rounded-lg p-1 text-app-fg-subtle hover:bg-red-500/10 hover:text-red-400"
                                aria-label="Delete clip"
                              >
                                {deletingClipId === c.id
                                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  : <Trash2 className="h-3.5 w-3.5" />
                                }
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {!isTextOverlay && !isBroll && (
                <p className="text-xs text-app-fg-muted">
                  Background setup is not required for this format type.
                </p>
              )}
            </div>

            {/* ── Step 3: Render ── */}
            <div className="glass rounded-2xl border border-app-divider/80 p-5 md:p-6">
              <StepHeader n={3} label="Render" done={step3Done} />

              {!step2Done && !step3Done ? (
                <p className="text-xs text-app-fg-muted">
                  Set a background in Step 2 first.
                </p>
              ) : isRendering ? (
                <div className="flex items-center gap-3 rounded-xl border border-amber-500/25 bg-amber-500/[0.07] px-4 py-3">
                  <Loader2 className="h-5 w-5 shrink-0 animate-spin text-amber-500" />
                  <div>
                    <p className="text-sm font-semibold text-app-fg">Rendering…</p>
                    <p className="text-xs text-app-fg-muted">Usually 1–3 minutes. You can leave this page.</p>
                  </div>
                </div>
              ) : session.render_status === "failed" ? (
                <div className="space-y-3">
                  <div className="rounded-xl border border-red-500/25 bg-red-500/[0.07] px-4 py-3">
                    <p className="text-sm font-semibold text-red-400">Render failed</p>
                    {session.render_error && (
                      <p className="mt-1 text-xs text-app-fg-muted">{session.render_error}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    disabled={renderBusy}
                    onClick={() => void onRender()}
                    className="inline-flex items-center gap-2 rounded-xl border border-app-divider px-4 py-2 text-xs font-bold text-app-fg hover:bg-white/5 disabled:opacity-50"
                  >
                    <RefreshCw className="h-3.5 w-3.5" /> Retry render
                  </button>
                </div>
              ) : step3Done ? (
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" />
                  <p className="text-sm text-app-fg">Render complete — see output below.</p>
                  <button
                    type="button"
                    disabled={renderBusy}
                    onClick={() => void onRender()}
                    className="ml-auto rounded-lg border border-app-divider px-3 py-1.5 text-xs font-semibold text-app-fg-muted hover:text-app-fg disabled:opacity-50"
                  >
                    Re-render
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <button
                    type="button"
                    disabled={renderBusy || !step2Done}
                    onClick={() => void onRender()}
                    className="inline-flex items-center gap-2 rounded-xl bg-violet-500/20 px-5 py-2.5 text-sm font-bold text-violet-200 hover:bg-violet-500/30 disabled:opacity-50"
                  >
                    {renderBusy
                      ? <Loader2 className="h-4 w-4 animate-spin" />
                      : <Video className="h-4 w-4" />
                    }
                    {renderBusy ? "Starting…" : "Render video"}
                  </button>
                  <p className="text-xs text-app-fg-muted">Remotion · 1080×1920 · ~1–3 min</p>
                </div>
              )}
            </div>

            {/* ── Step 4: Reel cover (thumbnail) ── */}
            <div className="glass rounded-2xl border border-app-divider/80 p-5 md:p-6">
              <StepHeader n={4} label="Reel cover" done={Boolean(thumbnailUrl)}>
                <span className="text-[10px] text-app-fg-subtle">Instagram cover image · 9:16</span>
              </StepHeader>

              <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
                {/* Preview */}
                <div className="mx-auto shrink-0 sm:mx-0">
                  {thumbnailBusy ? (
                    <div
                      className="flex w-[140px] flex-col items-center justify-center gap-2 rounded-xl border border-app-divider bg-app-chip-bg/40"
                      style={{ aspectRatio: "9/16" }}
                    >
                      <Loader2 className="h-6 w-6 animate-spin text-app-fg-subtle" />
                      <p className="text-[10px] text-app-fg-muted">~30–60s</p>
                    </div>
                  ) : thumbnailUrl ? (
                    <a href={thumbnailUrl} target="_blank" rel="noreferrer" title="Open full size">
                      <div className="w-[140px] overflow-hidden rounded-xl border border-app-divider shadow-md">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={thumbnailUrl}
                          alt="Reel cover"
                          width={140}
                          className="block w-full object-cover"
                          style={{ aspectRatio: "9/16" }}
                        />
                      </div>
                    </a>
                  ) : (
                    <div
                      className="flex w-[140px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-app-divider/70 bg-app-chip-bg/20"
                      style={{ aspectRatio: "9/16" }}
                    >
                      <ImageIcon className="h-6 w-6 text-app-fg-subtle opacity-30" />
                      <p className="px-3 text-center text-[10px] text-app-fg-subtle">No cover yet</p>
                    </div>
                  )}
                </div>

                {/* Controls */}
                <div className="flex min-w-0 flex-1 flex-col gap-3">
                  <p className="text-xs leading-relaxed text-app-fg-muted">
                    The static cover image shown on Instagram before someone taps play.
                    Different from the video background — this is a standalone 9:16 image with your hook text burned in.
                  </p>

                  {/* Hook chips */}
                  {Array.isArray(session.hooks) && session.hooks.length > 0 && (
                    <div>
                      <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-app-fg-muted">
                        Pick a hook as headline
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {(session.hooks as Array<{ text?: string }>).map((h, i) => {
                          const txt = h?.text ?? "";
                          if (!txt) return null;
                          const active = coverText === txt;
                          return (
                            <button
                              key={i}
                              type="button"
                              onClick={() => setCoverText(active ? "" : txt)}
                              className={`rounded-lg border px-2 py-1.5 text-left text-[11px] leading-snug transition-colors ${
                                active
                                  ? "border-amber-500/45 bg-amber-500/10 text-app-fg"
                                  : "border-app-divider text-app-fg-muted hover:border-white/20 hover:text-app-fg"
                              }`}
                            >
                              {txt.length > 72 ? txt.slice(0, 72) + "…" : txt}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Custom text */}
                  <div>
                    <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-app-fg-muted">
                      Or type a custom headline
                    </p>
                    <textarea
                      value={coverText}
                      onChange={(e) => setCoverText(e.target.value)}
                      placeholder="Short, punchy headline for the cover…"
                      rows={2}
                      className="glass-inset w-full resize-none rounded-xl px-3 py-2 text-sm text-app-fg placeholder:text-app-fg-subtle focus:outline-none focus:ring-2 focus:ring-amber-500/35"
                    />
                  </div>

                  {/* Generate button */}
                  <button
                    type="button"
                    disabled={thumbnailBusy}
                    onClick={() => void onGenerateThumbnail()}
                    className="inline-flex items-center gap-2 self-start rounded-xl bg-amber-500/15 px-4 py-2 text-xs font-bold text-app-on-amber-title hover:bg-amber-500/25 disabled:opacity-50"
                  >
                    {thumbnailBusy
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <Sparkles className="h-3.5 w-3.5" />
                    }
                    {thumbnailBusy ? "Generating…" : thumbnailUrl ? "Regenerate cover" : "Generate cover"}
                  </button>

                  {/* Download */}
                  {thumbnailUrl && !thumbnailBusy && (
                    <a
                      href={thumbnailUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 self-start text-xs font-semibold text-sky-500 hover:underline dark:text-sky-400"
                    >
                      <Download className="h-3.5 w-3.5" />
                      Open full size · right-click to save
                    </a>
                  )}
                </div>
              </div>
            </div>

            {/* ── Step 5: Output ── */}
            {(step3Done || session.rendered_video_url) && (
              <div className="glass rounded-2xl border border-app-divider/80 p-5 md:p-6">
                <StepHeader n={5} label="Output" done={Boolean(session.rendered_video_url)} />

                {session.rendered_video_url ? (
                  <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
                    <div className="w-full shrink-0 sm:max-w-[240px]">
                      <video
                        src={session.rendered_video_url}
                        controls
                        playsInline
                        className="w-full rounded-xl border border-app-divider"
                        style={{ aspectRatio: "9/16" }}
                      />
                    </div>
                    <div className="flex flex-col gap-4">
                      <div>
                        <p className="text-sm font-semibold text-app-fg">Your video is ready.</p>
                        <p className="mt-1 text-xs leading-relaxed text-app-fg-muted">
                          Download the MP4, then open it in Instagram. Add a trending sound before publishing —
                          audio boosts reach significantly.
                        </p>
                      </div>
                      <a
                        href={session.rendered_video_url}
                        download="reel.mp4"
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-2 self-start rounded-xl bg-emerald-500 px-5 py-2.5 text-sm font-bold text-zinc-950 shadow-md shadow-emerald-900/25 hover:opacity-90"
                      >
                        <Download className="h-4 w-4" />
                        Download MP4
                      </a>
                      <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.07] px-3 py-2.5">
                        <p className="text-xs font-semibold text-amber-700 dark:text-amber-300">
                          Before publishing
                        </p>
                        <p className="mt-0.5 text-xs leading-relaxed text-app-fg-muted">
                          Open as a draft in Instagram → tap Add sound → pick a trending audio in your niche → publish.
                          Trending audio can 10× reach.
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-app-fg-muted">Video was rendered and cleaned up after 30 days.</p>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="flex items-center justify-center py-20 text-sm text-app-fg-muted">
            Select a session from the list.
          </div>
        )}
      </section>
    </main>
  );
}
