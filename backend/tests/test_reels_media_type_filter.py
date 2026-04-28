import unittest

from services.reels_media_type_filter import apply_reels_media_type_filter


class FakeQuery:
    def __init__(self):
        self.calls = []

    def eq(self, column, value):
        self.calls.append(("eq", column, value))
        return self

    def neq(self, column, value):
        self.calls.append(("neq", column, value))
        return self

    def lt(self, column, value):
        self.calls.append(("lt", column, value))
        return self

    def gte(self, column, value):
        self.calls.append(("gte", column, value))
        return self

    def gt(self, column, value):
        self.calls.append(("gt", column, value))
        return self


class ApplyReelsMediaTypeFilterTest(unittest.TestCase):
    def test_short_filters_non_carousels_under_fifteen_seconds(self):
        query = apply_reels_media_type_filter(FakeQuery(), "short")

        self.assertEqual(
            query.calls,
            [
                ("neq", "format", "carousel"),
                ("lt", "video_duration", 15),
            ],
        )

    def test_long_filters_non_carousels_over_fifteen_seconds(self):
        query = apply_reels_media_type_filter(FakeQuery(), "long")

        self.assertEqual(
            query.calls,
            [
                ("neq", "format", "carousel"),
                ("gt", "video_duration", 15),
            ],
        )

    def test_carousel_filters_format(self):
        query = apply_reels_media_type_filter(FakeQuery(), "carousel")

        self.assertEqual(query.calls, [("eq", "format", "carousel")])

    def test_all_and_unknown_values_leave_query_unchanged(self):
        self.assertEqual(apply_reels_media_type_filter(FakeQuery(), "all").calls, [])
        self.assertEqual(apply_reels_media_type_filter(FakeQuery(), "unexpected").calls, [])
        self.assertEqual(apply_reels_media_type_filter(FakeQuery(), None).calls, [])


if __name__ == "__main__":
    unittest.main()
