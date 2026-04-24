"use client";

import dynamic from "next/dynamic";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type PointerEvent as ReactPointerEvent } from "react";
import { DEFAULT_LAYOUT, type VideoSpec } from "@/lib/video-spec";
import { segmentDurationRange } from "@/lib/video-spec-timing";
import Renderer from "@/remotion-spec/Renderer";

const Player = dynamic(
  () => import("@remotion/player").then((m) => m.Player),
  { ssr: false },
);

/** Remotion Player typings expect `Record<string, unknown>`; our Renderer is VideoSpec-typed. */
const RendererLoose = Renderer as ComponentType<Record<string, unknown>>;

/** Match the `<Composition>` declared in `broll-caption-editor/src/Root.tsx`. */
const FPS = 30;
const COMP_W = 1080;
const COMP_H = 1920;
const ENTRANCE_DURATION_SEC = 0.45;

/** Hit width for each boundary handle (Premiere-style: one grip between clips). */
const BOUNDARY_HIT_PX = 10;
/** Ignore sub-pixel jitter as non-drags. */
const DRAG_THRESHOLD_PX = 3;

/** Player ref — only need frame subscription for the edit playhead + seek. */
type PlayerHandle = {
  getCurrentFrame?: () => number;
  seekTo?: (frame: number) => void;
  addEventListener?: (name: string, cb: (...args: unknown[]) => void) => void;
  removeEventListener?: (name: string, cb: (...args: unknown[]) => void) => void;
};

type Props = {
  spec: VideoSpec | null;
  safeZone?: boolean;
  layoutGuides?: boolean;
  width?: number;
  selectedSegmentId?: string | null;
  onSelectSegment?: (id: string) => void;
  onResizeSegmentDraft?: (id: string, durationSec: number) => void;
  onResizeSegmentCommit?: (id: string, durationSec: number) => void;
};

