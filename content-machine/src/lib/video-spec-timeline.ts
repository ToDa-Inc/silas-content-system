/**
 * Timeline relayout: optional per-beat `pausesSec[i]` (pause before block i, sorted by startSec),
 * else legacy uniform `gapBetweenBlocksSec`. When ``background.durationSec`` is set, block
 * durations are proportionally fitted to the clip (hook + pauses unchanged).
 * Mirrors backend/services/video_spec_timeline.py.
 */

import type { VideoSpec } from "@/lib/video-spec";

// Mirrors backend services/video_spec_timeline.py — keep both in sync. 5s per
// pause is plenty; the real ceiling is the spec's ``totalSec`` (≤ 120s).
const GAP_MAX = 5.0;
const MIN_HOOK = 1.0;
const MIN_BLOCK = 1.0;

export function clampGap(g: number): number {
  return Math.max(0, Math.min(GAP_MAX, g));
}

/** One entry per text block (sorted by startSec): silence before that block (index 0 = after hook). */
export function effectivePausesSec(spec: VideoSpec): number[] {
  const n = spec.blocks.length;
  if (n <= 0) return [];
  const g = clampGap(spec.gapBetweenBlocksSec ?? 0);
  const raw = spec.pausesSec;
  if (raw && raw.length === n) return raw.map(clampGap);
  return Array(n).fill(g);
}

function roundCs(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Scale block durations so their sum ≤ ``available`` (each ≥ ``minBlock``). Mirrors Python ``fit_block_durs_to_available``. */
export function fitBlockDursToAvailable(
  durs: number[],
  available: number,
  minBlock: number = MIN_BLOCK,
): number[] {
  const n = durs.length;
  if (n === 0 || available <= 0) {
    return durs.map((d) => d);
  }
  const floor = minBlock * n;
  if (available <= floor) {
    return Array(n).fill(minBlock);
  }
  const total = durs.reduce((a, b) => a + b, 0);
  if (total <= available + 1e-6) {
    return durs.map((d) => roundCs(d));
  }
  const headroom = available - floor;
  const extras = durs.map((d) => Math.max(0, d - minBlock));
  const extrasSum = extras.reduce((a, b) => a + b, 0);
  if (extrasSum <= 1e-6) {
    return Array(n).fill(minBlock);
  }
  const k = headroom / extrasSum;
  return durs.map((d) => roundCs(minBlock + Math.max(0, d - minBlock) * k));
}

export type RelayoutTimelineOptions = {
  /**
   * Deprecated — kept for call-site compatibility; ignored.
   */
  applyClipCap?: boolean;
};

export function relayoutTimeline(
  spec: VideoSpec,
  _options: RelayoutTimelineOptions = {},
): VideoSpec {
  void _options;
  const blocksSorted = [...spec.blocks].sort((a, b) => a.startSec - b.startSec);
  const n = blocksSorted.length;
  let durs = blocksSorted.map((b) => roundCs(Math.max(MIN_BLOCK, b.endSec - b.startSec)));
  const h = spec.hook.durationSec;
  const pauses = effectivePausesSec({ ...spec, blocks: blocksSorted });

  let cap: number | null = null;
  if (spec.background.kind === "video" && spec.background.durationSec != null) {
    const c = Number(spec.background.durationSec);
    if (Number.isFinite(c) && c > 0) cap = c;
  }

  if (cap != null && n > 0) {
    const pauseSum = pauses.reduce((a, b) => a + b, 0);
    const availRaw = cap - h - pauseSum;
    const available = Math.max(MIN_BLOCK * n, availRaw);
    durs = fitBlockDursToAvailable(durs, available);
  }

  let cursor = h;
  const newBlocks: VideoSpec["blocks"] = [];
  for (let i = 0; i < blocksSorted.length; i += 1) {
    const ob = blocksSorted[i]!;
    cursor += pauses[i] ?? 0;
    const dur = durs[i] ?? MIN_BLOCK;
    const start = roundCs(cursor);
    const end = roundCs(start + dur);
    newBlocks.push({ ...ob, startSec: start, endSec: end });
    cursor = end;
  }

  const placed = newBlocks;
  const maxEnd = placed.length ? Math.max(...placed.map((b) => b.endSec)) : 0;
  const minTotal = Math.max(maxEnd, h + 0.5, 2);
  const totalSec =
    cap != null
      ? roundCs(Math.min(minTotal, cap))
      : roundCs(Math.max(minTotal, spec.totalSec));

  return {
    ...spec,
    hook: { ...spec.hook, durationSec: roundCs(h) },
    blocks: placed,
    pausesSec: n > 0 ? pauses.map(roundCs) : undefined,
    totalSec,
  };
}
