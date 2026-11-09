from services.post_reel_linking import best_auto_links, caption_similarity

GENERATED = (
    "Du hast die perfekten Argumente im Kopf. Du weißt genau, was du sagen willst. "
    "Und doch: Sobald das Meeting startet, fühlst du dich wie ein kleines Kind, das sich rechtfertigen muss. "
    "Das Problem ist meist nicht dein Wortschatz. Es ist der Versuch, eine toxische Dynamik mit Logik zu lösen. "
    "Schreib „WEBINAR“ in die Kommentare und ich sende dir den Link. #grenzensetzen #kommunikation"
)
# Pasted into Instagram with different emojis / hashtags and one sentence trimmed.
PUBLISHED = (
    "Du hast die perfekten Argumente im Kopf 🧠 Du weißt genau, was du sagen willst. "
    "Und doch: Sobald das Meeting startet, fühlst du dich wie ein kleines Kind, das sich rechtfertigen muss. "
    "Das Problem ist meist nicht dein Wortschatz – es ist der Versuch, eine toxische Dynamik mit Logik zu lösen. "
    "Schreib WEBINAR in die Kommentare 👇 #souveränität"
)
# Real false-positive pattern from Conny's data: same stock phrases, different post.
UNRELATED = (
    "Hier ist der Grund ⬇️ „Nenn mir ein einziges Beispiel.“ Und Dein Kopf ist leer. Komplett leer. "
    "Obwohl Du genau weißt, dass es hundert gab. Dass Du gerade nichts abrufen kannst, ist eine gut "
    "dokumentierte Stressreaktion. Schreib „GUIDE“ in die Kommentare."
)


def _s(sid, created, caption=GENERATED):
    return {"id": sid, "created_at": created, "caption_body": caption}


def _r(rid, posted, caption=PUBLISHED):
    return {"id": rid, "posted_at": posted, "caption": caption}


def test_pasted_caption_with_small_edits_scores_high():
    assert caption_similarity(GENERATED, PUBLISHED) >= 0.8


def test_stock_phrase_overlap_scores_low():
    assert caption_similarity(GENERATED, UNRELATED) < 0.5


def test_short_captions_never_auto_link():
    assert caption_similarity("Kennst du das?", "Kennst du das?") == 0.0


def test_links_reel_published_after_post():
    links = best_auto_links(
        [_s("gsn_1", "2026-11-01T10:00:00+00:00")],
        [_r("srl_a", "2026-11-03T08:00:00+00:00"), _r("srl_b", "2026-11-04T08:00:00+00:00", UNRELATED)],
    )
    assert [(l["session_id"], l["reel_id"]) for l in links] == [("gsn_1", "srl_a")]


def test_ignores_reels_posted_before_post_or_too_late():
    sessions = [_s("gsn_1", "2026-11-01T10:00:00+00:00")]
    assert best_auto_links(sessions, [_r("srl_a", "2026-10-30T08:00:00+00:00")]) == []
    assert best_auto_links(sessions, [_r("srl_a", "2026-12-15T08:00:00+00:00")]) == []


def test_one_reel_per_post_and_one_post_per_reel():
    links = best_auto_links(
        [_s("gsn_1", "2026-11-01T10:00:00+00:00"), _s("gsn_2", "2026-11-01T11:00:00+00:00")],
        [_r("srl_a", "2026-11-03T08:00:00+00:00")],
    )
    assert len(links) == 1