function VideoSpecPreviewBase({
  spec,
  safeZone = false,
  layoutGuides = false,
  width = 280,
  selectedSegmentId = null,
  onSelectSegment,
  onResizeSegmentDraft,
  onResizeSegmentCommit,
}: Props) {
  const playerRef = useRef<PlayerHandle | null>(null);
  const stripRef = useRef<HTMLDivElement | null>(null);

  const durationInFrames = useMemo(
    () => Math.max(1, Math.ceil((spec?.totalSec ?? 8) * FPS)),
    [spec?.totalSec],
  );

  const initialFrame = useMemo(
    () => Math.min(durationInFrames - 1, Math.round(ENTRANCE_DURATION_SEC * FPS)),
    [durationInFrames],
  );

  /** Playhead on the edit strip — native Player controls handle playback UI. */
  const [currentFrame, setCurrentFrame] = useState(initialFrame);

  useEffect(() => {
    const p = playerRef.current;
    if (!p?.addEventListener) return;
    const onFrame = (...args: unknown[]) => {
      const ev = args[0] as { frame?: number } | undefined;
      if (ev && typeof ev.frame === "number") setCurrentFrame(ev.frame);
    };
    p.addEventListener("frameupdate", onFrame);
    if (p.getCurrentFrame) setCurrentFrame(p.getCurrentFrame());
    return () => {
      p.removeEventListener?.("frameupdate", onFrame);
    };
  }, [durationInFrames]);

  const segments = useMemo(() => {
    if (!spec) return [];
    const total = Math.max(0.001, spec.totalSec);
    const items: {
      id: string;
      label: string;
      startSec: number;
      durSec: number;
      leftPct: number;
      widthPct: number;
      isCTA: boolean;
      kind: "hook" | "block";
    }[] = [];
    if (spec.hook.text.trim()) {
      items.push({
        id: "hook",
        label: "Hook",
        startSec: 0,
        durSec: spec.hook.durationSec,
        leftPct: 0,
        widthPct: (spec.hook.durationSec / total) * 100,
        isCTA: false,
        kind: "hook",
      });
    }
    spec.blocks.forEach((b, i) => {
      const dur = Math.max(0, b.endSec - b.startSec);
      items.push({
        id: b.id,
        label: b.isCTA ? "CTA" : `B${i + 1}`,
        startSec: b.startSec,
        durSec: dur,
        leftPct: (b.startSec / total) * 100,
        widthPct: (dur / total) * 100,
        isCTA: !!b.isCTA,
        kind: "block",
      });
    });
    return items;
  }, [spec]);

  /** Visible empty windows between adjacent segments. We draw a dashed badge so
   *  the user can SEE the pause they set — without this, a small gap (e.g. 0.4s
   *  on a 12s timeline = 3% of width) reads as "nothing happened". */
  const gaps = useMemo(() => {
    if (!spec) return [] as { id: string; leftPct: number; widthPct: number; sec: number }[];
    const total = Math.max(0.001, spec.totalSec);
    const out: { id: string; leftPct: number; widthPct: number; sec: number }[] = [];
    for (let i = 0; i < segments.length - 1; i += 1) {
      const a = segments[i]!;
      const b = segments[i + 1]!;
      const aEnd = a.startSec + a.durSec;
      const gapSec = Math.max(0, b.startSec - aEnd);
      if (gapSec < 0.05) continue;
      out.push({
        id: `gap-${a.id}-${b.id}`,
        leftPct: (aEnd / total) * 100,
        widthPct: (gapSec / total) * 100,
        sec: gapSec,
      });
    }
    return out;
  }, [segments, spec]);

  /** Boundary k sits between segments[k] and segments[k+1]. Dragging resizes the
   *  LEFT segment's duration — same semantics as dragging that segment's out-point
   *  in NLEs, without N duplicate right-edge grips cluttering narrow segments. */
  const dragStateRef = useRef<{
    leftSegId: string;
    startClientX: number;
    startDurationSec: number;
    pixelsPerSec: number;
    minDur: number;
    maxDur: number;
    moved: boolean;
    lastDur: number;
  } | null>(null);

  const dragJustEndedRef = useRef(false);

  const onBoundaryResizeStart = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>, boundaryIndex: number) => {
      const stripEl = stripRef.current;
      if (!stripEl || !spec) return;
      const left = segments[boundaryIndex];
      if (!left || !segments[boundaryIndex + 1]) return;
      e.preventDefault();
      e.stopPropagation();
      const stripRect = stripEl.getBoundingClientRect();
      const pxPerSec = stripRect.width / Math.max(0.001, spec.totalSec);
      const range = segmentDurationRange(left.id);
      dragStateRef.current = {
        leftSegId: left.id,
        startClientX: e.clientX,
        startDurationSec: left.durSec,
        pixelsPerSec: pxPerSec,
        minDur: range.min,
        maxDur: range.max,
        moved: false,
        lastDur: left.durSec,
      };
      const onMove = (mv: PointerEvent) => {
        const st = dragStateRef.current;
        if (!st) return;
        const deltaPx = mv.clientX - st.startClientX;
        if (!st.moved && Math.abs(deltaPx) >= DRAG_THRESHOLD_PX) st.moved = true;
        if (!st.moved) return;
        const rawDur = st.startDurationSec + deltaPx / st.pixelsPerSec;
        const clamped = Math.max(st.minDur, Math.min(st.maxDur, rawDur));
        const snapped = Math.round(clamped * 10) / 10;
        if (snapped !== st.lastDur) {
          st.lastDur = snapped;
          onResizeSegmentDraft?.(st.leftSegId, snapped);
        }
      };
      const onUp = () => {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        document.removeEventListener("pointercancel", onUp);
        const st = dragStateRef.current;
        dragStateRef.current = null;
        if (!st) return;
        if (st.moved) {
          dragJustEndedRef.current = true;
          window.setTimeout(() => {
            dragJustEndedRef.current = false;
          }, 50);
          onResizeSegmentCommit?.(st.leftSegId, st.lastDur);
        }
      };
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
      document.addEventListener("pointercancel", onUp);
    },
    [onResizeSegmentDraft, onResizeSegmentCommit, segments, spec],
  );

  const playheadPct = useMemo(() => {
    if (durationInFrames <= 1) return 0;
    return (currentFrame / (durationInFrames - 1)) * 100;
  }, [currentFrame, durationInFrames]);

  if (!spec) {
    return (
      <div
        style={{ width, aspectRatio: "9 / 16" }}
        className="flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-app-divider/70 bg-app-chip-bg/20 px-3 text-center text-[11px] text-app-fg-muted"
      >
        <span className="font-semibold text-app-fg-subtle">No preview yet</span>
        <span>Save text blocks and pick a background to render the layout.</span>
      </div>
    );
  }

  const seekToSec = (sec: number) => {
    const f = Math.max(0, Math.min(durationInFrames - 1, Math.round(sec * FPS)));
    playerRef.current?.seekTo?.(f);
  };

  return (
    <div className="flex flex-col gap-2" style={{ width }}>
      <div className="relative overflow-hidden rounded-xl border border-app-divider/60 bg-black shadow-lg shadow-black/40 ring-1 ring-white/5 transition-opacity duration-150">
        {/* Native controls: scrub, volume, fullscreen — user expectation. Memoized
         *  inputProps + optimistic UI elsewhere keep buffering flashes rare. */}
        <Player
          ref={playerRef as React.Ref<unknown> as React.Ref<never>}
          component={RendererLoose}
          inputProps={spec as unknown as Record<string, unknown>}
          durationInFrames={durationInFrames}
          compositionWidth={COMP_W}
          compositionHeight={COMP_H}
          fps={FPS}
          style={{ width: "100%", aspectRatio: "9 / 16", display: "block" }}
          controls
          loop
          autoPlay
          clickToPlay
          initialFrame={initialFrame}
          acknowledgeRemotionLicense
        />
        {safeZone ? (
          <svg
            className="pointer-events-none absolute inset-0 h-full w-full opacity-40"
            viewBox={`0 0 ${COMP_W} ${COMP_H}`}
            preserveAspectRatio="none"
            aria-hidden
          >
            <rect x="40" y="1680" width="200" height="80" rx="40" fill="none" stroke="white" strokeWidth="3" />
            <rect x="880" y="520" width="120" height="900" rx="20" fill="none" stroke="white" strokeWidth="3" />
            <rect x="120" y="1780" width="840" height="8" rx="4" fill="white" opacity="0.5" />
          </svg>
        ) : null}
        {layoutGuides ? (() => {
          const layout = spec.layout ?? DEFAULT_LAYOUT;
          const padX = layout.sidePadding * COMP_W;
          const anchorY = COMP_H / 2 + layout.verticalOffset * COMP_H;
          return (
            <svg
              className="pointer-events-none absolute inset-0 h-full w-full"
              viewBox={`0 0 ${COMP_W} ${COMP_H}`}
              preserveAspectRatio="none"
              aria-hidden
            >
              <line x1={padX} y1={0} x2={padX} y2={COMP_H} stroke="#22d3ee" strokeWidth="3" strokeDasharray="14 10" opacity="0.7" />
              <line x1={COMP_W - padX} y1={0} x2={COMP_W - padX} y2={COMP_H} stroke="#22d3ee" strokeWidth="3" strokeDasharray="14 10" opacity="0.7" />
              <line x1={0} y1={anchorY} x2={COMP_W} y2={anchorY} stroke="#22d3ee" strokeWidth="3" strokeDasharray="14 10" opacity="0.7" />
            </svg>
          );
        })() : null}
      </div>
      {segments.length > 0 ? (
        <div className="space-y-1">
          <div
            ref={stripRef}
            className="relative h-9 w-full overflow-hidden rounded-md border border-app-divider/60 bg-app-chip-bg/30"
            title={`${spec.totalSec.toFixed(1)}s total · click a segment · drag the vertical lines between segments to trim duration`}
          >
            {segments.map((s) => {
              const isSelected = selectedSegmentId === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={(e) => {
                    if (dragJustEndedRef.current) {
                      e.preventDefault();
                      return;
                    }
                    onSelectSegment?.(s.id);
                    seekToSec(s.startSec + ENTRANCE_DURATION_SEC);
                  }}
                  style={{ left: `${s.leftPct}%`, width: `calc(${s.widthPct}% - 2px)` }}
                  className={`absolute top-0 bottom-0 overflow-hidden whitespace-nowrap rounded-sm leading-none transition ${
                    isSelected ? "z-10 ring-2 ring-amber-300 ring-offset-1 ring-offset-app-chip-bg/40" : "z-0"
                  } ${
                    s.isCTA
                      ? "bg-amber-500/40 text-amber-100 hover:bg-amber-500/55"
                      : s.kind === "hook"
                        ? "bg-violet-500/35 text-violet-100 hover:bg-violet-500/50"
                        : "bg-sky-500/25 text-sky-100 hover:bg-sky-500/40"
                  }`}
                  title={`${s.label} · ${s.durSec.toFixed(1)}s`}
                >
                  <div className="pointer-events-none flex h-full w-full flex-col items-center justify-center px-0.5">
                    <span className="text-[8.5px] font-bold uppercase tracking-wide">{s.label}</span>
                    <span className="text-[9px] font-semibold tabular-nums opacity-85">{s.durSec.toFixed(1)}s</span>
                  </div>
                </button>
              );
            })}
            {/* Pause markers — visible quiet windows between segments. Without
             *  this it's near-impossible to tell whether a small pause "took". */}
            {gaps.map((g) => (
              <div
                key={g.id}
                aria-hidden
                title={`Pause · ${g.sec.toFixed(2)}s`}
                style={{ left: `${g.leftPct}%`, width: `${g.widthPct}%` }}
                className="pointer-events-none absolute top-0 bottom-0 z-[5] flex items-center justify-center rounded-sm border border-dashed border-amber-400/60 bg-amber-400/10"
              >
                <span className="rounded-sm bg-amber-400/80 px-1 py-px text-[8px] font-bold uppercase tracking-wide text-app-bg shadow-sm">
                  {g.sec.toFixed(2)}s
                </span>
              </div>
            ))}
            {/* One handle per cut between adjacent segments — same edit as resizing
             *  the left clip's out-point; visually one line, not N orange edge slivers. */}
            {segments.length >= 2 &&
            onResizeSegmentDraft &&
            onResizeSegmentCommit &&
            segments.map((s, i) => {
              if (i >= segments.length - 1) return null;
              const boundaryPct = s.leftPct + s.widthPct;
              return (
                <button
                  key={`b-${s.id}-${segments[i + 1]!.id}`}
                  type="button"
                  aria-label={`Resize between ${s.label} and ${segments[i + 1]!.label}`}
                  title="Drag horizontally to shorten or lengthen the left segment (same as trimming its out-point)"
                  onPointerDown={(e) => onBoundaryResizeStart(e, i)}
                  className="group absolute top-0 bottom-0 z-20 flex cursor-ew-resize items-center justify-center border-0 bg-transparent p-0 outline-none hover:bg-white/10 active:bg-white/20"
                  style={{
                    left: `calc(${boundaryPct}% - ${BOUNDARY_HIT_PX / 2}px)`,
                    width: BOUNDARY_HIT_PX,
                  }}
                >
                  <span className="pointer-events-none h-4 w-px rounded-full bg-white/30 shadow-[0_0_2px_rgba(0,0,0,0.6)] transition-colors group-hover:bg-white/75 group-active:bg-white/90" />
                </button>
              );
            })}
            <span
              aria-hidden
              className="pointer-events-none absolute top-0 bottom-0 z-30 w-0.5 bg-white/90 shadow-[0_0_4px_rgba(255,255,255,0.6)]"
              style={{ left: `${playheadPct}%`, transform: "translateX(-1px)" }}
            />
          </div>
          <div className="flex justify-end">
            <span
              className="rounded-sm bg-app-chip-bg/50 px-1.5 py-px text-[9px] font-bold tabular-nums text-app-fg-muted"
              title={`${segments.length} segment${segments.length === 1 ? "" : "s"} · drag vertical lines on the bar to trim`}
            >
              {spec.totalSec.toFixed(1)}s
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function specsEqual(prev: VideoSpec | null, next: VideoSpec | null): boolean {
  if (prev === next) return true;
  if (!prev || !next) return false;
  return JSON.stringify(prev) === JSON.stringify(next);
}

export const VideoSpecPreview = memo(VideoSpecPreviewBase, (prev, next) => {
  return (
    prev.width === next.width &&
    prev.safeZone === next.safeZone &&
    prev.layoutGuides === next.layoutGuides &&
    prev.selectedSegmentId === next.selectedSegmentId &&
    prev.onSelectSegment === next.onSelectSegment &&
    prev.onResizeSegmentDraft === next.onResizeSegmentDraft &&
    prev.onResizeSegmentCommit === next.onResizeSegmentCommit &&
    specsEqual(prev.spec, next.spec)
  );
});
VideoSpecPreview.displayName = "VideoSpecPreview";
