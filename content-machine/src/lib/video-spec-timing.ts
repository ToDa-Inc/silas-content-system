/**
 * Pure-function timing math for VideoSpec block/hook duration edits.
 *
 * Mirrors the backend's authoritative timing model in
 * `silas-content-system/backend/services/video_spec_timing.py` and the validator
 * in `models/video_spec.py` (totalSec auto-grows to fit max endSec). Same
 * function shape powers BOTH the live preview transform (`spec → spec`) AND
 * the persisted JSON Patch (`spec → ops[]`) so they can never disagree.
 *
 * Cascade modes
 * -------------
 * - "push":     Subsequent blocks shift right by Δ. Total length grows.
 *               This is what every video editor (CapCut, Premiere) does on
 *               an edge-drag and is the least surprising default.
 * - "compress": Next block absorbs Δ (its startSec shifts, endSec stays).
 *               Total length is preserved. Δ is clamped so the next block
 *               never shrinks below MIN_BLOCK_SEC. If there's no next
 *               block (selected is the last one), falls back to "push".
 *
 * Hook edits cascade with the same rules — the hook is conceptually
 * block #-1 sitting at startSec=0.
 */

import type { VideoSpec } from "@/lib/video-spec";

export type CascadeMode = "push" | "compress";

export type TimingOp = {
  op: "replace";
  /** JSON Pointer per RFC 6901; backend services/video_spec_patch.py validates. */
  path: string;
  value: number;
};

export type TimingChangeResult = {
  /** Spec with the edit applied. Use for live preview. */
  spec: VideoSpec;
  /** Atomic JSON Patch ops to send to the server. Empty array = no-op. */
  ops: TimingOp[];
  /** Effective duration after clamping. Surface to the slider so it doesn't
   *  drift past what the cascade actually allowed. */
  appliedDurationSec: number;
};

/** Reading-time for a text block. Mirrors backend `block_read_duration_sec()`.
 *  German is the primary use-case (~0.42s/word), English uses 0.32s/word.
 *  The +0.8s slack is a perception buffer (entrance animation + comfort).
 *  Clamped to [MIN_AUTO_SEC, MAX_AUTO_SEC]. */
export function autoBlockDurationSec(text: string, language: string = "de"): number {
  const t = (text ?? "").trim();
  if (!t) return MIN_BLOCK_SEC;
  const lang = language.trim().toLowerCase().slice(0, 2);
  const mult = lang === "de" ? 0.42 : 0.32;
  const words = t.split(/\s+/).filter(Boolean).length;
  const raw = words * mult + 0.8;
  return clamp(raw, MIN_AUTO_SEC, MAX_AUTO_SEC);
}

/** Backend `default_hook_duration_sec()`. Hooks need a beat to register;
 *  3s is the sweet spot for short-form vertical (TikTok / Reels norm). */
export function autoHookDurationSec(): number {
  return 3.0;
}

/** Hard floors on what's actually readable / looks intentional. Shorter than
 *  ~1s reads as a glitch; longer than ~8s is dead air in a Reel. */
export const MIN_BLOCK_SEC = 1.0;
export const MAX_BLOCK_SEC = 8.0;
const MIN_AUTO_SEC = 1.4;
const MAX_AUTO_SEC = 4.5;
/** Min visible hook. Backend enforces hook.durationSec >= 0.5 implicitly via totalSec validator. */
const MIN_HOOK_SEC = 1.0;
const MAX_HOOK_SEC = 6.0;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Round to 0.01s — matches the slider step granularity and avoids surfacing
 *  spurious 7.499999998 values from float math anywhere in the spec. */
