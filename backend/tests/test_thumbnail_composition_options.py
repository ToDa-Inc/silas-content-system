import io

from PIL import Image, ImageFont

import services.image_generation as image_generation


class _MonkeyPatch:
    def setattr(self, obj, name, value):
        setattr(obj, name, value)


def test_compose_thumbnail_accepts_crop_and_text_style_options(monkeypatch):
    monkeypatch.setattr(image_generation, "_load_font", lambda _size: ImageFont.load_default())
    src = Image.new("RGB", (800, 800), (80, 120, 180))
    buf = io.BytesIO()
    src.save(buf, format="PNG")

    png = image_generation.compose_thumbnail_from_image(
        buf.getvalue(),
        "Cover text",
        target_w=180,
        target_h=320,
        wash=False,
        crop_y=0.2,
        zoom=1.25,
        template_id="bottom-card",
        theme_id="editorial",
        text_treatment="bold-outline",
        layout={"verticalAnchor": "bottom", "verticalOffset": 0.04, "scale": 0.9, "sidePadding": 0.08, "textAlign": "right"},
        appearance={"fontId": "poppins", "overlayTextColor": "#ffffff", "overlayStroke": "#000000", "cardBg": "rgba(20,20,20,0.72)"},
    )

    out = Image.open(io.BytesIO(png))
    assert out.size == (180, 320)


if __name__ == "__main__":
    test_compose_thumbnail_accepts_crop_and_text_style_options(_MonkeyPatch())
