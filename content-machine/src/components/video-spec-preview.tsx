"use client";

import dynamic from "next/dynamic";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { ClipTrimStrip, LayerTimingStrip } from "@/components/editors/shared/TimingStrips";
import { createRafCoalescer } from "@/lib/raf-coalesce";
import { playerSpecRenderKey } from "@/lib/player-spec";
import { DEFAULT_LAYOUT, type VideoSpec } from "@/lib/video-spec";
import { buildLayerRows } from "@/lib/video-spec-layer-timeline";
import Renderer from "@/remotion-spec/Renderer";
import { compositionDurationInFrames } from "@/remotion-spec/schema";

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

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/** Player ref — frame subscription, seek, and keyboard Space → play/pause. */
type PlayerHandle = {
  getCurrentFrame?: () => number;
  seekTo?: (frame: number) => void;
  toggle?: () => void;
  addEventListener?: (name: string, cb: (...args: unknown[]) => void) => void;
  removeEventListener?: (name: string, cb: (...args: unknown[]) => void) => void;
};

/** Space would insert text, activate a control, or otherwise must not toggle the preview. */
function isSpaceReservedByUi(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  
  const tagName = target.tagName.toLowerCase();
  if (tagName === "textarea" || target.getAttribute("contenteditable") === "true") {
    return true;
  }
  if (tagName === "input") {
    const type = target.getAttribute("type") || "text";
    const nonTextInputTypes = ["button", "submit", "checkbox", "radio", "image", "reset", "range"];
    return !nonTextInputTypes.includes(type);
  }
  if (target.closest('[role="textbox"]')) {
    return true;
  }
  
  return false;
}

export type VideoClipTrimProps = {
  sourceDurationSec: number;
  trimStartSec: number;
  trimEndSec: number;
  onChange: (start: number, end: number) => void;
  onCommit: (start: number, end: number) => void;
};

type Props = {
  /** Full spec for timeline strips (may change often during drags). */
  spec: VideoSpec | null;
  /** Stable spec for Remotion Player — same object identity when render key unchanged. */
  playerSpec?: VideoSpec | null;
  safeZone?: boolean;
  layoutGuides?: boolean;
  width?: number;
  selectedSegmentId?: string | null;
  onSelectSegment?: (id: string) => void;
  onResizeLayerTimingDraft?: (id: string, timing: { startSec?: number; endSec?: number }) => void;
  onResizeLayerTimingCommit?: (id: string, timing: { startSec?: number; endSec?: number }) => void;
  clipTrim?: VideoClipTrimProps | null;
  timingDisabled?: boolean;
};

