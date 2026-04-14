"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Loader2,
  Save,
  Sparkles,
  Upload,
} from "lucide-react";
import {
  clientApiHeaders,
  contentApiFetch,
  formatFastApiError,
  getContentApiBase,
} from "@/lib/api-client";
import type {
  ClientContextData,
  ClientContextSection,
  DnaChatApplyResponse,
  DnaChatPreviewResponse,
} from "@/lib/api";
import {
  formatProfileCompiledRel,
  parseAnalysisBriefForDisplay,
} from "@/lib/ai-profile-brief";
import { cn } from "@/lib/cn";

export type ContextSectionKey =
  | "onboarding_transcript"
  | "icp"
  | "brand_map"
  | "story_board"
  | "communication_guideline"
  | "offer_documentation";

const SECTION_ORDER: ContextSectionKey[] = [
  "onboarding_transcript",
  "icp",
  "brand_map",
  "story_board",
  "communication_guideline",
  "offer_documentation",
];

const SECTION_META: Record<ContextSectionKey, { title: string; helper: string }> = {
  onboarding_transcript: {
    title: "Onboarding transcript",
    helper: "Raw notes or transcript from the client quiz — paste or upload, then draft the sections below.",
  },
  icp: {
    title: "Ideal client profile",
    helper: "Who they serve — demographics, psychographics, pains, desires.",
  },
  brand_map: {
    title: "Brand map",
    helper: "Positioning, values, personality, differentiators.",
  },
  story_board: {
    title: "Story board",
    helper: "Origin story, anecdotes, examples (only what you know is true).",
  },
  communication_guideline: {
    title: "Communication guideline",
    helper: "Tone, vocabulary, phrases to use or avoid.",
  },
  offer_documentation: {
    title: "Offer documentation",
    helper: "What they sell, pricing, promise, objections if mentioned.",
  },
};

const GENERATED_KEYS: Exclude<ContextSectionKey, "onboarding_transcript">[] = [
  "icp",
  "brand_map",
  "story_board",
  "communication_guideline",
  "offer_documentation",
];

function normalizeSection(raw: unknown): ClientContextSection {
  if (raw && typeof raw === "object" && "text" in raw) {
    const o = raw as Record<string, unknown>;
    const text = typeof o.text === "string" ? o.text : "";
    const source =
      o.source === "upload" ||
      o.source === "generated" ||
      o.source === "manual" ||
      o.source === "chat"
        ? o.source
        : "manual";
    let file: ClientContextSection["file"] = null;
    if (o.file && typeof o.file === "object") {
      const f = o.file as Record<string, unknown>;
      if (
        typeof f.name === "string" &&
        typeof f.storage_path === "string" &&
        typeof f.uploaded_at === "string"
      ) {
        file = {
          name: f.name,
          storage_path: f.storage_path,
          uploaded_at: f.uploaded_at,
        };
      }
    }
    const updated_at = typeof o.updated_at === "string" ? o.updated_at : null;
    return { text, source, file, updated_at };
  }
  if (typeof raw === "string") {
    return { text: raw, source: "manual", file: null, updated_at: null };
  }
  return { text: "", source: "manual", file: null, updated_at: null };
}

function normalizeFullContext(raw: ClientContextData | null | undefined): Record<
  ContextSectionKey,
  ClientContextSection
> {
  const base = raw && typeof raw === "object" ? raw : {};
  const out = {} as Record<ContextSectionKey, ClientContextSection>;
  for (const k of SECTION_ORDER) {
    out[k] = normalizeSection(base[k]);
  }
  return out;
}

function toPayload(
  state: Record<ContextSectionKey, ClientContextSection>,
): ClientContextData {
  const o: ClientContextData = {};
  for (const k of SECTION_ORDER) {
    o[k] = state[k];
  }
  return o;
}

function serializeContext(state: Record<ContextSectionKey, ClientContextSection>): string {
  return JSON.stringify(toPayload(state));
}

