/** VideoSpec v1 — shared contract with backend (Pydantic). */

export type VideoTemplateId =
  | 'bottom-card'
  | 'centered-pop'
  | 'top-banner'
  | 'capcut-highlight';

export type VideoThemeId =
  | 'bold-modern'
  | 'editorial'
  | 'casual-hand'
  | 'clean-minimal';

export type VideoAnimation = 'pop' | 'fade' | 'slide-up' | 'none';

export type BackgroundKind = 'video' | 'image';

export type FocalPoint = 'top' | 'center' | 'bottom';

export type VideoSpecBrand = {
  primary: string;
  /** Backend serializes `Optional[str]` as JSON `null` — accept both shapes. */
  accent?: string | null;
};

export type VideoSpecBackground = {
  url: string;
  kind: BackgroundKind;
  focalPoint: FocalPoint;
  /** B-roll length (seconds) when known — composition totalSec matches this. */
  durationSec?: number;
};

export type VideoSpecHook = {
  text: string;
  durationSec: number;
};

export type VideoSpecBlock = {
  id: string;
  text: string;
  isCTA: boolean;
  startSec: number;
  endSec: number;
  animation: VideoAnimation;
};

export type VerticalAnchor = 'bottom' | 'center' | 'top';

/** Global layout modifiers — applied uniformly across the chosen template. */
export type VideoSpecLayout = {
  /** Coarse vertical placement (bottom-card uses this; others mainly use offset). */
  verticalAnchor?: VerticalAnchor;
  /** Fine nudge as a fraction of canvas height. Negative = up, positive = down. */
  verticalOffset: number;
  /** Multiplier on the template's default fontSize. */
  scale: number;
  /** Per-side horizontal padding as a fraction of canvas width. */
  sidePadding: number;
};

export const DEFAULT_LAYOUT: VideoSpecLayout = {
  verticalAnchor: 'bottom',
  verticalOffset: 0,
  scale: 1,
  sidePadding: 0.05,
};

export type VideoSpec = {
  v: 1;
  templateId: VideoTemplateId;
  themeId: VideoThemeId;
  brand: VideoSpecBrand;
  background: VideoSpecBackground;
  hook: VideoSpecHook;
  blocks: VideoSpecBlock[];
  /** Optional in older serialized specs — templates read via `resolveLayout()` to backfill. */
  layout?: VideoSpecLayout;
  gapBetweenBlocksSec?: number;
  pausesSec?: number[];
  totalSec: number;
};

/** Single source of truth for templates: always returns a complete layout (older specs auto-fill). */
export function resolveLayout(spec: VideoSpec): VideoSpecLayout {
  const l = spec.layout;
  if (!l) return DEFAULT_LAYOUT;
  const a = l.verticalAnchor;
  const anchor: VerticalAnchor =
    a === 'center' || a === 'top' || a === 'bottom' ? a : 'bottom';
  return {
    verticalAnchor: anchor,
    verticalOffset: typeof l.verticalOffset === 'number' ? l.verticalOffset : 0,
    scale: typeof l.scale === 'number' ? l.scale : 1,
    sidePadding: typeof l.sidePadding === 'number' ? l.sidePadding : 0.05,
  };
}

export const defaultStudioSpec: VideoSpec = {
  v: 1,
  templateId: 'centered-pop',
  themeId: 'bold-modern',
  brand: { primary: '#ffffff' },
  background: {
    url: 'https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
    kind: 'video',
    focalPoint: 'center',
  },
  hook: { text: 'Preview hook', durationSec: 2 },
  layout: DEFAULT_LAYOUT,
  blocks: [
    {
      id: 'b1',
      text: 'First beat',
      isCTA: false,
      startSec: 2.5,
      endSec: 5,
      animation: 'fade',
    },
    {
      id: 'b2',
      text: 'Second beat',
      isCTA: false,
      startSec: 5,
      endSec: 7.5,
      animation: 'fade',
    },
    {
      id: 'b3',
      text: 'CTA',
      isCTA: true,
      startSec: 7.5,
      endSec: 10,
      animation: 'pop',
    },
  ],
  gapBetweenBlocksSec: 0,
  pausesSec: [0, 0, 0],
  totalSec: 11,
};
