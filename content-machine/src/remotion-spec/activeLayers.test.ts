// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck - Node's built-in test runner needs explicit `.ts` imports under `--experimental-strip-types`.
import assert from "node:assert/strict";
import test from "node:test";
import { activeCaptionLayers } from "./activeLayers.ts";

test("activeCaptionLayers returns hook and overlapping block at the same timestamp", () => {
  const layers = activeCaptionLayers(
    {
      hook: { text: "Hook text", durationSec: 5.5 },
      blocks: [
        {
          id: "cta",
          text: "CTA text",
          isCTA: true,
          startSec: 2.6,
          endSec: 5.2,
          animation: "pop",
        },
      ],
    },
    3,
  );

  assert.deepEqual(
    layers.map((l) => ({ key: l.key, text: l.text, isCTA: l.isCTA, startSec: l.startSec })),
    [
      { key: "hook", text: "Hook text", isCTA: false, startSec: 0 },
      { key: "cta", text: "CTA text", isCTA: true, startSec: 2.6 },
    ],
  );
});

test("activeCaptionLayers hides hook after its duration", () => {
  const layers = activeCaptionLayers(
    {
      hook: { text: "Hook text", durationSec: 1 },
      blocks: [],
    },
    2,
  );

  assert.deepEqual(layers, []);
});