function parseJsonObject(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function ProfileBriefSideBySide({ beforeText, afterText }: { beforeText: string; afterText: string }) {
  const beforeDisplay = beforeText.trim() ? beforeText : "— (empty — save context and refresh profile first)";
  return (
    <div className="mt-3 grid gap-3 md:grid-cols-2">
      <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-outline-variant/15 bg-surface-container-low/70">
        <div className="shrink-0 border-b border-outline-variant/10 px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
          Current reel analysis profile
        </div>
        <div className="max-h-[min(28rem,55vh)] min-h-[8rem] overflow-y-auto px-3 py-3 text-[12px] leading-relaxed text-zinc-700 dark:text-zinc-300">
          <p className="whitespace-pre-wrap">{beforeDisplay}</p>
        </div>
      </div>
      <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-emerald-500/30 bg-emerald-500/[0.07] dark:bg-emerald-500/[0.09]">
        <div className="shrink-0 border-b border-emerald-500/25 px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-emerald-900 dark:text-emerald-200/95">
          Proposed reel analysis profile
        </div>
        <div className="max-h-[min(28rem,55vh)] min-h-[8rem] overflow-y-auto px-3 py-3 text-[12px] leading-relaxed text-on-surface">
          <p className="whitespace-pre-wrap">{afterText}</p>
        </div>
      </div>
    </div>
  );
}

function dnaUpdatedSectionLabel(key: string): string {
  if (key === "analysis_brief") return "Reel analysis profile";
  const meta = SECTION_META[key as ContextSectionKey];
  return meta?.title ?? key;
}

function firstLinePreview(text: string, max = 64): string {
  const line = text.trim().split(/\r?\n/).find((l) => l.trim()) ?? "";
  const t = line.trim();
  if (!t) return "Empty — tap to add";
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

function pickInitialOpen(
  ctx: Record<ContextSectionKey, ClientContextSection>,
): ContextSectionKey | null {
  for (const k of GENERATED_KEYS) {
    if (!ctx[k].text.trim()) return k;
  }
  return GENERATED_KEYS[0];
}

function FileSourceChip({
  file,
  source,
}: {
  file: NonNullable<ClientContextSection["file"]>;
  source: ClientContextSection["source"];
}) {
  const lower = file.name.toLowerCase();
  const ext = lower.endsWith(".pdf") ? "PDF" : lower.endsWith(".docx") ? "DOCX" : "File";
  let when = file.uploaded_at;
  try {
    when = new Date(file.uploaded_at).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    /* keep raw */
  }
  return (
    <div
      className="flex items-start gap-2 rounded-lg border border-outline-variant/20 bg-white/[0.04] px-3 py-2 text-left"
      role="status"
    >
      <FileText className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-on-surface">{file.name}</p>
        <p className="text-[10px] text-zinc-500">
          {ext} · imported {when}
          {source === "upload" ? " · text in the box came from this file" : ""}
        </p>
      </div>
    </div>
  );
}

type Props = {
  clientSlug: string;
  orgSlug: string;
  initialContext: ClientContextData | null | undefined;
  initialClientDna?: Record<string, unknown> | null;
  disabled?: boolean;
};

function dnaString(dna: Record<string, unknown> | null, k: string): string {
  if (!dna) return "";
  const v = dna[k];
  return typeof v === "string" ? v : "";
}

export function ContextEditor({
  clientSlug,
  orgSlug,
  initialContext,
  initialClientDna,
  disabled,
}: Props) {
  const router = useRouter();
  const [state, setState] = useState(() => normalizeFullContext(initialContext));
  const [baselineSig, setBaselineSig] = useState(() =>
    serializeContext(normalizeFullContext(initialContext)),
  );
  const [openStrategy, setOpenStrategy] = useState<ContextSectionKey | null>(() =>
    pickInitialOpen(normalizeFullContext(initialContext)),
  );
  const [saveBusy, setSaveBusy] = useState(false);
  const [genBusy, setGenBusy] = useState(false);
  /** In-flight import: show filename + step copy for that section only. */
  const [uploadActivity, setUploadActivity] = useState<{
    section: ContextSectionKey;
    fileName: string;
    step: "send" | "read";
  } | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [clientDna, setClientDna] = useState<Record<string, unknown> | null>(() =>
    initialClientDna && typeof initialClientDna === "object" ? { ...initialClientDna } : null,
  );
  const [dnaBusy, setDnaBusy] = useState(false);
  const [dnaChatInput, setDnaChatInput] = useState("");
  const [dnaChatBusy, setDnaChatBusy] = useState(false);
  const [dnaApplyBusy, setDnaApplyBusy] = useState(false);
  const [dnaChatPreview, setDnaChatPreview] = useState<DnaChatPreviewResponse | null>(null);
  const [dnaChatUpdatedKeys, setDnaChatUpdatedKeys] = useState<string[]>([]);

  useEffect(() => {
    setClientDna(
      initialClientDna && typeof initialClientDna === "object" ? { ...initialClientDna } : null,
    );
  }, [initialClientDna]);

  useEffect(() => {
    const next = normalizeFullContext(initialContext);
    setState(next);
    setBaselineSig(serializeContext(next));
    setOpenStrategy(pickInitialOpen(next));
  }, [initialContext]);

  /** After ~700ms still waiting, switch copy to “reading” (server is uploading + extracting). */
  useEffect(() => {
    if (!uploadActivity) return;
    const t = window.setTimeout(() => {
      setUploadActivity((prev) => (prev ? { ...prev, step: "read" } : null));
    }, 700);
    return () => window.clearTimeout(t);
  }, [uploadActivity?.section, uploadActivity?.fileName]);

  const dirty = useMemo(() => serializeContext(state) !== baselineSig, [state, baselineSig]);

  const filledStrategyCount = useMemo(
    () => GENERATED_KEYS.filter((k) => state[k].text.trim().length > 0).length,
    [state],
  );

  const transcriptLen = state.onboarding_transcript.text.trim().length;
  const canGenerate = transcriptLen >= 40 && !disabled && !genBusy;

  const analysisBriefText = useMemo(
    () => dnaString(clientDna, "analysis_brief"),
    [clientDna],
  );
  const analysisBlocks = useMemo(
    () => parseAnalysisBriefForDisplay(analysisBriefText),
    [analysisBriefText],
  );
  const profileReady = analysisBriefText.trim().length > 0;

  const sourceFeedLabels = useMemo(() => {
    const labels: string[] = [];
    for (const k of SECTION_ORDER) {
      if (state[k].text.trim().length > 0) {
        labels.push(SECTION_META[k].title);
      }
    }
    return labels;
  }, [state]);

  const compiledAtIso =
    clientDna && typeof clientDna.compiled_at === "string" ? clientDna.compiled_at : null;
  const compiledRel = compiledAtIso ? formatProfileCompiledRel(compiledAtIso) : "";

  function toggleStrategy(key: ContextSectionKey) {
    setOpenStrategy((prev) => (prev === key ? null : key));
  }

  const canDnaChatPreview =
    dnaChatInput.trim().length >= 10 &&
    !disabled &&
    !dnaChatBusy &&
    !dnaApplyBusy &&
    !saveBusy &&
    dnaChatPreview === null;

  const previewSectionKeys = useMemo(() => {
    if (!dnaChatPreview?.changed_sections) return [];
    return Object.keys(dnaChatPreview.changed_sections).filter(
      (k) => typeof dnaChatPreview.changed_sections[k] === "string",
    );
  }, [dnaChatPreview]);

  const canDnaChatApply =
    dnaChatPreview !== null &&
    previewSectionKeys.length > 0 &&
    !dnaApplyBusy &&
    !dnaChatBusy &&
    !saveBusy;

  async function handleDnaChatPreview() {
    if (!canDnaChatPreview || !clientSlug.trim() || !orgSlug.trim()) return;
    setDnaChatBusy(true);
    setStatus(null);
    setDnaChatUpdatedKeys([]);
    setDnaChatPreview(null);
    const apiBase = getContentApiBase();
    const headersBase = await clientApiHeaders({ orgSlug });
    try {
      const r = await contentApiFetch(
        `${apiBase}/api/v1/clients/${encodeURIComponent(clientSlug)}/dna/chat-preview`,
        {
          method: "POST",
          headers: { ...headersBase, "Content-Type": "application/json" },
          body: JSON.stringify({ message: dnaChatInput.trim() }),
        },
      );
      const text = await r.text();
      const json = parseJsonObject(text) as DnaChatPreviewResponse | Record<string, unknown> | null;
      if (!r.ok) {
        setStatus(formatFastApiError(json as Record<string, unknown>, text));
        return;
      }
      if (!json || typeof json !== "object" || !("summary" in json)) {
        setStatus("Unexpected response.");
        return;
      }
      const u = json as DnaChatPreviewResponse;
      setDnaChatPreview({
        summary: typeof u.summary === "string" ? u.summary : "",
        changed_sections:
          u.changed_sections && typeof u.changed_sections === "object"
            ? (u.changed_sections as Record<string, string>)
            : {},
        before: u.before && typeof u.before === "object" ? (u.before as Record<string, string>) : {},
        updated_sections: Array.isArray(u.updated_sections) ? u.updated_sections : [],
      });
      setStatus(u.summary);
    } catch {
      setStatus("Network error.");
    } finally {
      setDnaChatBusy(false);
    }
  }

  function handleDnaChatRejectPreview() {
    setDnaChatPreview(null);
    setStatus(null);
    setDnaChatUpdatedKeys([]);
  }

  async function handleDnaChatApply() {
    if (!canDnaChatApply || !dnaChatPreview || !clientSlug.trim() || !orgSlug.trim()) return;
    setDnaApplyBusy(true);
    setStatus(null);
    setDnaChatUpdatedKeys([]);
    const apiBase = getContentApiBase();
    const headersBase = await clientApiHeaders({ orgSlug });
    try {
      const r = await contentApiFetch(
        `${apiBase}/api/v1/clients/${encodeURIComponent(clientSlug)}/dna/chat-apply`,
        {
          method: "POST",
          headers: { ...headersBase, "Content-Type": "application/json" },
          body: JSON.stringify({
            changed_sections: dnaChatPreview.changed_sections,
            summary: dnaChatPreview.summary,
          }),
        },
      );
      const text = await r.text();
      const json = parseJsonObject(text) as DnaChatApplyResponse | Record<string, unknown> | null;
      if (!r.ok) {
        setStatus(formatFastApiError(json as Record<string, unknown>, text));
        return;
      }
      if (!json || typeof json !== "object" || !("client" in json)) {
        setStatus("Unexpected response.");
        return;
      }
      const u = json as DnaChatApplyResponse;
      setStatus(typeof u.summary === "string" ? u.summary : "Changes applied.");
      setDnaChatUpdatedKeys(Array.isArray(u.updated_sections) ? u.updated_sections : []);
      setDnaChatInput("");
      setDnaChatPreview(null);
      if (u.client?.client_dna && typeof u.client.client_dna === "object") {
        setClientDna({ ...(u.client.client_dna as Record<string, unknown>) });
      }
      if (u.client?.client_context && typeof u.client.client_context === "object") {
        const normalized = normalizeFullContext(
          u.client.client_context as ClientContextData,
        );
        setState(normalized);
        setBaselineSig(serializeContext(normalized));
      }
      router.refresh();
    } catch {
      setStatus("Network error.");
    } finally {
      setDnaApplyBusy(false);
    }
  }

  async function handleRegenerateDna() {
    if (disabled || !clientSlug.trim() || !orgSlug.trim()) return;
    setDnaBusy(true);
    setStatus(null);
    const apiBase = getContentApiBase();
    const headersBase = await clientApiHeaders({ orgSlug });
    try {
      const r = await contentApiFetch(
        `${apiBase}/api/v1/clients/${encodeURIComponent(clientSlug)}/dna/regenerate`,
        { method: "POST", headers: headersBase },
      );
      const text = await r.text();
      const json = parseJsonObject(text) as { client_dna?: unknown } | null;
      if (!r.ok) {
        setStatus(formatFastApiError(json as Record<string, unknown>, text));
        return;
      }
      if (json && typeof json === "object" && json.client_dna && typeof json.client_dna === "object") {
        setClientDna({ ...(json.client_dna as Record<string, unknown>) });
      }
      setStatus("Client DNA regenerated.");
      router.refresh();
    } catch {
      setStatus("Network error.");
    } finally {
      setDnaBusy(false);
    }
  }

  function setSectionText(key: ContextSectionKey, text: string) {
    setState((prev) => ({
      ...prev,
      [key]: {
        ...prev[key],
        text,
        source: "manual",
        updated_at: prev[key].updated_at,
      },
    }));
  }

  async function handleSave() {
    if (disabled || !clientSlug.trim() || !orgSlug.trim()) {
      setStatus("Pick a workspace and creator first.");
      return;
    }
    setSaveBusy(true);
    setStatus(null);
    const apiBase = getContentApiBase();
    const headersBase = await clientApiHeaders({ orgSlug });
    const now = new Date().toISOString();
    const next = { ...state };
    for (const k of SECTION_ORDER) {
      next[k] = { ...next[k], updated_at: now };
    }
    try {
      const r = await contentApiFetch(
        `${apiBase}/api/v1/clients/${encodeURIComponent(clientSlug)}`,
        {
          method: "PUT",
          headers: { ...headersBase, "Content-Type": "application/json" },
          body: JSON.stringify({ client_context: toPayload(next) }),
        },
      );
      const text = await r.text();
      if (!r.ok) {
        setStatus(formatFastApiError(parseJsonObject(text), text));
        return;
      }
      const updated = parseJsonObject(text) as { client_context?: ClientContextData | null } | null;
      const normalized = normalizeFullContext(updated?.client_context);
      setState(normalized);
      setBaselineSig(serializeContext(normalized));
      setStatus(
        "Saved. Your AI profile updates in the background when your source data changes.",
      );
      router.refresh();
    } catch {
      setStatus("Network error.");
    } finally {
      setSaveBusy(false);
    }
  }

  async function handleGenerate() {
    if (!canGenerate) return;
    setGenBusy(true);
    setStatus(null);
    const apiBase = getContentApiBase();
    const headersBase = await clientApiHeaders({ orgSlug });
    try {
      const r = await contentApiFetch(
        `${apiBase}/api/v1/clients/${encodeURIComponent(clientSlug)}/context/generate`,
        {
          method: "POST",
          headers: { ...headersBase, "Content-Type": "application/json" },
          body: JSON.stringify({ transcript: state.onboarding_transcript.text.trim() }),
        },
      );
      const text = await r.text();
      if (!r.ok) {
        setStatus(formatFastApiError(parseJsonObject(text), text));
        return;
      }
      const j = parseJsonObject(text);
      if (!j || typeof j !== "object") {
        setStatus("Unexpected response.");
        return;
      }
      const sections = (j as { sections?: unknown }).sections;
      if (!sections || typeof sections !== "object") {
        setStatus("Unexpected response.");
        return;
      }
      const sec = sections as Record<string, string>;
      setState((prev) => {
        const copy = { ...prev };
        for (const k of GENERATED_KEYS) {
          const t = typeof sec[k] === "string" ? sec[k] : "";
          copy[k] = {
            ...copy[k],
            text: t,
            source: "generated",
            file: null,
          };
        }
        return copy;
      });
      setOpenStrategy("icp");
      setStatus("Draft sections ready — review and save.");
    } catch {
      setStatus("Network error.");
    } finally {
      setGenBusy(false);
    }
  }

  async function handleUpload(key: ContextSectionKey, file: File | null) {
    if (!file || disabled || !clientSlug.trim() || !orgSlug.trim()) return;
    const lower = file.name.toLowerCase();
    if (!lower.endsWith(".pdf") && !lower.endsWith(".docx")) {
      setStatus("Only PDF or DOCX files work here.");
      return;
    }
    setUploadActivity({ section: key, fileName: file.name, step: "send" });
    setStatus(null);
    const apiBase = getContentApiBase();
    const headersBase = await clientApiHeaders({ orgSlug });
    const fd = new FormData();
    fd.set("section", key);
    fd.set("file", file);
    try {
      const r = await contentApiFetch(
        `${apiBase}/api/v1/clients/${encodeURIComponent(clientSlug)}/context/upload`,
        {
          method: "POST",
          headers: headersBase,
          body: fd,
        },
      );
      const text = await r.text();
      if (!r.ok) {
        setStatus(formatFastApiError(parseJsonObject(text), text));
        return;
      }
      const j = parseJsonObject(text);
      if (!j || typeof j !== "object") {
        setStatus("Unexpected response.");
        return;
      }
      const row = j as {
        section?: string;
        text?: string;
        file?: { name: string; storage_path: string; uploaded_at: string };
      };
      const sec = row.section as ContextSectionKey;
      if (!sec || !SECTION_ORDER.includes(sec)) {
        setStatus("Upload response missing section.");
        return;
      }
      setState((prev) => ({
        ...prev,
        [sec]: {
          text: typeof row.text === "string" ? row.text : "",
          source: "upload",
          file: row.file ?? null,
          updated_at: prev[sec].updated_at,
        },
      }));
      if (GENERATED_KEYS.includes(sec as (typeof GENERATED_KEYS)[number])) {
        setOpenStrategy(sec as ContextSectionKey);
      }
      setStatus(`Imported from ${row.file?.name ?? "file"} — save when ready.`);
    } catch {
      setStatus("Network error.");
    } finally {
      setUploadActivity(null);
    }
  }

  if (!clientSlug.trim() || !orgSlug.trim()) {
    return (
      <p className="text-sm text-app-fg-muted">
        Select a creator in the header to edit context.
      </p>
    );
  }

  const hero = SECTION_META.onboarding_transcript;
  const tRow = state.onboarding_transcript;
  const heroUpload = uploadActivity?.section === "onboarding_transcript" ? uploadActivity : null;
  const busyUpT = Boolean(heroUpload);

  return (
    <div className="relative pb-28">
      {status ? (
        <p className="mb-4 rounded-lg border border-outline-variant/20 bg-surface-container-low/50 px-3 py-2 text-sm text-app-fg-secondary">
          {status}
        </p>
      ) : null}

      <section className="mb-8 rounded-2xl border border-emerald-500/20 bg-gradient-to-b from-emerald-500/[0.07] to-transparent p-5 shadow-sm dark:from-emerald-500/[0.05]">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-on-surface">AI profile</h2>
            <p className="mt-1 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
              This is what Silas uses to judge reels for <span className="font-medium">this</span>{" "}
              creator — who they are, who they serve, and what &ldquo;good&rdquo; content means for
              them. It is built automatically from the sections below (and your Instagram
              niche profile when available).
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {profileReady ? (
                <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-300/95">
                  Ready for reel analysis
                </span>
              ) : (
                <span className="rounded-full bg-zinc-500/15 px-2.5 py-0.5 text-[10px] font-medium text-zinc-500">
                  Not built yet
                </span>
              )}
              {compiledRel ? (
                <span className="text-[10px] text-zinc-500 dark:text-zinc-400">
                  Updated {compiledRel}
                </span>
              ) : null}
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
              {sourceFeedLabels.length > 0 ? (
                <>
                  <span className="font-medium text-zinc-600 dark:text-zinc-300">Sources in use:</span>{" "}
                  {sourceFeedLabels.join(" · ")}
                </>
              ) : (
                <>Fill in the transcript and strategy sections below, then save — your profile generates in the background.</>
              )}
            </p>
          </div>
          <button
            type="button"
            disabled={disabled || dnaBusy}
            onClick={() => void handleRegenerateDna()}
            className="inline-flex shrink-0 items-center gap-2 self-start rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-900 disabled:opacity-50 dark:text-emerald-200/95"
          >
            {dnaBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
            {dnaBusy ? "Refreshing…" : "Refresh AI profile"}
          </button>
        </div>

        <div className="mt-4 rounded-xl border border-outline-variant/10 bg-surface-container/80 p-3">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
            Reel analysis understanding
          </h3>
          {profileReady ? (
            <div className="mt-2 max-h-72 space-y-3 overflow-y-auto text-[12px] leading-relaxed text-app-fg-secondary">
              {analysisBlocks.map((b, i) =>
                b.heading ? (
                  <div key={`${b.heading}-${i}`}>
                    <p className="font-semibold text-on-surface">{b.heading}</p>
                    <p className="mt-1 whitespace-pre-wrap text-zinc-600 dark:text-zinc-400">
                      {b.body}
                    </p>
                  </div>
                ) : (
                  <p key={i} className="whitespace-pre-wrap text-zinc-600 dark:text-zinc-400">
                    {b.body}
                  </p>
                ),
              )}
            </div>
          ) : (
            <p className="mt-2 text-xs text-zinc-500">
              Nothing here yet. Save your context, or tap Refresh — your server needs OpenRouter
              configured to compile the profile.
            </p>
          )}
        </div>

        <div className="mt-5 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-4 dark:border-emerald-500/15 dark:bg-emerald-500/[0.05]">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-emerald-900 dark:text-emerald-200/95">
            Refine reel analysis profile from a message
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
            Adjusts only the compiled profile above — not your strategy sections or uploads. Use
            after a pivot or tone change; tap Refresh AI profile anytime to rebuild from saved
            context instead.
          </p>
          <textarea
            value={dnaChatInput}
            onChange={(e) => setDnaChatInput(e.target.value)}
            disabled={disabled || dnaChatBusy || dnaApplyBusy || dnaChatPreview !== null}
            rows={3}
            className="mt-3 w-full resize-y rounded-xl border border-outline-variant/15 bg-surface-container-low/90 px-3 py-2.5 text-sm text-on-surface placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/35 disabled:opacity-50"
            placeholder="e.g. She is moving away from toxic-boss angles and focusing on assertive leadership for women in tech."
          />
          <div className="mt-2 flex flex-wrap items-center gap-3">
            {dnaChatPreview ? (
              <>
                <button
                  type="button"
                  disabled={!canDnaChatApply || dnaApplyBusy}
                  onClick={() => void handleDnaChatApply()}
                  className="inline-flex items-center gap-2 rounded-lg border border-emerald-600/45 bg-emerald-600/15 px-4 py-2 text-sm font-semibold text-emerald-950 disabled:opacity-50 dark:text-emerald-100"
                >
                  {dnaApplyBusy ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  ) : null}
                  {dnaApplyBusy ? "Saving…" : "Approve & save profile"}
                </button>
                <button
                  type="button"
                  disabled={dnaApplyBusy}
                  onClick={handleDnaChatRejectPreview}
                  className="inline-flex items-center gap-2 rounded-lg border border-outline-variant/25 bg-surface-container/80 px-4 py-2 text-sm font-medium text-app-fg-secondary disabled:opacity-50"
                >
                  Reject
                </button>
              </>
            ) : (
              <button
                type="button"
                disabled={!canDnaChatPreview}
                onClick={() => void handleDnaChatPreview()}
                className="inline-flex items-center gap-2 rounded-lg border border-emerald-600/45 bg-emerald-600/15 px-4 py-2 text-sm font-semibold text-emerald-950 disabled:opacity-50 dark:text-emerald-100"
              >
                {dnaChatBusy ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : null}
                {dnaChatBusy ? "Previewing…" : "Preview changes"}
              </button>
            )}
            {dnaChatPreview === null &&
            dnaChatInput.trim().length > 0 &&
            dnaChatInput.trim().length < 10 ? (
              <span className="text-[11px] text-zinc-500">At least 10 characters.</span>
            ) : null}
          </div>
          {dnaChatPreview && previewSectionKeys.length > 0 ? (
            <div className="mt-4 rounded-xl border border-outline-variant/12 bg-surface-container/75 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                Review
              </p>
              {dnaChatPreview.summary ? (
                <p className="mt-2 text-xs leading-relaxed text-zinc-700 dark:text-zinc-300">
                  {dnaChatPreview.summary}
                </p>
              ) : null}
              <ProfileBriefSideBySide
                beforeText={dnaChatPreview.before["analysis_brief"] ?? ""}
                afterText={dnaChatPreview.changed_sections["analysis_brief"] ?? ""}
              />
            </div>
          ) : null}
          {dnaChatPreview && previewSectionKeys.length === 0 ? (
            <p className="mt-3 text-xs text-zinc-600 dark:text-zinc-400">
              No change to the reel analysis profile was proposed. Adjust your message and preview
              again, or reject to dismiss.
            </p>
          ) : null}
          {dnaChatUpdatedKeys.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {dnaChatUpdatedKeys.map((key) => (
                <span
                  key={key}
                  className="rounded-full bg-emerald-600/20 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-900 dark:text-emerald-200/95"
                >
                  {dnaUpdatedSectionLabel(key)}
                </span>
              ))}
            </div>
          ) : null}
        </div>

        <p className="mt-3 text-[10px] text-zinc-500 dark:text-zinc-500">
          Voice and hook-generation profiles are prepared in the background and will connect when
          those tools ship.
        </p>
      </section>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500">
        <span>
          <span className="font-semibold text-app-fg-secondary">{filledStrategyCount}</span>
          {" / "}
          {GENERATED_KEYS.length} strategy sections have content
        </span>
        <button
          type="button"
          className="text-amber-600 hover:underline dark:text-amber-400"
          onClick={() => setOpenStrategy(null)}
        >
          Collapse all
        </button>
      </div>

      <section className="mb-6 rounded-2xl border border-amber-500/25 bg-gradient-to-b from-amber-500/10 to-transparent p-5 shadow-sm dark:from-amber-500/8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-on-surface">{hero.title}</h2>
            <p className="mt-0.5 text-xs text-zinc-500" title={hero.helper}>
              {hero.helper}
            </p>
          </div>
          <label className="inline-flex shrink-0 cursor-pointer items-center gap-2 self-start rounded-lg border border-outline-variant/25 bg-surface-container/80 px-3 py-2 text-xs font-medium text-app-fg-secondary hover:bg-white/[0.06]">
            {busyUpT ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Upload className="h-3.5 w-3.5" aria-hidden />
            )}
            <span>Upload PDF / DOCX</span>
            <input
              type="file"
              accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className="sr-only"
              disabled={disabled || busyUpT}
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                e.target.value = "";
                void handleUpload("onboarding_transcript", f);
              }}
            />
          </label>
        </div>
        {heroUpload ? (
          <div
            className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs text-app-fg-secondary"
            role="status"
            aria-live="polite"
          >
            <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-amber-600 dark:text-amber-400" />
            <div>
              <p className="font-medium text-on-surface">Importing {heroUpload.fileName}</p>
              <p className="mt-0.5 text-zinc-600 dark:text-zinc-400">
                {heroUpload.step === "send"
                  ? "Sending file to the server…"
                  : "Reading the document and pulling text into the box…"}
              </p>
            </div>
          </div>
        ) : tRow.file ? (
          <div className="mt-3">
            <FileSourceChip file={tRow.file} source={tRow.source} />
          </div>
        ) : null}
        <textarea
          value={tRow.text}
          onChange={(e) => setSectionText("onboarding_transcript", e.target.value)}
          disabled={disabled || busyUpT}
          rows={8}
          className="mt-3 w-full resize-y rounded-xl border border-outline-variant/15 bg-surface-container-low/90 px-3 py-2.5 text-sm text-on-surface placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500/40 disabled:opacity-50"
          placeholder="Paste the onboarding call transcript or notes here…"
        />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={!canGenerate}
            onClick={() => void handleGenerate()}
            className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-sm font-bold text-zinc-950 disabled:opacity-50"
          >
            {genBusy ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Sparkles className="h-4 w-4" aria-hidden />
            )}
            {genBusy ? "Drafting…" : "Draft strategy sections"}
          </button>
          {transcriptLen < 40 ? (
            <span className="text-xs text-zinc-500">Need 40+ characters to draft.</span>
          ) : null}
        </div>
      </section>

      <h3 className="mb-0.5 text-xs font-bold uppercase tracking-wider text-zinc-500">
        Strategy docs
      </h3>
      <p className="mb-2 text-[11px] text-zinc-500 dark:text-zinc-400">
        Everything here rolls into the AI profile at the top when you save.
      </p>
      <ul className="space-y-1.5">
        {GENERATED_KEYS.map((key) => {
          const meta = SECTION_META[key];
          const row = state[key];
          const open = openStrategy === key;
          const rowUpload = uploadActivity?.section === key ? uploadActivity : null;
          const busyUp = Boolean(rowUpload);
          const filled = row.text.trim().length > 0;
          return (
            <li
              key={key}
              className="overflow-hidden rounded-xl border border-outline-variant/10 bg-surface-container"
            >
              <button
                type="button"
                disabled={disabled}
                onClick={() => toggleStrategy(key)}
                className={cn(
                  "flex w-full items-start gap-2 px-3 py-3 text-left transition-colors hover:bg-white/[0.04]",
                  open && "border-b border-outline-variant/10 bg-white/[0.02]",
                )}
                aria-expanded={open}
              >
                {open ? (
                  <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" aria-hidden />
                ) : (
                  <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" aria-hidden />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-on-surface" title={meta.helper}>
                      {meta.title}
                    </span>
                    {filled ? (
                      <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
                        Filled
                      </span>
                    ) : null}
                    {row.file && !busyUp ? (
                      <span className="rounded-full bg-zinc-500/15 px-2 py-0.5 text-[10px] font-medium text-zinc-500">
                        File attached
                      </span>
                    ) : null}
                    {busyUp && rowUpload ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                        Importing…
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-zinc-500">
                    {busyUp && rowUpload
                      ? rowUpload.step === "send"
                        ? `Sending ${rowUpload.fileName}…`
                        : `Reading ${rowUpload.fileName}…`
                      : firstLinePreview(row.text)}
                  </p>
                </div>
              </button>
              {open ? (
                <div className="space-y-2 px-3 pb-3 pt-1 sm:pl-9">
                  <div className="flex justify-end">
                    <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-outline-variant/20 px-2.5 py-1.5 text-[11px] font-medium text-app-fg-secondary hover:bg-white/[0.04]">
                      {busyUp ? (
                        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                      ) : (
                        <Upload className="h-3 w-3" aria-hidden />
                      )}
                      <span>PDF / DOCX</span>
                      <input
                        type="file"
                        accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                        className="sr-only"
                        disabled={disabled || busyUp}
                        onChange={(e) => {
                          const f = e.target.files?.[0] ?? null;
                          e.target.value = "";
                          void handleUpload(key, f);
                        }}
                      />
                    </label>
                  </div>
                  {rowUpload ? (
                    <div
                      className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs"
                      role="status"
                      aria-live="polite"
                    >
                      <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-amber-600 dark:text-amber-400" />
                      <div>
                        <p className="font-medium text-on-surface">Importing {rowUpload.fileName}</p>
                        <p className="mt-0.5 text-[11px] text-zinc-500">
                          {rowUpload.step === "send"
                            ? "Sending file…"
                            : "Reading document and filling the text box…"}
                        </p>
                      </div>
                    </div>
                  ) : row.file ? (
                    <FileSourceChip file={row.file} source={row.source} />
                  ) : null}
                  <textarea
                    value={row.text}
                    onChange={(e) => setSectionText(key, e.target.value)}
                    disabled={disabled || busyUp}
                    rows={7}
                    className="w-full resize-y rounded-lg border border-outline-variant/15 bg-surface-container-low/80 px-3 py-2 text-sm text-on-surface placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500/40 disabled:opacity-50"
                    placeholder="Write or upload…"
                  />
                  <p className="text-[10px] text-zinc-500">
                    {row.updated_at
                      ? `Saved ${new Date(row.updated_at).toLocaleString()}`
                      : "Not saved to server yet"}
                    {" · "}
                    Source: {row.source}
                  </p>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      <div
        className={cn(
          "sticky bottom-0 z-20 -mx-1 mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-outline-variant/15 bg-zinc-50/95 px-3 py-3 backdrop-blur-md dark:bg-zinc-950/90",
        )}
      >
        <span className="text-sm text-app-fg-secondary">
          {dirty ? (
            <span className="font-medium text-amber-700 dark:text-amber-400">Unsaved changes</span>
          ) : (
            <span className="text-zinc-500">All saved</span>
          )}
        </span>
        <button
          type="button"
          disabled={disabled || saveBusy || !dirty}
          onClick={() => void handleSave()}
          className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-5 py-2.5 text-sm font-bold text-zinc-950 disabled:opacity-50"
        >
          {saveBusy ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Save className="h-4 w-4" aria-hidden />
          )}
          {saveBusy ? "Saving…" : "Save all"}
        </button>
      </div>
    </div>
  );
}
