import type { VideoSpec, VideoSpecAppearance, VideoSpecLayout } from "./video-spec";

const DEFAULT_COVER_LAYOUT: VideoSpecLayout = {
  verticalAnchor: "bottom",
  verticalOffset: 0,
  scale: 1,
  sidePadding: 0.05,
  textAlign: "center",
  stackGap: 0.008,
  stackGrowth: "up",
};

export type CoverEditState = {
  cropY: number;
  zoom: number;
  wash: boolean;
  templateId: VideoSpec["templateId"];
  themeId: VideoSpec["themeId"];
  textTreatment?: "bold-outline";
  layout: VideoSpecLayout;
  appearance: VideoSpecAppearance;
};

export const DEFAULT_COVER_EDIT: CoverEditState = {
  cropY: 0.5,
  zoom: 1,
  wash: true,
  templateId: "centered-pop",
  themeId: "bold-modern",
  layout: DEFAULT_COVER_LAYOUT,
  appearance: {},
};

export function coverPayload(edit: CoverEditState) {
  return {
    cropY: edit.cropY,
    zoom: edit.zoom,
    wash: edit.wash,
    templateId: edit.templateId,
    themeId: edit.themeId,
    textTreatment: edit.textTreatment ?? null,
    layout: edit.layout,
    appearance: edit.appearance,
  };
}
