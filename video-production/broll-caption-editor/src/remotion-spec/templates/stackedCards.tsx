import React from "react";
import { AbsoluteFill } from "remotion";
import type { VideoSpecWithTimeline } from "../templateProps";
import { mergeLayerAppearance } from "../appearance";
import { blockEntranceStyle } from "../animations";
import { flexAlignForTextAlign } from "../alignLayout";
import { COMP_H, resolveLayoutPx } from "../layout";
import { cardBoldOutlineCaptionStyle, isBoldOutlineLayer } from "../textTreatment";
import { beatFontScaleMult, type ActiveCaptionLayer } from "../activeLayers";

/** Max on-screen cards so long reels do not grow an unbounded stack. */
const MAX_STACKED_CARDS = 8;

/**
 * Stacked format: lines **accumulate** (card-by-card) in chronological order — opener / hook
 * row on top while it is on-air, then each text beat appears below once its ``startSec`` is
 * reached and stays in the stack (newest near the bottom). This is intentionally **not**
 * tied to ``stackGrowth`` inversions. Pin (top / middle / bottom) sets a **fixed top origin**
 * for the first row; new cards always append **below** without re-packing the flex group upward.
 */
function stackedCumulativeRows(spec: VideoSpecWithTimeline["spec"], sec: number): ActiveCaptionLayer[] {
  const layers: ActiveCaptionLayer[] = [];
  const hookText = String(spec.hook.text ?? "").trim();
  const hookEnd = spec.hook.durationSec;
  if (hookText && sec >= 0 && sec < hookEnd) {
    layers.push({
      key: "hook",
      text: hookText,
      isCTA: false,
      startSec: 0,
      animation: "fade",
      kind: "hook",
      fontScale: spec.hook.fontScale ?? undefined,
    });
  }

  const sorted = [...spec.blocks].sort((a, b) => a.startSec - b.startSec);
  const started: ActiveCaptionLayer[] = [];
  for (const b of sorted) {
    const text = String(b.text ?? "").trim();
    if (!text || sec < b.startSec) continue;
    started.push({
      key: b.id,
      text,
      isCTA: Boolean(b.isCTA),
      startSec: b.startSec,
      animation: b.animation ?? "fade",
      kind: "block",
      appearance: b.appearance ?? undefined,
      textTreatment: b.textTreatment ?? undefined,
      fontScale: b.fontScale ?? undefined,
    });
  }

  const capped =
    started.length > MAX_STACKED_CARDS ? started.slice(-MAX_STACKED_CARDS) : started;
  return [...layers, ...capped];
}

export default function StackedCardsTemplate({ spec, frame, fps, canvasH }: VideoSpecWithTimeline) {
  const sec = frame / fps;
  const layout = resolveLayoutPx(spec, canvasH);

  const rows = stackedCumulativeRows(spec, sec);

  const baseSize = 60;
  const ta = layout.textAlign;
  const colAlign = flexAlignForTextAlign(ta);
  const pad = "160px";
  const padPx = 160;

  const anchor = layout.verticalAnchor;
  /** Fixed Y where the first stack row starts — never ``justify-content: flex-end`` on a growing column (that shifts older cards up). */
  const stackPaddingTopPx =
    anchor === "top"
      ? padPx
      : anchor === "center"
        ? Math.round((canvasH ?? COMP_H) * 0.34)
        : Math.round((canvasH ?? COMP_H) * 0.54);

  const card = (row: ActiveCaptionLayer) => {
    const layerTheme = mergeLayerAppearance(spec, row.kind === "block" ? row.appearance : null);
    const startFrame = Math.round(row.startSec * fps);
    const animStyle = blockEntranceStyle(frame, fps, startFrame, row.animation);
    const fontSize = Math.round(
      (row.isCTA ? baseSize * layerTheme.ctaScale : baseSize) * beatFontScaleMult(row) * layout.scale,
    );
    return (
      <div
        key={row.key}
        style={{
          display: "inline-block",
          backgroundColor: layerTheme.cardBg === "transparent" ? "#ffffff" : layerTheme.cardBg,
          borderRadius: "12px",
          padding: "24px 32px",
          maxWidth: layout.innerWidth,
          opacity: animStyle.opacity,
          transform: animStyle.transform,
        }}
      >
        <p
          style={{
            fontSize,
            fontWeight: 800,
            fontFamily: layerTheme.bodyFontStack,
            color: layerTheme.cardText,
            margin: 0,
            lineHeight: 1.25,
            letterSpacing: "-0.01em",
            ...(isBoldOutlineLayer(spec, row) ? cardBoldOutlineCaptionStyle() : {}),
            WebkitFontSmoothing: "antialiased",
            textRendering: "optimizeLegibility",
            wordWrap: "break-word",
            overflowWrap: "break-word",
            textAlign: ta,
          }}
        >
          {row.text}
        </p>
      </div>
    );
  };

  /** Chronological column: opener on top, each new beat below — no ``column-reverse``. */
  const stackColumn =
    rows.length === 0 ? null : (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: colAlign,
          gap: layout.stackGapPx,
          width: "100%",
        }}
      >
        {rows.map((r) => card(r))}
      </div>
    );

  const bottomGradient = stackColumn ? (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        height: "48%",
        background: "linear-gradient(to top, rgba(0,0,0,0.22) 0%, rgba(0,0,0,0) 100%)",
        pointerEvents: "none",
      }}
    />
  ) : null;

  /** Same visual weight as the 48% edge bands — avoids full-frame scrim when Pin = middle. */
  const centerBandOverlay = stackColumn ? (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: "26%",
        height: "48%",
        background: "radial-gradient(ellipse at center, rgba(0,0,0,0.05) 0%, rgba(0,0,0,0.12) 55%, rgba(0,0,0,0) 100%)",
        pointerEvents: "none",
      }}
    />
  ) : null;

  const topGradient = stackColumn ? (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: 0,
        height: "48%",
        background: "linear-gradient(to bottom, rgba(0,0,0,0.22) 0%, rgba(0,0,0,0) 100%)",
        pointerEvents: "none",
      }}
    />
  ) : null;

  let overlay: React.ReactNode = null;
  if (anchor === "center") {
    overlay = centerBandOverlay;
  } else if (anchor === "top") {
    overlay = topGradient;
  } else {
    overlay = bottomGradient;
  }

  const textWrap = (
    <div
      style={{
        position: "absolute",
        inset: 0,
        paddingTop: stackPaddingTopPx,
        paddingBottom: pad,
        paddingLeft: layout.paddingPx,
        paddingRight: layout.paddingPx,
        boxSizing: "border-box",
        pointerEvents: "none",
        transform: layout.translateY,
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-start",
      }}
    >
      {stackColumn}
    </div>
  );

  return (
    <AbsoluteFill>
      {overlay}
      {textWrap}
    </AbsoluteFill>
  );
}
