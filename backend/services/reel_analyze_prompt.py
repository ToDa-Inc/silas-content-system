"""Silas single-reel analysis prompt — keep in sync with scripts/analyze-reel-by-url.js; bump PROMPT_VERSION on change."""

from __future__ import annotations

PROMPT_VERSION = "silas_v1_2026_03"

SILAS_REEL_ANALYSIS_TEMPLATE = """You are analyzing an Instagram Reel video for a content strategy system called Silas.

Watch the entire video carefully, including visual hooks, text overlays, pacing, and spoken content.

REEL INFO:
- Account: @{owner}
- Views: {views}
- Likes: {likes}
- Comments: {comments}
- Caption: {caption}

Score this reel on the 5 Silas criteria. Each score is 1–10.

---

1. INSTANT HOOK (0–2 seconds)
Does the reel capture attention within the first 2 seconds?
Look for: time-specific context ("Friday 5pm"), POV language ("your boss"), conflict words, visual surprise.
Score: X/10
Evidence: [what you saw in the first 2 seconds]

2. HIGH RELATABILITY
Does the viewer immediately think "that happened to me"?
Look for: universal workplace situation, concrete scenario (not abstract theory), emotional trigger.
Score: X/10
Evidence: [specific moment or phrase]

3. COGNITIVE TENSION
Does the reel create curiosity or disagreement?
Look for: wrong→right pattern, incomplete information (Zeigarnik), conflict or controversy.
Score: X/10
Evidence: [what creates the tension]

4. CLEAR VALUE
Does the viewer gain something tangible?
Look for: exact script or phrase to use, step-by-step framework, specific actionable insight.
Score: X/10
Evidence: [the value delivered]

5. COMMENT TRIGGER
Does the reel make the viewer want to comment or share?
Look for: direct question, controversial statement, "tag someone who...", strong validation.
Score: X/10
Evidence: [what triggers engagement]

---

TOTAL SCORE: X/50

RATING:
- 40–50 → Highly Replicable (blueprint found)
- 30–39 → Strong Pattern (adapt for niche)
- 20–29 → Moderate (analyze further)
- <20   → Weak (not a strong outlier)

---

CONTENT SUMMARY (2–3 sentences):
[What is this reel about and what makes it work or not work]

FORMAT:
- Type: [talking head / text overlay / skit / voiceover / other]
- Language: [language spoken/written]
- Duration feel: [snappy / medium / slow]
- Hook type: [POV / question / statement / visual / other]

REPLICABLE ELEMENTS:
- Hook pattern: [describe the hook structure]
- Value delivery: [how value is delivered]
- Format: [what format to replicate]

SUGGESTED ADAPTATION:
[One specific idea for how the creator could adapt this concept for their audience and niche]
"""


def build_reel_analysis_prompt(
    *,
    owner: str,
    views: str,
    likes: str,
    comments: str,
    caption: str,
) -> str:
    cap = (caption or "")[:500]
    return (
        SILAS_REEL_ANALYSIS_TEMPLATE.replace("{owner}", owner)
        .replace("{views}", views)
        .replace("{likes}", likes)
        .replace("{comments}", comments)
        .replace("{caption}", cap)
    )
