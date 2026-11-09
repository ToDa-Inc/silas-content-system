import type { VideoSpec } from "./video-spec";

/** Stable JSON key of fields that affect Remotion render output only. */
export function playerSpecRenderKey(spec: VideoSpec): string {
  return JSON.stringify({
    v: spec.v,
    templateId: spec.templateId,
    themeId: spec.themeId,
    textTreatment: spec.textTreatment,
    appearance: spec.appearance,
    brand: spec.brand,
    background: spec.background,
    hook: spec.hook,
    blocks: spec.blocks,
    layout: spec.layout,
    framing: spec.framing,
    gapBetweenBlocksSec: spec.gapBetweenBlocksSec,
    pausesSec: spec.pausesSec,
    totalSec: spec.totalSec,
  });
}

/** Reuse the last spec object when render content is unchanged (stable Player inputProps). */
export function stablePlayerSpec(
  spec: VideoSpec,
  cache: { key: string; spec: VideoSpec } | null,
): { spec: VideoSpec; cache: { key: string; spec: VideoSpec } } {
  const key = playerSpecRenderKey(spec);
  if (cache?.key === key) return { spec: cache.spec, cache };
  const next = { key, spec };
  return { spec, cache: next };
}