function roundCs(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Get the current visible duration of a segment, given the saved spec. */
export function segmentDurationSec(spec: VideoSpec, segmentId: string): number {
  if (segmentId === "hook") return spec.hook.durationSec;
  const b = spec.blocks.find((x) => x.id === segmentId);
  return b ? b.endSec - b.startSec : 0;
}

/** Min/max range for a segment's duration slider. Hook range differs from
 *  block range — hooks need a beat but capping at 6s prevents drag-out. */
export function segmentDurationRange(segmentId: string): { min: number; max: number } {
  if (segmentId === "hook") return { min: MIN_HOOK_SEC, max: MAX_HOOK_SEC };
  return { min: MIN_BLOCK_SEC, max: MAX_BLOCK_SEC };
}

/** Renormalize totalSec from blocks + hook. Backend's `_sorted_and_total`
 *  validator only ever GROWS totalSec; we set it explicitly so shrinking
 *  edits (e.g. compressing a block to less than current) actually shrink
 *  the video instead of leaving trailing dead air. */
function recomputeTotalSec(blocks: VideoSpec["blocks"], hookDurationSec: number): number {
  const maxEnd = blocks.reduce((m, b) => Math.max(m, b.endSec), 0);
  return roundCs(Math.max(maxEnd, hookDurationSec + 0.5, 2.0));
}

/**
 * Compute the cascade for a block-duration edit.
 *
 * Returns a NEW spec with the change applied AND the matching JSON Patch ops.
 * Both paths share the same math so the optimistic preview always matches what
 * the server will end up persisting.
 */
export function computeTimingChange(
  spec: VideoSpec,
  segmentId: string,
  newDurationSec: number,
  mode: CascadeMode,
): TimingChangeResult {
  if (segmentId === "hook") {
    return changeHookDuration(spec, newDurationSec, mode);
  }
  return changeBlockDuration(spec, segmentId, newDurationSec, mode);
}

function changeBlockDuration(
  spec: VideoSpec,
  blockId: string,
  rawNewDuration: number,
  mode: CascadeMode,
): TimingChangeResult {
  const idx = spec.blocks.findIndex((b) => b.id === blockId);
  if (idx < 0) {
    return { spec, ops: [], appliedDurationSec: 0 };
  }
  const oldBlock = spec.blocks[idx];
  const oldDuration = oldBlock.endSec - oldBlock.startSec;
  const requested = clamp(rawNewDuration, MIN_BLOCK_SEC, MAX_BLOCK_SEC);

  // In "compress" mode Δ is bounded by how much the next block can shrink.
  // We compute the cap before applying so the slider can settle on the truthful value.
  let effectiveDur = requested;
  let effectiveMode: CascadeMode = mode;
  const next = spec.blocks[idx + 1];
  if (mode === "compress") {
    if (!next) {
      // Last block → nothing to compress into. Fall back to push so growing
      // still works; shrinking is fine either way (no cascade needed).
      effectiveMode = "push";
    } else {
      const nextDuration = next.endSec - next.startSec;
      const maxGrowth = nextDuration - MIN_BLOCK_SEC;
      const delta = requested - oldDuration;
      // Growing in compress mode: cap Δ so next block can't shrink past floor.
      // Shrinking always allowed (Δ < 0 just gives the next block more room).
      if (delta > maxGrowth) {
        effectiveDur = oldDuration + Math.max(0, maxGrowth);
      }
    }
  }

  const delta = roundCs(effectiveDur - oldDuration);
  if (delta === 0) {
    return { spec, ops: [], appliedDurationSec: oldDuration };
  }

  const newEnd = roundCs(oldBlock.endSec + delta);
  const ops: TimingOp[] = [
    { op: "replace", path: `/blocks/${idx}/endSec`, value: newEnd },
  ];
  const newBlocks = spec.blocks.map((b, i) => {
    if (i === idx) return { ...b, endSec: newEnd };
    if (i <= idx) return b;
    if (effectiveMode === "push") {
      const ns = roundCs(b.startSec + delta);
      const ne = roundCs(b.endSec + delta);
      ops.push({ op: "replace", path: `/blocks/${i}/startSec`, value: ns });
      ops.push({ op: "replace", path: `/blocks/${i}/endSec`, value: ne });
      return { ...b, startSec: ns, endSec: ne };
    }
    // compress: only the IMMEDIATE next block absorbs Δ; the rest stay put.
    if (i === idx + 1) {
      const ns = roundCs(b.startSec + delta);
      ops.push({ op: "replace", path: `/blocks/${i}/startSec`, value: ns });
      return { ...b, startSec: ns };
    }
    return b;
  });

  const newTotal = recomputeTotalSec(newBlocks, spec.hook.durationSec);
  if (Math.abs(newTotal - spec.totalSec) > 0.001) {
    ops.push({ op: "replace", path: "/totalSec", value: newTotal });
  }

  return {
    spec: { ...spec, blocks: newBlocks, totalSec: newTotal },
    ops,
    appliedDurationSec: effectiveDur,
  };
}

function changeHookDuration(
  spec: VideoSpec,
  rawNewDuration: number,
  mode: CascadeMode,
): TimingChangeResult {
  const oldHook = spec.hook.durationSec;
  const requested = clamp(rawNewDuration, MIN_HOOK_SEC, MAX_HOOK_SEC);

  // Hook edit only matters in "push" mode for the cascade. In "compress" mode
  // we need to absorb Δ into the FIRST block, but if there are no blocks we
  // just edit the hook in isolation.
  let effectiveDur = requested;
  let effectiveMode: CascadeMode = mode;
  const first = spec.blocks[0];
  if (mode === "compress") {
    if (!first) {
      effectiveMode = "push";
    } else {
      const firstDuration = first.endSec - first.startSec;
      const maxGrowth = firstDuration - MIN_BLOCK_SEC;
      const delta = requested - oldHook;
      if (delta > maxGrowth) {
        effectiveDur = oldHook + Math.max(0, maxGrowth);
      }
    }
  }

  const delta = roundCs(effectiveDur - oldHook);
  if (delta === 0) {
    return { spec, ops: [], appliedDurationSec: oldHook };
  }

  const newHook = roundCs(oldHook + delta);
  const ops: TimingOp[] = [
    { op: "replace", path: "/hook/durationSec", value: newHook },
  ];

  const newBlocks = spec.blocks.map((b, i) => {
    if (effectiveMode === "push") {
      const ns = roundCs(b.startSec + delta);
      const ne = roundCs(b.endSec + delta);
      ops.push({ op: "replace", path: `/blocks/${i}/startSec`, value: ns });
      ops.push({ op: "replace", path: `/blocks/${i}/endSec`, value: ne });
      return { ...b, startSec: ns, endSec: ne };
    }
    // compress: only the FIRST block absorbs Δ.
    if (i === 0) {
      const ns = roundCs(b.startSec + delta);
      ops.push({ op: "replace", path: `/blocks/${i}/startSec`, value: ns });
      return { ...b, startSec: ns };
    }
    return b;
  });

  const newTotal = recomputeTotalSec(newBlocks, newHook);
  if (Math.abs(newTotal - spec.totalSec) > 0.001) {
    ops.push({ op: "replace", path: "/totalSec", value: newTotal });
  }

  return {
    spec: { ...spec, hook: { ...spec.hook, durationSec: newHook }, blocks: newBlocks, totalSec: newTotal },
    ops,
    appliedDurationSec: effectiveDur,
  };
}

/** Friendly label for a segment shown in the Timing inspector. */
export function segmentLabel(spec: VideoSpec, segmentId: string): string {
  if (segmentId === "hook") return "Hook";
  const idx = spec.blocks.findIndex((b) => b.id === segmentId);
  if (idx < 0) return "Hook";
  const b = spec.blocks[idx];
  if (b.isCTA) return "CTA";
  return `Block ${idx + 1}`;
}

/** Short text excerpt for the segment, used as a secondary line in the inspector. */
export function segmentExcerpt(spec: VideoSpec, segmentId: string, max: number = 56): string {
  const text = segmentId === "hook"
    ? spec.hook.text
    : spec.blocks.find((b) => b.id === segmentId)?.text ?? "";
  const t = text.trim();
  if (!t) return "(empty)";
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
