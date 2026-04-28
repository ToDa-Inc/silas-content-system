import assert from "node:assert/strict";
import test from "node:test";
import type { VideoSpec } from "./video-spec.ts";
import {
  buildLayerRows,
  computeLayerTimingChange,
  createTextLayer,
  deleteTextLayer,
  editTextLayer,
} from "./video-spec-layer-timeline.ts";

function baseSpec(): VideoSpec {
  return {
    v: 1,
    templateId: "centered-pop",
    themeId: "bold-modern",
    appearance: {},
    brand: { primary: "#fff", accent: null },
    background: { url: "https://example.com/bg.mp4", kind: "video", focalPoint: "center", durationSec: 12 },
    hook: { text: "Intro hook", durationSec: 2 },
    blocks: [
      { id: "b1", text: "First beat", isCTA: false, startSec: 2, endSec: 4, animation: "fade" },
      { id: "b2", text: "Second beat", isCTA: true, startSec: 4.5, endSec: 6, animation: "pop" },
    ],
    layout: {
      verticalAnchor: "bottom",
      verticalOffset: 0,
      scale: 1,
      sidePadding: 0.05,
      textAlign: "center",
      stackGap: 0.008,
      stackGrowth: "up",
    },
    gapBetweenBlocksSec: 0,
    pausesSec: [0, 0.5],
    totalSec: 7,
  };
}

test("buildLayerRows returns hook and block rows with timeline positions", () => {
  const rows = buildLayerRows(baseSpec());

  assert.deepEqual(
    rows.map((r) => ({ id: r.id, kind: r.kind, startSec: r.startSec, endSec: r.endSec })),
    [
      { id: "hook", kind: "hook", startSec: 0, endSec: 2 },
      { id: "b1", kind: "block", startSec: 2, endSec: 4 },
      { id: "b2", kind: "block", startSec: 4.5, endSec: 6 },
    ],
  );
  assert.equal(rows[1]?.leftPct, 28.57);
  assert.equal(rows[1]?.widthPct, 28.57);
});

test("computeLayerTimingChange clamps a block start before its end", () => {
  const result = computeLayerTimingChange(baseSpec(), "b1", { startSec: 3.5, endSec: 4.2 });

  assert.equal(result.spec.blocks[0]?.startSec, 3.5);
  assert.equal(result.spec.blocks[0]?.endSec, 4.2);
  assert.equal(result.spec.blocks[1]?.startSec, 4.5);
  assert.equal(result.spec.blocks[1]?.endSec, 6);
  assert.deepEqual(result.ops, [
    { op: "replace", path: "/blocks/0/startSec", value: 3.5 },
    { op: "replace", path: "/blocks/0/endSec", value: 4.2 },
    { op: "replace", path: "/pausesSec", value: [1.5, 0.3] },
    { op: "replace", path: "/totalSec", value: 6 },
  ]);
});

test("computeLayerTimingChange allows overlapping independent block windows", () => {
  const result = computeLayerTimingChange(baseSpec(), "b2", { startSec: 2.6, endSec: 5.2 });

  assert.equal(result.spec.blocks[0]?.startSec, 2);
  assert.equal(result.spec.blocks[0]?.endSec, 4);
  assert.equal(result.spec.blocks[1]?.startSec, 2.6);
  assert.equal(result.spec.blocks[1]?.endSec, 5.2);
  assert.deepEqual(
    buildLayerRows(result.spec).map((r) => ({ id: r.id, startSec: r.startSec, endSec: r.endSec })),
    [
      { id: "hook", startSec: 0, endSec: 2 },
      { id: "b1", startSec: 2, endSec: 4 },
      { id: "b2", startSec: 2.6, endSec: 5.2 },
    ],
  );
});

test("computeLayerTimingChange allows a block to span the whole video", () => {
  const result = computeLayerTimingChange(baseSpec(), "b2", { startSec: 0, endSec: 12 });

  assert.equal(result.spec.blocks[1]?.startSec, 0);
  assert.equal(result.spec.blocks[1]?.endSec, 12);
  assert.equal(result.spec.blocks[0]?.startSec, 2);
  assert.equal(result.spec.blocks[0]?.endSec, 4);
});