function VideoSpecPreviewBase({
  spec,
  playerSpec: playerSpecProp = null,
  safeZone = false,
  layoutGuides = false,
  width = 280,
  selectedSegmentId = null,
  onSelectSegment,
  onResizeLayerTimingDraft,
  onResizeLayerTimingCommit,
  clipTrim = null,
  timingDisabled = false,
}: Props) {
  const playerRef = useRef<PlayerHandle | null>(null);
  const renderSpec = playerSpecProp ?? spec;

  const timelineSec = useMemo(
    () => Math.max(0.001, spec?.totalSec ?? 8),
    [spec?.totalSec],
  );

  const durationInFrames = useMemo(() => {
    const total = Math.max(0.001, renderSpec?.totalSec ?? timelineSec);
    return compositionDurationInFrames({
      totalSec: total,
      background: renderSpec?.background,
    });
  }, [renderSpec?.totalSec, renderSpec?.background, timelineSec]);

  const initialFrame = useMemo(
    () => Math.min(durationInFrames - 1, Math.round(ENTRANCE_DURATION_SEC * FPS)),
    [durationInFrames],
  );

  const [currentFrame, setCurrentFrame] = useState(initialFrame);
  const scrubbingRef = useRef(false);

  useEffect(() => {
    let stopped = false;
    let raf = 0;
    const readFrame = () => {
      if (scrubbingRef.current) return;
      const f = playerRef.current?.getCurrentFrame?.();
      if (typeof f === "number" && Number.isFinite(f)) {
        setCurrentFrame(Math.max(0, Math.min(durationInFrames - 1, f)));
      }
    };
    const onFrame = (...args: unknown[]) => {
      if (scrubbingRef.current) return;
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

  useEffect(() => {
    if (!renderSpec) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      if (e.repeat) return;
      if (isSpaceReservedByUi(e.target)) return;
      e.preventDefault();
      playerRef.current?.toggle?.();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [renderSpec]);

  const layers = useMemo(() => (spec ? buildLayerRows(spec) : []), [spec]);

  const playheadPct = useMemo(() => {
    const total = Math.max(0.001, timelineSec);
    const sec = currentFrame / FPS;
    return clamp01(sec / total) * 100;
  }, [currentFrame, timelineSec]);

  const seekToSec = useCallback(
    (sec: number) => {
      const f = Math.max(0, Math.min(durationInFrames - 1, Math.round(sec * FPS)));
      setCurrentFrame(f);
      playerRef.current?.seekTo?.(f);
    },
    [durationInFrames],
  );

  const seekToSecRaf = useMemo(() => createRafCoalescer(seekToSec), [seekToSec]);

  const onScrubPlayhead = useCallback(
    (sec: number) => {
      scrubbingRef.current = true;
      seekToSecRaf(sec);
    },
    [seekToSecRaf],
  );

  useEffect(() => {
    const endScrub = () => {
      scrubbingRef.current = false;
    };
    window.addEventListener("pointerup", endScrub);
    window.addEventListener("pointercancel", endScrub);
    return () => {
      window.removeEventListener("pointerup", endScrub);
      window.removeEventListener("pointercancel", endScrub);
    };
  }, []);

  const showTimeline = layers.length > 0 || clipTrim != null;

  if (!spec || !renderSpec) {
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

  return (
    <div className="flex flex-col gap-2" style={{ width }}>
      <div className="relative overflow-hidden rounded-xl border border-app-divider/60 bg-black shadow-lg shadow-black/40 ring-1 ring-white/5 transition-opacity duration-150">
        <Player
          ref={playerRef as React.Ref<unknown> as React.Ref<never>}
          component={RendererLoose}
          inputProps={renderSpec as unknown as Record<string, unknown>}
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
          const layout = renderSpec.layout ?? DEFAULT_LAYOUT;
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

      {showTimeline ? (
        <div className="space-y-2">
          {clipTrim ? (
            <ClipTrimStrip
              sourceDurationSec={clipTrim.sourceDurationSec}
              trimStartSec={clipTrim.trimStartSec}
              trimEndSec={clipTrim.trimEndSec}
              timelineSec={timelineSec}
              disabled={timingDisabled}
              onChange={clipTrim.onChange}
              onCommit={clipTrim.onCommit}
              compact
            />
          ) : null}
          {layers.length > 0 ? (
            <LayerTimingStrip
              layers={layers}
              timelineSec={timelineSec}
              selectedSegmentId={selectedSegmentId}
              disabled={timingDisabled}
              compact
              playheadPct={playheadPct}
              onScrubPlayhead={onScrubPlayhead}
              onSelectSegment={(id) => {
                onSelectSegment?.(id);
                const layer = layers.find((l) => l.id === id);
                if (layer) seekToSec(layer.startSec + ENTRANCE_DURATION_SEC);
              }}
              onResizeLayerTimingDraft={onResizeLayerTimingDraft}
              onResizeLayerTimingCommit={onResizeLayerTimingCommit}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function specsEqual(prev: VideoSpec | null, next: VideoSpec | null): boolean {
  if (prev === next) return true;
  if (!prev || !next) return false;
  return playerSpecRenderKey(prev) === playerSpecRenderKey(next);
}

function clipTrimEqual(a: VideoClipTrimProps | null | undefined, b: VideoClipTrimProps | null | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return a === b;
  return (
    a.sourceDurationSec === b.sourceDurationSec &&
    a.trimStartSec === b.trimStartSec &&
    a.trimEndSec === b.trimEndSec &&
    a.onChange === b.onChange &&
    a.onCommit === b.onCommit
  );
}

export const VideoSpecPreview = memo(VideoSpecPreviewBase, (prev, next) => {
  const prevPlayer = prev.playerSpec ?? prev.spec;
  const nextPlayer = next.playerSpec ?? next.spec;
  return (
    prev.width === next.width &&
    prev.safeZone === next.safeZone &&
    prev.layoutGuides === next.layoutGuides &&
    prev.selectedSegmentId === next.selectedSegmentId &&
    prev.timingDisabled === next.timingDisabled &&
    prev.onSelectSegment === next.onSelectSegment &&
    prev.onResizeLayerTimingDraft === next.onResizeLayerTimingDraft &&
    prev.onResizeLayerTimingCommit === next.onResizeLayerTimingCommit &&
    clipTrimEqual(prev.clipTrim, next.clipTrim) &&
    specsEqual(prev.spec, next.spec) &&
    specsEqual(prevPlayer, nextPlayer)
  );
});
VideoSpecPreview.displayName = "VideoSpecPreview";
