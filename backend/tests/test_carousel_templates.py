import unittest
from unittest.mock import patch

from models.generation import GenerationStartBody, SelectedCarouselTemplate, SelectedCoverTemplate
from routers.creation import _carousel_slide_count_from_request
from services.content_generation import run_carousel_slide_texts
from services.image_generation import generate_slide_image


class CarouselTemplateModelsTest(unittest.TestCase):
    def test_generation_start_accepts_selected_carousel_template_snapshot(self):
        body = GenerationStartBody(
            source_type="idea_match",
            format_key="carousel",
            idea_text="A post about speaking up in meetings",
            selected_carousel_template={
                "id": "template_conny_tweets",
                "name": "Conny tweets",
                "description": "Cover photo, then tweet-style message screenshots",
                "slides": [
                    {
                        "idx": 0,
                        "role": "cover",
                        "reference_image_id": "img_creator",
                        "reference_image_url": "https://example.com/conny.jpg",
                        "reference_label": "Conny portrait",
                        "instruction": "Creator photo with one strong headline",
                    },
                    {
                        "idx": 1,
                        "role": "screenshot",
                        "reference_image_id": "img_tweet",
                        "reference_image_url": "https://example.com/tweet.jpg",
                        "reference_label": "Tweet screenshot",
                        "instruction": "Tweet-style screenshot with the first message",
                    },
                ],
            },
        )

        template = body.selected_carousel_template

        self.assertIsInstance(template, SelectedCarouselTemplate)
        self.assertEqual(template.name, "Conny tweets")
        self.assertEqual(len(template.slides), 2)
        self.assertEqual(template.slides[1].role, "screenshot")

    def test_generation_start_accepts_selected_cover_template_snapshot(self):
        body = GenerationStartBody(
            source_type="idea_match",
            format_key="text_overlay",
            idea_text="A reel about direct communication",
            selected_cover_template={
                "id": "cover_portrait",
                "name": "Portrait cover",
                "reference_image_id": "img_creator",
                "reference_image_url": "https://example.com/portrait.jpg",
                "reference_label": "Creator portrait",
                "instruction": "Use the face-centered portrait with large serif headline.",
            },
        )

        template = body.selected_cover_template

        self.assertIsInstance(template, SelectedCoverTemplate)
        self.assertEqual(template.name, "Portrait cover")
        self.assertEqual(template.reference_image_id, "img_creator")
        self.assertIn("serif headline", template.instruction)


class CarouselTemplatePromptTest(unittest.TestCase):
    def test_template_does_not_override_requested_slide_count(self):
        row = {
            "selected_carousel_template": {
                "id": "template_three_refs",
                "name": "Three reference slides",
                "slides": [
                    {"idx": 0, "role": "cover"},
                    {"idx": 1, "role": "body"},
                    {"idx": 2, "role": "cta"},
                ],
            }
        }

        self.assertEqual(_carousel_slide_count_from_request(row, requested_count=6), 6)

    def test_slide_text_prompt_includes_template_sequence(self):
        captured = {}

        def fake_chat_json_completion(*args, **kwargs):
            captured["user"] = kwargs["user"]
            return {"slides": ["Cover", "Tweet one", "CTA"]}

        client_row = {
            "name": "Conny",
            "language": "en",
            "client_dna": {
                "generation_brief": "Audience: managers who struggle to speak up.",
                "voice_brief": "Direct, honest, concise.",
            },
        }
        template = {
            "id": "template_conny_tweets",
            "name": "Conny tweets",
            "description": "Cover photo, then tweet-style message screenshots",
            "slides": [
                {
                    "idx": 0,
                    "role": "cover",
                    "reference_label": "Conny portrait",
                    "instruction": "Creator photo with one strong headline",
                },
                {
                    "idx": 1,
                    "role": "screenshot",
                    "reference_label": "Tweet screenshot",
                    "instruction": "Tweet-style screenshot with the first message",
                },
                {
                    "idx": 2,
                    "role": "cta",
                    "reference_label": "CTA card",
                    "instruction": "End with a simple next step",
                },
            ],
        }

        with patch("services.content_generation.chat_json_completion", side_effect=fake_chat_json_completion):
            slides = run_carousel_slide_texts(
                type("Settings", (), {"openrouter_api_key": "key", "openrouter_model": "model"})(),
                client_row=client_row,
                chosen_angle={"title": "Meeting confidence"},
                hook_text="You do not need more confidence",
                count=3,
                selected_carousel_template=template,
            )

        self.assertEqual(slides, ["Cover", "Tweet one", "CTA"])
        self.assertIn("CAROUSEL_TEMPLATE", captured["user"])
        self.assertIn("Conny tweets", captured["user"])
        self.assertIn("Tweet-style screenshot", captured["user"])


class CarouselTemplateImagePromptTest(unittest.TestCase):
    def test_generate_slide_image_forwards_visual_prompt_to_ai_background(self):
        with patch("services.image_generation.generate_thumbnail_freepik_pillow") as generate:
            generate.return_value = b"png"

            result = generate_slide_image(
                text="Tweet one",
                idx=1,
                total=3,
                freepik_key="freepik-key",
                visual_prompt="Tweet-style screenshot card, white background, black text",
            )

        self.assertEqual(result, b"png")
        self.assertIn("Tweet-style screenshot", generate.call_args.kwargs["angle_context"])


if __name__ == "__main__":
    unittest.main()