test("computeLayerTimingChange caps a block at the video duration", () => {
  const result = computeLayerTimingChange(baseSpec(), "b2", { startSec: 0, endSec: 20 });

  assert.equal(result.spec.blocks[1]?.startSec, 0);
  assert.equal(result.spec.blocks[1]?.endSec, 12);
  assert.equal(result.spec.totalSec, 12);
});

test("computeLayerTimingChange allows a block beyond the old 120s ceiling", () => {
  const longSpec = {
    ...baseSpec(),
    background: { ...baseSpec().background, durationSec: 300 },
    totalSec: 300,
  };

  const result = computeLayerTimingChange(longSpec, "b2", { startSec: 0, endSec: 300 });

  assert.equal(result.spec.blocks[1]?.startSec, 0);
  assert.equal(result.spec.blocks[1]?.endSec, 300);
  assert.equal(result.spec.totalSec, 300);
});

test("computeLayerTimingChange allows hook to span the whole video", () => {
  const result = computeLayerTimingChange(baseSpec(), "hook", { endSec: 12 });

  assert.equal(result.spec.hook.durationSec, 12);
  assert.equal(result.spec.blocks[0]?.startSec, 2);
  assert.equal(result.spec.blocks[1]?.startSec, 4.5);
});

test("computeLayerTimingChange caps the hook at the video duration", () => {
  const result = computeLayerTimingChange(baseSpec(), "hook", { endSec: 20 });

  assert.equal(result.spec.hook.durationSec, 12);
  assert.equal(result.spec.totalSec, 12);
});

test("createTextLayer inserts after the selected block with readable timing", () => {
  const result = createTextLayer(baseSpec(), {
    afterLayerId: "b1",
    text: "New beat here",
    id: "new-1",
  });

  assert.deepEqual(result.spec.blocks.map((b) => b.id), ["b1", "new-1", "b2"]);
  assert.equal(result.spec.blocks[1]?.startSec, 4.1);
  assert.equal(result.spec.blocks[1]?.endSec, 6.16);
  assert.equal(result.ops[0]?.op, "add");
  assert.equal(result.ops[0]?.path, "/blocks/1");
});

test("editTextLayer and deleteTextLayer patch the matching block", () => {
  const edited = editTextLayer(baseSpec(), "b2", { text: "Updated CTA", isCTA: false });
  assert.equal(edited.spec.blocks[1]?.text, "Updated CTA");
  assert.equal(edited.spec.blocks[1]?.isCTA, false);
  assert.deepEqual(edited.ops, [
    { op: "replace", path: "/blocks/1/text", value: "Updated CTA" },
    { op: "replace", path: "/blocks/1/isCTA", value: false },
    { op: "replace", path: "/blocks/1/animation", value: "fade" },
  ]);

  const deleted = deleteTextLayer(edited.spec, "b1");
  assert.deepEqual(deleted.spec.blocks.map((b) => b.id), ["b2"]);
  assert.deepEqual(deleted.ops, [
    { op: "remove", path: "/blocks/0" },
    { op: "replace", path: "/pausesSec", value: [0] },
    { op: "replace", path: "/totalSec", value: 6 },
  ]);
});

test("deleteTextLayer sends an empty pauses array when removing the last block", () => {
  const oneBlock = { ...baseSpec(), blocks: [baseSpec().blocks[0]!], pausesSec: [0], totalSec: 4 };

  const deleted = deleteTextLayer(oneBlock, "b1");

  assert.deepEqual(deleted.spec.blocks, []);
  assert.deepEqual(deleted.ops, [
    { op: "remove", path: "/blocks/0" },
    { op: "replace", path: "/pausesSec", value: [] },
    { op: "replace", path: "/totalSec", value: 2.5 },
  ]);
});
