"use client";

import dynamic from "next/dynamic";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type PointerEvent as ReactPointerEvent } from "react";
import { DEFAULT_LAYOUT, type VideoSpec } from "@/lib/video-spec";
import { buildLayerRows, type VideoLayerRow } from "@/lib/video-spec-layer-timeline";
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

/** Hit width for each layer edge handle. */
const LAYER_HANDLE_PX = 12;
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
  onResizeLayerTimingDraft?: (id: string, timing: { startSec?: number; endSec?: number }) => void;
  onResizeLayerTimingCommit?: (id: string, timing: { startSec?: number; endSec?: number }) => void;
};

function VideoSpecPreviewBase({
  spec,
  safeZone = false,
  layoutGuides = false,
  width = 280,
  selectedSegmentId = null,
  onSelectSegment,
  onResizeLayerTimingDraft,
  onResizeLayerTimingCommit,
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
    let stopped = false;
    let raf = 0;
    const readFrame = () => {
      const f = playerRef.current?.getCurrentFrame?.();
      if (typeof f === "number" && Number.isFinite(f)) {
        setCurrentFrame(Math.max(0, Math.min(durationInFrames - 1, f)));
      }
    };
    const onFrame = (...args: unknown[]) => {
      const ev = args[0] as { frame?: number; detail?: { frame?: number } } | undefined;
      const f = typeof ev?.frame === "number" ? ev.frame : ev?.detail?.frame;
      if (typeof f === "number") setCurrentFrame(Math.max(0, Math.min(durationInFrames - 1, f)));
    };
    const playerAtMount = playerRef.current;
    const tick = () => {
      if (stopped) return;
      readFrame();
      raf = window.requestAnimationFrame(tick);
    };
    playerAtMount?.addEventListener?.("frameupdate", onFrame);
    setCurrentFrame(initialFrame);
    raf = window.requestAnimationFrame(tick);
    return () => {
      stopped = true;
      if (raf) window.cancelAnimationFrame(raf);
      playerAtMount?.removeEventListener?.("frameupdate", onFrame);
    };
  }, [durationInFrames, initialFrame]);

  const layers = useMemo(() => (spec ? buildLayerRows(spec) : []), [spec]);

  const rulerMarks = useMemo(() => {
    if (!spec) return [];
    const total = Math.max(0.001, spec.totalSec);
    const count = Math.min(7, Math.max(3, Math.floor(total) + 1));
    return Array.from({ length: count }, (_, i) => {
      const sec = count === 1 ? 0 : (total / (count - 1)) * i;
      return { sec, leftPct: (sec / total) * 100 };
    });
  }, [spec]);

  /** Layer edge drag: left handle edits startSec, right handle edits endSec. */
  const dragStateRef = useRef<{
    layer: VideoLayerRow;
    edge: "start" | "end";
    startClientX: number;
    pixelsPerSec: number;
    moved: boolean;
    lastTiming: { startSec?: number; endSec?: number };
  } | null>(null);

  const dragJustEndedRef = useRef(false);

  const onLayerEdgeResizeStart = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>, layer: VideoLayerRow, edge: "start" | "end") => {
      const stripEl = stripRef.current;
      if (!stripEl || !spec) return;
      e.preventDefault();
      e.stopPropagation();
      const stripRect = stripEl.getBoundingClientRect();
      const pxPerSec = stripRect.width / Math.max(0.001, spec.totalSec);
      dragStateRef.current = {
        layer,
        edge,
        startClientX: e.clientX,
        pixelsPerSec: pxPerSec,
        moved: false,
        lastTiming: edge === "start" ? { startSec: layer.startSec } : { endSec: layer.endSec },
      };
      const onMove = (mv: PointerEvent) => {
        const st = dragStateRef.current;
        if (!st) return;
        const deltaPx = mv.clientX - st.startClientX;
        if (!st.moved && Math.abs(deltaPx) >= DRAG_THRESHOLD_PX) st.moved = true;
        if (!st.moved) return;
        const deltaSec = deltaPx / st.pixelsPerSec;
        const next =
          st.edge === "start"
            ? { startSec: Math.round((st.layer.startSec + deltaSec) * 10) / 10 }
            : { endSec: Math.round((st.layer.endSec + deltaSec) * 10) / 10 };
        if (next.startSec !== st.lastTiming.startSec || next.endSec !== st.lastTiming.endSec) {
          st.lastTiming = next;
          onResizeLayerTimingDraft?.(st.layer.id, next);
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
          onResizeLayerTimingCommit?.(st.layer.id, st.lastTiming);
        }
      };
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
      document.addEventListener("pointercancel", onUp);
    },
    [onResizeLayerTimingDraft, onResizeLayerTimingCommit, spec],
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
      {layers.length > 0 ? (
        <div className="space-y-1.5">
          <div
            ref={stripRef}
            className="relative overflow-hidden rounded-lg border border-app-divider/60 bg-app-chip-bg/25 p-2"
            title={`${spec.totalSec.toFixed(1)}s total · click a layer · drag left/right handles to set when text appears and disappears`}
          >
            <div className="relative mb-1 h-4 border-b border-app-divider/40">
              {rulerMarks.map((m) => (
                <span
                  key={m.sec.toFixed(2)}
                  className="absolute top-0 h-full border-l border-white/15 pl-0.5 text-[8px] font-semibold tabular-nums text-app-fg-subtle"
                  style={{ left: `${m.leftPct}%` }}
                >
                  {m.sec.toFixed(m.sec >= 10 ? 0 : 1)}s
                </span>
              ))}
            </div>
            <div className="space-y-1">
              {layers.map((s) => {
                const isSelected = selectedSegmentId === s.id;
                const canDragStart = s.kind !== "hook";
                return (
                  <div key={s.id} className="relative h-8 rounded-md bg-black/15">
                    <button
                      type="button"
                      onClick={(e) => {
                        if (dragJustEndedRef.current) {
                          e.preventDefault();
                          return;
                        }
                        onSelectSegment?.(s.id);
                        seekToSec(s.startSec + ENTRANCE_DURATION_SEC);
                      }}
                      style={{ left: `${s.leftPct}%`, width: `max(24px, calc(${s.widthPct}% - 2px))` }}
                      className={`absolute top-1 bottom-1 overflow-hidden whitespace-nowrap rounded-md px-1.5 text-left leading-none transition ${
                        isSelected ? "z-10 ring-2 ring-amber-300 ring-offset-1 ring-offset-app-chip-bg/40" : "z-0"
                      } ${
                        s.isCTA
                          ? "bg-amber-500/55 text-amber-50 hover:bg-amber-500/70"
                          : s.kind === "hook"
                            ? "bg-violet-500/45 text-violet-50 hover:bg-violet-500/60"
                            : "bg-fuchsia-500/45 text-fuchsia-50 hover:bg-fuchsia-500/60"
                      }`}
                      title={`${s.label} · ${s.startSec.toFixed(1)}s → ${s.endSec.toFixed(1)}s`}
                    >
                      <div className="pointer-events-none flex h-full items-center gap-1.5">
                        <span className="shrink-0 text-[8.5px] font-black uppercase tracking-wide">{s.label}</span>
                        <span className="min-w-0 truncate text-[9px] font-semibold opacity-90">{s.text}</span>
                        <span className="ml-auto shrink-0 text-[8.5px] font-bold tabular-nums opacity-80">
                          {s.durationSec.toFixed(1)}s
                        </span>
                      </div>
                    </button>
                    {canDragStart && onResizeLayerTimingDraft && onResizeLayerTimingCommit ? (
                      <button
                        type="button"
                        aria-label={`Set start for ${s.label}`}
                        title="Drag to change when this text appears"
                        onPointerDown={(e) => onLayerEdgeResizeStart(e, s, "start")}
                        className="group absolute top-1 bottom-1 z-20 cursor-ew-resize rounded-l-md bg-transparent p-0 outline-none hover:bg-white/10 active:bg-white/20"
                        style={{ left: `calc(${s.leftPct}% - ${LAYER_HANDLE_PX / 2}px)`, width: LAYER_HANDLE_PX }}
                      >
                        <span className="mx-auto block h-full w-0.5 rounded-full bg-white/40 group-hover:bg-white/90" />
                      </button>
                    ) : null}
                    {onResizeLayerTimingDraft && onResizeLayerTimingCommit ? (
                      <button
                        type="button"
                        aria-label={`Set end for ${s.label}`}
                        title="Drag to change when this text disappears"
                        onPointerDown={(e) => onLayerEdgeResizeStart(e, s, "end")}
                        className="group absolute top-1 bottom-1 z-20 cursor-ew-resize rounded-r-md bg-transparent p-0 outline-none hover:bg-white/10 active:bg-white/20"
                        style={{
                          left: `calc(${s.leftPct + s.widthPct}% - ${LAYER_HANDLE_PX / 2}px)`,
                          width: LAYER_HANDLE_PX,
                        }}
                      >
                        <span className="mx-auto block h-full w-0.5 rounded-full bg-white/40 group-hover:bg-white/90" />
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
            <span
              aria-hidden
              className="pointer-events-none absolute top-2 bottom-2 z-30 w-0.5 bg-white/90 shadow-[0_0_4px_rgba(255,255,255,0.6)]"
              style={{ left: `${playheadPct}%`, transform: "translateX(-1px)" }}
            />
          </div>
          <div className="flex justify-end">
            <span
              className="rounded-sm bg-app-chip-bg/50 px-1.5 py-px text-[9px] font-bold tabular-nums text-app-fg-muted"
              title={`${layers.length} layer${layers.length === 1 ? "" : "s"} · drag each bar edge to trim timing`}
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
    prev.onResizeLayerTimingDraft === next.onResizeLayerTimingDraft &&
    prev.onResizeLayerTimingCommit === next.onResizeLayerTimingCommit &&
    specsEqual(prev.spec, next.spec)
  );
});
VideoSpecPreview.displayName = "VideoSpecPreview";
