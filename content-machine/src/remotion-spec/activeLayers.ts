export type CaptionLayerInput = {
  hook: { text?: string | null; durationSec: number };
  blocks: Array<{
    id: string;
    text?: string | null;
    isCTA: boolean;
    startSec: number;
    endSec: number;
    animation?: "pop" | "fade" | "slide-up" | "none" | null;
  }>;
};

export type ActiveCaptionLayer = {
  key: string;
  text: string;
  isCTA: boolean;
  startSec: number;
  animation: "pop" | "fade" | "slide-up" | "none";
  kind: "hook" | "block";
};

export function activeCaptionLayers(spec: CaptionLayerInput, sec: number): ActiveCaptionLayer[] {
  const layers: ActiveCaptionLayer[] = [];
  const hookText = String(spec.hook.text ?? "").trim();
  if (hookText && sec >= 0 && sec < spec.hook.durationSec) {
    layers.push({
      key: "hook",
      text: hookText,
      isCTA: false,
      startSec: 0,
      animation: "fade",
      kind: "hook",
    });
  }

  [...spec.blocks]
    .sort((a, b) => a.startSec - b.startSec)
    .forEach((b) => {
      const text = String(b.text ?? "").trim();
      if (!text || sec < b.startSec || sec >= b.endSec) return;
      layers.push({
        key: b.id,
        text,
        isCTA: Boolean(b.isCTA),
        startSec: b.startSec,
        animation: b.animation ?? "fade",
        kind: "block",
      });
    });

  return layers;
}
