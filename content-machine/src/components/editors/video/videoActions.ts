/**
 * videoActions — action provider for the Video editor (text_overlay / b_roll_reel).
 *
 * Each entry maps a user-facing command to a callback on the editor host.
 * Consumed by both:
 *   1. `EditorCommandPalette` (⌘K) for typed-search invocation
 *   2. Inspector buttons via `actionById(registry, "video.hook.shorten").run()`
 *
 * Same registry powers both surfaces — zero chance of palette and visible
 * buttons drifting apart, which is the whole point.
 *
 * The host (today: `video-create-workspace.tsx` while the migration is in
 * progress; tomorrow: `editors/video/VideoEditor.tsx` with `useVideoEditor`)
 * passes in the regen/refine/template callbacks it already has. This file
 * stays pure: it just wraps callbacks in EditorAction metadata.
 */

import type { EditorAction } from "../shared/actionRegistry";
import type { VideoSpec } from "@/lib/video-spec";

export type VideoActionsHost = {
  /** Currently selected segment ID (e.g. "hook", block id) — drives `appliesTo`. */
  selectedSegmentId: string;
  /** True while AI refine is mid-flight; disables refine actions. */
  aiRefineBusy: boolean;
  /** True while the regen scope of that name is busy. */
  regenBusyScope: "hooks" | "script" | "caption" | "story" | "text_blocks" | null;

  /** Current spec; some actions are spec-dependent (e.g. enable Outline only when text isn't already outlined). */
  spec: VideoSpec | null;

  /** Regenerate a section ("hooks" | "text_blocks" | "caption"). */
  regen: (
    scope: "hooks" | "text_blocks" | "caption",
    feedback: string,
  ) => Promise<boolean>;

  /** Apply a free-text refine prompt to the whole video (current "AI Refine" feature). */
  applyRefinePrompt: (prompt: string) => Promise<void>;

  /** Toggle bold-outline text treatment. */
  setBoldOutline: (on: boolean) => Promise<void>;
};

export function buildVideoActions(host: VideoActionsHost): EditorAction[] {
  const {
    selectedSegmentId,
    aiRefineBusy,
    regenBusyScope,
    spec,
    regen,
    applyRefinePrompt,
    setBoldOutline,
  } = host;

  const hookSelected = selectedSegmentId === "hook";

  return [
    // ──────────── Text ────────────
    {
      id: "video.hook.shorten",
      label: "Shorten hook",
      shortLabel: "Shorten",
      group: "Text",
      keywords: ["short", "tighter", "trim"],
      appliesTo: (sel) => sel.kind === "hook" || hookSelected,
      disabled: regenBusyScope === "hooks",
      run: async () => {
        await regen("hooks", "shorter, tighter, punchier");
      },
    },
    {
      id: "video.hook.improve",
      label: "Improve hook",
      shortLabel: "Improve",
      group: "Text",
      keywords: ["rewrite", "better", "polish"],
      appliesTo: (sel) => sel.kind === "hook" || hookSelected,
      disabled: regenBusyScope === "hooks",
      run: async () => {
        await regen("hooks", "more direct, clearer, more compelling");
      },
    },
    {
      id: "video.hook.vary",
      label: "Generate 5 hook variants",
      shortLabel: "Vary",
      group: "Text",
      keywords: ["variants", "options", "alternate"],
      appliesTo: (sel) => sel.kind === "hook" || hookSelected,
      disabled: regenBusyScope === "hooks",
      run: async () => {
        await regen("hooks", "give me 5 different angles");
      },
    },
    {
      id: "video.blocks.regenerate",
      label: "Regenerate on-screen text blocks",
      group: "Text",
      keywords: ["blocks", "captions"],
      disabled: regenBusyScope === "text_blocks",
      run: async () => {
        await regen("text_blocks", "");
      },
    },
    {
      id: "video.caption.shorten",
      label: "Shorten Instagram caption",
      group: "Text",
      keywords: ["caption", "description"],
      disabled: regenBusyScope === "caption",
      run: async () => {
        await regen("caption", "shorter, less filler");
      },
    },

    // ──────────── Visual ────────────
    {
      id: "video.style.outline.on",
      label: "Use bold outline lettering",
      shortLabel: "Outline on",
      group: "Visual",
      keywords: ["heavy", "stroke", "punchy"],
      appliesTo: () => Boolean(spec),
      run: async () => {
        await setBoldOutline(true);
      },
    },
    {
      id: "video.style.outline.off",
      label: "Use normal lettering",
      shortLabel: "Outline off",
      group: "Visual",
      appliesTo: () => Boolean(spec),
      run: async () => {
        await setBoldOutline(false);
      },
    },

    // ──────────── AI ────────────
    {
      id: "video.refine.custom",
      label: "Apply AI refine prompt…",
      group: "AI",
      keywords: ["ai", "refine", "edit", "prompt"],
      description: "Free-text instruction applied to the whole video spec",
      disabled: aiRefineBusy,
      run: async () => {
        const prompt = typeof window !== "undefined"
          ? window.prompt("How should the video change?")
          : null;
        if (prompt && prompt.trim()) {
          await applyRefinePrompt(prompt.trim());
        }
      },
    },
  ];
}
