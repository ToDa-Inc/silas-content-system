import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_COVER_EDIT, coverPayload } from "./cover-edit.ts";

test("coverPayload uses video editor control fields instead of legacy cover chips", () => {
  const payload = coverPayload({
    ...DEFAULT_COVER_EDIT,
    templateId: "stacked-cards",
    themeId: "editorial",
    textTreatment: "bold-outline",
    layout: {
      ...DEFAULT_COVER_EDIT.layout,
      verticalAnchor: "center",
      verticalOffset: 0.06,
      scale: 0.9,
      textAlign: "right",
    },
    appearance: {
      fontId: "poppins",
      overlayTextColor: "#ffffff",
      overlayStroke: "#000000",
    },
  });

  assert.equal(payload.templateId, "stacked-cards");
  assert.equal(payload.themeId, "editorial");
  assert.equal(payload.textTreatment, "bold-outline");
  assert.equal(payload.layout.verticalAnchor, "center");
  assert.equal(payload.layout.verticalOffset, 0.06);
  assert.equal(payload.layout.scale, 0.9);
  assert.equal(payload.layout.textAlign, "right");
  assert.equal(payload.appearance.fontId, "poppins");
  assert.equal("textPosition" in payload, false);
  assert.equal("textSize" in payload, false);
  assert.equal("textTheme" in payload, false);
});
