"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, Video } from "lucide-react";
import { useToast } from "@/components/ui/toast-provider";
import {
  brollList,
  clientApiContext,
  contentApiFetch,
  creationGenerateBackground,
  creationListSessions,
  creationRenderVideo,
  creationSetBroll,
  fetchBackgroundJob,
  generationGetSession,
  patchCreateSession,
  type BrollClipRow,
  type GenerationSession,
  type TextBlock,
} from "@/lib/api-client";
import { getContentApiBase } from "@/lib/env";

const POLL_MS = 4000;
const MAX_POLLS = 90;

function formatKeyLabel(k: string | null | undefined): string {
  if (!k) return "—";
  return k.replace(/_/g, " ");
}

function canonicalFormatKey(k: string | null | undefined): string | null {
  if (!k?.trim()) return null;
  if (k === "b_roll") return "b_roll_reel";
  return k;
}

function createSessionFormatLabel(s: GenerationSession): string {
  const fk = canonicalFormatKey(s.source_format_key) ?? s.source_format_key;
  if (fk) return formatKeyLabel(fk);
  if (s.source_type === "url_adapt") return "URL adapt · text overlay";
  return "—";
}

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
  const [loading, setLoading] = useState(false);
  const [renderBusy, setRenderBusy] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);

  const reloadListAndClips = useCallback(async () => {
    const cs = clientSlug.trim();
    const os = orgSlug.trim();
    if (!cs || !os) return;
    const [sRes, bRes] = await Promise.all([creationListSessions(cs, os), brollList(cs, os)]);
    if (!sRes.ok) {
      show(sRes.error, "error");
      return;
    }
    setSessions(sRes.data);
    if (bRes.ok) setClips(bRes.data);
  }, [clientSlug, orgSlug, show]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
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
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot workspace + list load on mount
  }, []);

  const selectSession = useCallback(
    async (id: string) => {
      const cs = clientSlug.trim();
      const os = orgSlug.trim();
      if (!cs || !os) return;
      setSelectedId(id);
      setLoading(true);
      try {
        const res = await generationGetSession(cs, os, id);
        if (!res.ok) {
          show(res.error, "error");
          return;
        }
        setSession(res.data);
        const tb = res.data.text_blocks;
        setTextDraft(Array.isArray(tb) ? tb.map((b) => ({ ...b })) : []);
      } finally {
        setLoading(false);
      }
    },
    [clientSlug, orgSlug, show],
  );

  useEffect(() => {
    if (sessions.length === 0) {
      setSelectedId(null);
      setSession(null);
      setTextDraft([]);
      return;
    }
    const valid = Boolean(selectedId && sessions.some((s) => s.id === selectedId));
    if (!valid) {
      void selectSession(sessions[0].id);
    }
  }, [sessions, selectedId, selectSession]);

  const fkRaw = session?.source_format_key ?? null;
  const fk =
    canonicalFormatKey(fkRaw) ??
    fkRaw ??
    (session?.source_type === "url_adapt" ? "text_overlay" : null);
  const isTextOverlay = fk === "text_overlay" || fk === "carousel";
  const isBroll = fk === "b_roll_reel";

  const saveTextBlocks = useCallback(async () => {
    const cs = clientSlug.trim();
    const os = orgSlug.trim();
    if (!session || !cs || !os) return;
    setLoading(true);
    try {
      const res = await patchCreateSession(cs, os, session.id, {
        text_blocks: textDraft.filter((b) => b.text.trim()),
      });
      if (!res.ok) {
        show(res.error, "error");
        return;
      }
      setSession(res.data);
      show("Text blocks saved.", "success");
    } finally {
      setLoading(false);
    }
  }, [clientSlug, orgSlug, session, textDraft, show]);

  const onGenerateBg = useCallback(async () => {
    const cs = clientSlug.trim();
    const os = orgSlug.trim();
    if (!session || !cs || !os) return;
    setLoading(true);
    try {
      const res = await creationGenerateBackground(cs, os, session.id);
      if (!res.ok) {
        show(res.error, "error");
        return;
      }
      setSession(res.data);
      show("Background image generated.", "success");
    } finally {
      setLoading(false);
    }
  }, [clientSlug, orgSlug, session, show]);

  const onSetBroll = useCallback(async () => {
    const cs = clientSlug.trim();
    const os = orgSlug.trim();
    if (!session || !cs || !os || !selectedClipId.trim()) {
      show("Select a B-roll clip.", "error");
      return;
    }
    setLoading(true);
    try {
      const res = await creationSetBroll(cs, os, session.id, selectedClipId.trim());
      if (!res.ok) {
        show(res.error, "error");
        return;
      }
      setSession(res.data);
      show("B-roll set.", "success");
    } finally {
      setLoading(false);
    }
  }, [clientSlug, orgSlug, session, selectedClipId, show]);

  const pollRenderJob = useCallback(
    async (jobId: string, sessionId: string) => {
      const cs = clientSlug.trim();
      const os = orgSlug.trim();
      if (!cs || !os) return;
      for (let i = 0; i < MAX_POLLS; i++) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        const jr = await fetchBackgroundJob(os, jobId);
        if (!jr.ok) {
          show(jr.error, "error");
          return;
        }
        if (jr.data.status === "failed") {
          show(jr.data.error_message || "Render failed.", "error");
          const s = await generationGetSession(cs, os, sessionId);
          if (s.ok) setSession(s.data);
          return;
        }
        if (jr.data.status === "completed") {
          const s = await generationGetSession(cs, os, sessionId);
          if (s.ok) {
            setSession(s.data);
            show("Video ready.", "success");
            void reloadListAndClips();
          }
          return;
        }
      }
      show("Render is taking longer than expected. Refresh this page later.", "error");
    },
    [clientSlug, orgSlug, show, reloadListAndClips],
  );

  const onRender = useCallback(async () => {
    const cs = clientSlug.trim();
    const os = orgSlug.trim();
    if (!session || !cs || !os) return;
    setRenderBusy(true);
    try {
      const res = await creationRenderVideo(cs, os, session.id);
      if (!res.ok) {
        show(res.error, "error");
        return;
      }
      setSession((prev) =>
        prev ? { ...prev, render_status: "rendering", render_error: null } : prev,
      );
      show("Render started — this can take a few minutes.", "success");
      void pollRenderJob(res.job_id, session.id);
    } finally {
      setRenderBusy(false);
    }
  }, [clientSlug, orgSlug, session, show, pollRenderJob]);

  const onUploadBroll = useCallback(
    async (file: File | null) => {
      const cs = clientSlug.trim();
      const os = orgSlug.trim();
      if (!file || !cs || !os) return;
      if (!file.name.toLowerCase().endsWith(".mp4")) {
        show("Only .mp4 files.", "error");
        return;
      }
      setUploadBusy(true);
      try {
        const base = getContentApiBase();
        const { headers } = await clientApiContext({ orgSlug: os });
        const fd = new FormData();
        fd.append("file", file);
        const res = await contentApiFetch(`${base}/api/v1/clients/${encodeURIComponent(cs)}/broll`, {
          method: "POST",
          headers,
          body: fd,
        });
        const json = (await res.json().catch(() => ({}))) as { detail?: unknown; id?: string };
        if (!res.ok) {
          show(typeof json.detail === "string" ? json.detail : `Upload failed (${res.status})`, "error");
          return;
        }
        show("B-roll uploaded.", "success");
        const bRes = await brollList(cs, os);
        if (bRes.ok) setClips(bRes.data);
      } finally {
        setUploadBusy(false);
      }
    },
    [clientSlug, orgSlug, show],
  );

  const hookPreview = useMemo(() => {
    const h = session?.hooks;
    if (Array.isArray(h) && h[0]?.text) return h[0].text;
    return "—";
  }, [session]);

  if (!bootstrapDone) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-12 md:px-6">
        <p className="text-sm text-app-fg-secondary">Loading workspace…</p>
      </main>
    );
  }

  if (!clientSlug.trim() || !orgSlug.trim()) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-12 md:px-6">
        <div className="glass rounded-2xl border border-app-card-border p-10 text-center">
          <Video className="mx-auto mb-4 h-12 w-12 text-app-fg-muted" aria-hidden />
          <h1 className="text-lg font-semibold text-app-fg">Create</h1>
          <p className="mt-2 text-sm text-app-fg-secondary">
            No client workspace is linked to this session. Open the app from a client dashboard link
            so the API can resolve your org and client.
          </p>
        </div>
      </main>
    );
  }

  if (sessions.length === 0) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-12 md:px-6">
        <div className="glass rounded-2xl border border-app-card-border p-10 text-center">
          <Video className="mx-auto mb-4 h-12 w-12 text-app-fg-muted" aria-hidden />
          <h1 className="text-lg font-semibold text-app-fg">Create</h1>
          <p className="mt-2 text-sm text-app-fg-secondary">
            Nothing to show yet. This list only includes Generate sessions that are{" "}
            <span className="font-medium text-app-fg">content ready</span> or{" "}
            <span className="font-medium text-app-fg">approved</span>, with format{" "}
            <span className="font-medium text-app-fg">text overlay</span>,{" "}
            <span className="font-medium text-app-fg">B-roll reel</span>, or{" "}
            <span className="font-medium text-app-fg">carousel</span>. Finish a run in{" "}
            <Link href="/generate" className="font-medium text-amber-600 hover:underline dark:text-amber-400">
              Generate
            </Link>{" "}
            (pick an angle) or approve it there, then refresh.
          </p>
          <p className="mx-auto mt-3 max-w-md text-xs leading-relaxed text-app-fg-muted">
            Approved <span className="font-medium text-app-fg-secondary">URL adapt</span> runs now appear here too
            (text-overlay pipeline). If you still see nothing, refresh — or your session may be a pure{" "}
            <span className="font-medium text-app-fg-secondary">talking head</span> / other format without a visual
            layout key.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-0 max-w-6xl flex-col gap-6 px-4 py-8 md:flex-row md:px-6">
      <aside className="w-full shrink-0 md:w-64">
        <div className="mb-3 flex items-center justify-between">
          <h1 className="text-sm font-semibold text-app-fg">Sessions</h1>
          <button
            type="button"
            onClick={() => void reloadListAndClips()}
            className="rounded-lg p-1.5 text-app-fg-muted hover:bg-white/10"
            aria-label="Refresh list"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
        <p className="mb-3 text-xs text-app-fg-secondary">
          From <span className="font-medium text-app-fg">Generate</span>: visual formats, after you pick
          an angle or approve.
        </p>
        <ul className="space-y-1">
          {sessions.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => void selectSession(s.id)}
                className={`w-full rounded-xl border px-3 py-2 text-left text-xs transition-colors ${
                  selectedId === s.id
                    ? "border-sky-500/50 bg-sky-500/10 text-app-fg"
                    : "border-app-card-border bg-app-card text-app-fg-secondary hover:border-white/20"
                }`}
              >
                <div className="font-medium text-app-fg line-clamp-1">{createSessionFormatLabel(s)}</div>
                <div className="text-[10px] opacity-80">{s.render_status || "—"}</div>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="min-w-0 flex-1 space-y-6">
        {loading && !session ? (
          <div className="flex items-center gap-2 text-sm text-app-fg-secondary">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : null}

        {session ? (
          <>
            <div className="rounded-2xl border border-app-card-border bg-app-card p-5">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-300">
                  {session ? createSessionFormatLabel(session) : "—"}
                </span>
                {session.render_status ? (
                  <span className="rounded-full bg-zinc-500/20 px-2 py-0.5 text-[10px] text-zinc-300">
                    {session.render_status}
                  </span>
                ) : null}
              </div>
              <p className="text-xs text-app-fg-secondary">Hook (first tier)</p>
              <p className="mt-1 text-sm text-app-fg">{hookPreview}</p>
            </div>

            <div className="rounded-2xl border border-app-card-border bg-app-card p-5">
              <h2 className="mb-3 text-sm font-semibold text-app-fg">On-screen text blocks</h2>
              <div className="space-y-2">
                {textDraft.map((b, i) => (
                  <input
                    key={i}
                    value={b.text}
                    onChange={(e) => {
                      const next = [...textDraft];
                      next[i] = { ...next[i], text: e.target.value };
                      setTextDraft(next);
                    }}
                    className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-app-fg"
                  />
                ))}
              </div>
              <button
                type="button"
                disabled={loading}
                onClick={() => void saveTextBlocks()}
                className="mt-3 rounded-xl bg-white/10 px-4 py-2 text-xs font-semibold text-app-fg hover:bg-white/15 disabled:opacity-40"
              >
                Save text blocks
              </button>
            </div>

            <div className="rounded-2xl border border-app-card-border bg-app-card p-5">
              <h2 className="mb-3 text-sm font-semibold text-app-fg">Background</h2>
              {isTextOverlay ? (
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => void onGenerateBg()}
                  className="rounded-xl bg-emerald-500/20 px-4 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-40"
                >
                  Generate image (gpt-image-1.5)
                </button>
              ) : null}
              {isBroll ? (
                <div className="space-y-2">
                  <select
                    value={selectedClipId}
                    onChange={(e) => setSelectedClipId(e.target.value)}
                    className="w-full max-w-md rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-app-fg"
                  >
                    <option value="">Select B-roll…</option>
                    {clips.map((c) => (
                      <option key={c.id} value={c.id}>
                        {(c.label || c.id).slice(0, 48)}
                      </option>
                    ))}
                  </select>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={loading || !selectedClipId}
                      onClick={() => void onSetBroll()}
                      className="rounded-xl bg-sky-500/20 px-4 py-2 text-xs font-semibold text-sky-300 disabled:opacity-40"
                    >
                      Use selected clip
                    </button>
                    <label className="cursor-pointer rounded-xl border border-white/15 px-4 py-2 text-xs font-semibold text-app-fg hover:bg-white/5">
                      {uploadBusy ? "Uploading…" : "Upload .mp4"}
                      <input
                        type="file"
                        accept=".mp4,video/mp4"
                        className="hidden"
                        disabled={uploadBusy}
                        onChange={(e) => void onUploadBroll(e.target.files?.[0] ?? null)}
                      />
                    </label>
                  </div>
                </div>
              ) : null}
              {!isTextOverlay && !isBroll ? (
                <p className="text-xs text-app-fg-muted">Format uses static-slide fallback.</p>
              ) : null}
              {session.background_url ? (
                <p className="mt-3 break-all text-[10px] text-app-fg-muted">{session.background_url}</p>
              ) : null}
            </div>

            <div className="rounded-2xl border border-app-card-border bg-app-card p-5">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-app-fg">
                <Video className="h-4 w-4" /> Render
              </h2>
              <button
                type="button"
                disabled={
                  renderBusy ||
                  loading ||
                  session.render_status === "rendering" ||
                  !session.background_url
                }
                onClick={() => void onRender()}
                className="rounded-xl bg-violet-500/25 px-4 py-2 text-xs font-bold text-violet-200 hover:bg-violet-500/35 disabled:opacity-40"
              >
                {session.render_status === "rendering" ? "Rendering…" : "Render video"}
              </button>
              {session.render_error ? (
                <p className="mt-2 text-xs text-red-400">{session.render_error}</p>
              ) : null}
              {session.rendered_video_url ? (
                <div className="mt-4">
                  <video
                    src={session.rendered_video_url}
                    controls
                    className="max-h-[480px] w-full max-w-sm rounded-xl border border-white/10"
                  />
                  <a
                    href={session.rendered_video_url}
                    download
                    className="mt-2 inline-block text-xs text-sky-400 hover:underline"
                  >
                    Download MP4
                  </a>
                </div>
              ) : null}
            </div>

            <div className="rounded-2xl border border-app-card-border bg-app-card/50 p-5">
              <h2 className="mb-2 text-xs font-semibold text-app-fg-muted">Caption (reference)</h2>
              <p className="whitespace-pre-wrap text-xs text-app-fg-secondary">{session.caption_body || "—"}</p>
            </div>
          </>
        ) : (
          <p className="text-sm text-app-fg-secondary">Select a session from the list.</p>
        )}
      </section>
    </main>
  );
}
