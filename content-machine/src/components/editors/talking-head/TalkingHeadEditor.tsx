/**
 * TalkingHeadEditor — minimal flow for `talking_head` sessions.
 *
 * Talking-head doesn't go through the Remotion render pipeline — the user
 * films themself reading the script. So this editor only surfaces:
 *   1. Editable script (with regenerate + copy)
 *   2. Cover (reuses the shared CoverEditor)
 *   3. Caption
 *   4. "What the AI is working with" (alternate hooks)
 *
 * Pure presentational component. The host workspace still owns `scriptDraft`,
 * autosave, and the regen/copy callbacks — the `useTalkingHeadEditor` hook
 * planned for Phase B.6 will wrap that state and own it directly.
 */

import type { ReactNode } from "react";
import { Copy, Video } from "lucide-react";

import { SaveStatusPill } from "@/components/editor-ui";
import type { ClientImageRow, GenerationSession } from "@/lib/api-client";
import type { CoverEditState } from "@/lib/cover-edit";

import { AiContextSection } from "../shared/AiContextSection";
import { CaptionSection } from "../shared/CaptionSection";
import { RegenInline, type RegenScope } from "../shared/RegenInline";
import { CoverEditor, type CoverMode } from "../cover/CoverEditor";

type Props = {
  scriptDraft: string;
  setScriptDraft: (s: string) => void;
  contentInFlight: number;
  regenBusyScope: RegenScope | null;
  onRegenSection: (scope: RegenScope, feedback: string) => Promise<boolean>;
  copyText: (label: string, text: string) => void | Promise<void>;

  hooks: Array<{ text?: string }>;
  coverOptions: string[];
  coverRegenBusy: boolean;
  onRegenerateCovers: () => void;
  images: ClientImageRow[];
  thumbnailUrl: string | null;
  thumbnailBusy: boolean;
  coverText: string;
  coverImageId: string;
  selectedCoverTemplate: GenerationSession["selected_cover_template"] | null;
  coverEdit: CoverEditState;
  coverSpecInFlight: number;
  coverMode: CoverMode;
  onCoverModeChange: (m: CoverMode) => void;
  onCoverTextChange: (s: string) => void;
  onCoverEditChange: (next: CoverEditState) => void;
  onSelectCoverImage: (id: string) => void;
  onGenerateThumbnail: () => void;
  onComposeCoverFromImage: () => void;

  captionBody: string;
  hashtags: string[];
  captionFull: string;
  storySection: ReactNode;
};

export function TalkingHeadEditor({
  scriptDraft,
  setScriptDraft,
  contentInFlight,
  regenBusyScope,
  onRegenSection,
  copyText,

  hooks,
  coverOptions,
  coverRegenBusy,
  onRegenerateCovers,
  images,
  thumbnailUrl,
  thumbnailBusy,
  coverText,
  coverImageId,
  selectedCoverTemplate,
  coverEdit,
  coverSpecInFlight,
  coverMode,
  onCoverModeChange,
  onCoverTextChange,
  onCoverEditChange,
  onSelectCoverImage,
  onGenerateThumbnail,
  onComposeCoverFromImage,

  captionBody,
  hashtags,
  captionFull,
  storySection,
}: Props) {
  return (
    <div className="space-y-4">
      <div className="glass rounded-2xl border border-app-divider/80 p-5 md:p-6">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Video className="h-4 w-4 text-amber-500" />
          <h2 className="flex-1 text-sm font-semibold text-app-fg">Script</h2>
          <RegenInline
            scope="script"
            busy={regenBusyScope === "script"}
            onRegen={async (s, fb) => onRegenSection(s, fb)}
            placeholder="Tighter, more direct, add a story…"
          />
          <button
            type="button"
            onClick={() => void copyText("script", scriptDraft)}
            className="inline-flex items-center gap-1 rounded-lg bg-app-icon-btn-bg px-2.5 py-1 text-[11px] font-bold text-app-icon-btn-fg"
          >
            <Copy className="h-3 w-3" /> Copy
          </button>
        </div>
        <p className="mb-3 text-xs leading-relaxed text-app-fg-muted">
          Talking-head format — film yourself reading this script. Edit freely; markdown headings
          (##&nbsp;Hook, ##&nbsp;Build-up, ##&nbsp;Reframe, ##&nbsp;Clarity, ##&nbsp;CTA) match the content brief.
        </p>
        <textarea
          value={scriptDraft}
          onChange={(e) => setScriptDraft(e.target.value)}
          rows={Math.min(28, Math.max(10, scriptDraft.split("\n").length + 1))}
          className="glass-inset w-full resize-y rounded-xl px-3 py-3 font-mono text-[13px] leading-relaxed text-app-fg placeholder:text-app-fg-subtle focus:outline-none focus:ring-2 focus:ring-amber-500/35"
          placeholder="## Hook&#10;…&#10;&#10;## Build-up&#10;…&#10;&#10;## Reframe&#10;…"
        />
        <div className="mt-3 flex items-center gap-2 text-[11px] text-app-fg-subtle">
          <SaveStatusPill inFlight={contentInFlight} />
          <span className="opacity-70">Changes save automatically.</span>
        </div>
      </div>

      <CoverEditor
        hooks={hooks}
        coverOptions={coverOptions}
        coverRegenBusy={coverRegenBusy}
        onRegenerateCovers={onRegenerateCovers}
        images={images}
        thumbnailUrl={thumbnailUrl}
        thumbnailBusy={thumbnailBusy}
        coverText={coverText}
        selectedImageId={coverImageId}
        selectedCoverTemplate={selectedCoverTemplate}
        coverEdit={coverEdit}
        coverSpecInFlight={coverSpecInFlight}
        mode={coverMode}
        onModeChange={onCoverModeChange}
        onCoverTextChange={onCoverTextChange}
        onCoverEditChange={onCoverEditChange}
        onSelectImage={onSelectCoverImage}
        onGenerateAi={onGenerateThumbnail}
        onComposeFromImage={onComposeCoverFromImage}
        step={2}
      />

      <CaptionSection
        caption={captionBody}
        hashtags={hashtags}
        onCopy={() => void copyText("caption + hashtags", captionFull)}
        regenInline={
          <RegenInline
            scope="caption"
            busy={regenBusyScope === "caption"}
            onRegen={async (s, fb) => onRegenSection(s, fb)}
            placeholder="Different angle, shorter, …"
          />
        }
      />

      {storySection}

      <AiContextSection
        hooks={hooks}
        regenHooks={(fb) => onRegenSection("hooks", fb)}
        busy={regenBusyScope === "hooks"}
      />
    </div>
  );
}
