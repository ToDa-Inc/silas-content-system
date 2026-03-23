"""OpenRouter chat completions (Gemini) — ports analyzeRelevance from competitor-discovery.js."""

from __future__ import annotations

import json
import re

import httpx


def analyze_relevance(
    openrouter_key: str,
    prompt: str,
    model: str,
) -> dict:
    """Returns parsed JSON object from model response."""
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": 512,
        "temperature": 0.1,
    }
    with httpx.Client(timeout=120.0) as client:
        r = client.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {openrouter_key}",
                "Content-Type": "application/json",
                "HTTP-Referer": "https://silas-content-system.local",
                "X-Title": "Silas Content System",
            },
            json=payload,
        )
        r.raise_for_status()
        data = r.json()
    if data.get("error"):
        raise RuntimeError(data["error"].get("message", str(data["error"])))
    content = data["choices"][0]["message"]["content"]
    cleaned = re.sub(r"^```json\s*", "", content.strip())
    cleaned = re.sub(r"```\s*$", "", cleaned).strip()
    return json.loads(cleaned)
