import unittest
from unittest.mock import patch

from services.image_generation import generate_slide_image


class GenerateSlideImageTest(unittest.TestCase):
    def test_defaults_to_instagram_carousel_dimensions_for_ai_background(self):
        with patch("services.image_generation.generate_thumbnail_freepik_pillow") as generate:
            generate.return_value = b"png"

            result = generate_slide_image(
                text="Hook",
                idx=0,
                total=3,
                freepik_key="freepik-key",
            )

        self.assertEqual(result, b"png")
        self.assertEqual(generate.call_args.kwargs["target_w"], 1080)
        self.assertEqual(generate.call_args.kwargs["target_h"], 1350)

    def test_defaults_to_instagram_carousel_dimensions_for_client_image(self):
        with patch("services.image_generation.compose_thumbnail_from_image") as compose:
            compose.return_value = b"png"

            result = generate_slide_image(
                text="Hook",
                idx=0,
                total=3,
                client_image_bytes=b"image",
            )

        self.assertEqual(result, b"png")
        self.assertEqual(compose.call_args.kwargs["target_w"], 1080)
        self.assertEqual(compose.call_args.kwargs["target_h"], 1350)


if __name__ == "__main__":
    unittest.main()
