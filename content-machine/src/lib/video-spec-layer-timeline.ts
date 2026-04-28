import type { Operation } from "fast-json-patch";
import type { VideoSpec } from "./video-spec";

const MIN_LAYER_SEC = 0.05;
const DEFAULT_LAYER_GAP_SEC = 0.1;

export type VideoLayerRow = {
  id: string;
  kind: "hook" | "block";
  label: string;
  text: string;
  startSec: number;
  endSec: number;
  durationSec: number;
  leftPct: number;
  widthPct: number;
  isCTA: boolean;
  blockIndex: number | null;
};

export type LayerPatchResult = {
  spec: VideoSpec;
  ops: Operation[];
};

function roundCs(n: number): number {
  return Math.round(n * 100) / 100;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function timelineCapSec(spec: VideoSpec): number {
  const videoDuration =
    spec.background.kind === "video" && spec.background.durationSec != null
      ? Number(spec.background.durationSec)
      : null;
  if (videoDuration && Number.isFinite(videoDuration) && videoDuration > 0) {
    return videoDuration;
  }
  return Math.max(MIN_LAYER_SEC, Number(spec.totalSec) || MIN_LAYER_SEC);
}

function blockDurationSec(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  if (words <= 0) return 1.6;
  return clamp(words * 0.42 + 0.8, 1.4, 4.5);
}

function recomputeTotalSec(spec: VideoSpec, blocks: VideoSpec["blocks"], hookDurationSec = spec.hook.durationSec): number {
  const maxEnd = blocks.reduce((m, b) => Math.max(m, b.endSec), 0);
  const videoCap =
    spec.background.kind === "video" && spec.background.durationSec != null
      ? Number(spec.background.durationSec)
      : null;
  const desired = roundCs(Math.max(maxEnd, hookDurationSec + 0.5, 2));
  return videoCap && Number.isFinite(videoCap) && videoCap > 0 ? Math.min(desired, videoCap) : desired;
}

function pausesForLength(spec: VideoSpec, nextLength: number): number[] | undefined {
  if (nextLength <= 0) return undefined;
  const current = Array.isArray(spec.pausesSec) ? spec.pausesSec : [];
  return Array.from({ length: nextLength }, (_, i) => roundCs(Math.max(0, Math.min(5, current[i] ?? 0))));
}

function pausesFromTimeline(spec: VideoSpec, blocks: VideoSpec["blocks"], hookDurationSec = spec.hook.durationSec): number[] | undefined {
  if (blocks.length <= 0) return undefined;
  const sorted = [...blocks].sort((a, b) => a.startSec - b.startSec);
  return sorted.map((b, i) => {
    const previousEnd = i === 0 ? hookDurationSec : sorted[i - 1]!.endSec;
    return roundCs(Math.max(0, Math.min(5, b.startSec - previousEnd)));
  });
}

function pushReplace<T>(ops: Operation[], path: string, oldValue: T, value: T): void {
  if (Object.is(oldValue, value)) return;
  ops.push({ op: "replace", path, value });
}

export function buildLayerRows(spec: VideoSpec): VideoLayerRow[] {
  const total = Math.max(0.001, spec.totalSec);
  const rows: VideoLayerRow[] = [
    {
      id: "hook",
      kind: "hook",
      label: "Hook",
      text: spec.hook.text,
      startSec: 0,
      endSec: roundCs(spec.hook.durationSec),
      durationSec: roundCs(spec.hook.durationSec),
      leftPct: 0,
      widthPct: roundCs((spec.hook.durationSec / total) * 100),
      isCTA: false,
      blockIndex: null,
    },
  ];

  spec.blocks.forEach((b, i) => {
    const startSec = roundCs(Math.max(0, b.startSec));
    const endSec = roundCs(Math.max(startSec, b.endSec));
    rows.push({
      id: b.id,
      kind: "block",
      label: b.isCTA ? "CTA" : `Text ${i + 1}`,
      text: b.text,
      startSec,
      endSec,
      durationSec: roundCs(endSec - startSec),
      leftPct: roundCs((startSec / total) * 100),
      widthPct: roundCs(((endSec - startSec) / total) * 100),
      isCTA: Boolean(b.isCTA),
      blockIndex: i,
    });
  });

  return rows;
}

export function computeLayerTimingChange(
  spec: VideoSpec,
  layerId: string,
  timing: { startSec?: number; endSec?: number },
): LayerPatchResult {
  if (layerId === "hook") {
    const capSec = timelineCapSec(spec);
    const rawEnd = timing.endSec ?? spec.hook.durationSec;
    const durationSec = roundCs(clamp(rawEnd, MIN_LAYER_SEC, capSec));
    const blocks = spec.blocks.map((b) => ({ ...b }));
    const pausesSec = pausesFromTimeline(spec, blocks, durationSec);
    const totalSec = recomputeTotalSec(spec, blocks, durationSec);
    const ops: Operation[] = [];
    pushReplace(ops, "/hook/durationSec", spec.hook.durationSec, durationSec);
    if (pausesSec) ops.push({ op: "replace", path: "/pausesSec", value: pausesSec });
    pushReplace(ops, "/totalSec", spec.totalSec, totalSec);
    return { spec: { ...spec, hook: { ...spec.hook, durationSec }, blocks, pausesSec, totalSec }, ops };
  }

  const idx = spec.blocks.findIndex((b) => b.id === layerId);
  if (idx < 0) return { spec, ops: [] };
  const old = spec.blocks[idx]!;
  const capSec = timelineCapSec(spec);
  const requestedStart = timing.startSec ?? old.startSec;
  const requestedEnd = timing.endSec ?? old.endSec;
  let startSec = roundCs(clamp(requestedStart, 0, capSec));
  let endSec = roundCs(clamp(requestedEnd, 0, capSec));
  if (endSec - startSec < MIN_LAYER_SEC) {
    if (timing.startSec != null && timing.endSec == null) {
      startSec = roundCs(Math.max(0, endSec - MIN_LAYER_SEC));
    } else {
      endSec = roundCs(Math.min(capSec, startSec + MIN_LAYER_SEC));
      if (endSec - startSec < MIN_LAYER_SEC) {
        startSec = roundCs(Math.max(0, endSec - MIN_LAYER_SEC));
      }
    }
  }

  const blocks = spec.blocks.map((b, i) => (i === idx ? { ...b, startSec, endSec } : { ...b }));
  const pausesSec = pausesFromTimeline(spec, blocks);
  const totalSec = recomputeTotalSec(spec, blocks);
  const ops: Operation[] = [];
  pushReplace(ops, `/blocks/${idx}/startSec`, old.startSec, startSec);
  pushReplace(ops, `/blocks/${idx}/endSec`, old.endSec, endSec);
  ops.push({ op: "replace", path: "/pausesSec", value: pausesSec });
  pushReplace(ops, "/totalSec", spec.totalSec, totalSec);
  return { spec: { ...spec, blocks, pausesSec, totalSec }, ops };
}

export function createTextLayer(
  spec: VideoSpec,
  input: { afterLayerId?: string | null; text?: string; isCTA?: boolean; id?: string },
): LayerPatchResult {
  const text = (input.text ?? "New text").trim() || "New text";
  const afterIdx = input.afterLayerId && input.afterLayerId !== "hook"
    ? spec.blocks.findIndex((b) => b.id === input.afterLayerId)
    : -1;
  const insertIdx = afterIdx >= 0 ? afterIdx + 1 : 0;
  const previousEnd = afterIdx >= 0 ? spec.blocks[afterIdx]!.endSec : spec.hook.durationSec;
  const capSec = timelineCapSec(spec);
  const desiredDurationSec = blockDurationSec(text);
  const startSec = roundCs(clamp(previousEnd + DEFAULT_LAYER_GAP_SEC, 0, Math.max(0, capSec - MIN_LAYER_SEC)));
  const endSec = roundCs(Math.min(capSec, startSec + desiredDurationSec));
  const block: VideoSpec["blocks"][number] = {
    id: input.id ?? `layer-${Date.now().toString(36)}`,
    text,
    isCTA: Boolean(input.isCTA),
    startSec,
    endSec,
    animation: input.isCTA ? "pop" : "fade",
  };
  const blocks = [...spec.blocks.slice(0, insertIdx), block, ...spec.blocks.slice(insertIdx)];
  const pausesSec = pausesFromTimeline(spec, blocks);
  const totalSec = recomputeTotalSec(spec, blocks);
  const ops: Operation[] = [{ op: "add", path: `/blocks/${insertIdx}`, value: block }];
  ops.push({ op: "replace", path: "/pausesSec", value: pausesSec });
  pushReplace(ops, "/totalSec", spec.totalSec, totalSec);
  return { spec: { ...spec, blocks, pausesSec, totalSec }, ops };
}

export function editTextLayer(
  spec: VideoSpec,
  layerId: string,
  patch: { text?: string; isCTA?: boolean },
): LayerPatchResult {
  const idx = spec.blocks.findIndex((b) => b.id === layerId);
  if (idx < 0) return { spec, ops: [] };
  const old = spec.blocks[idx]!;
  const next: VideoSpec["blocks"][number] = {
    ...old,
    text: patch.text ?? old.text,
    isCTA: patch.isCTA ?? old.isCTA,
    animation: (patch.isCTA ?? old.isCTA) ? "pop" : "fade",
  };
  const blocks = spec.blocks.map((b, i) => (i === idx ? next : b));
  const ops: Operation[] = [];
  pushReplace(ops, `/blocks/${idx}/text`, old.text, next.text);
  pushReplace(ops, `/blocks/${idx}/isCTA`, old.isCTA, next.isCTA);
  pushReplace(ops, `/blocks/${idx}/animation`, old.animation, next.animation);
  return { spec: { ...spec, blocks }, ops };
}

export function deleteTextLayer(spec: VideoSpec, layerId: string): LayerPatchResult {
  const idx = spec.blocks.findIndex((b) => b.id === layerId);
  if (idx < 0) return { spec, ops: [] };
  const blocks = spec.blocks.filter((_, i) => i !== idx);
  const pausesSec = pausesForLength(spec, blocks.length);
  const totalSec = recomputeTotalSec(spec, blocks);
  const ops: Operation[] = [{ op: "remove", path: `/blocks/${idx}` }];
  ops.push({ op: "replace", path: "/pausesSec", value: pausesSec ?? [] });
  pushReplace(ops, "/totalSec", spec.totalSec, totalSec);
  return { spec: { ...spec, blocks, pausesSec, totalSec }, ops };
}
