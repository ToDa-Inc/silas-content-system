"""Extract plain text from PDF / DOCX for client context uploads."""

from __future__ import annotations

import io
import re
from typing import Tuple

import pdfplumber
from docx import Document


def extract_text_from_upload(filename: str, data: bytes) -> Tuple[str, str]:
    """Return (mime_type, extracted_text). Raises ValueError on unsupported type or empty extraction."""
    lower = filename.lower()
    if lower.endswith(".pdf"):
        text = _pdf_text(data)
        if not text.strip():
            raise ValueError("No readable text found in this PDF (it may be scanned images only).")
        return "application/pdf", text.strip()
    if lower.endswith(".docx"):
        text = _docx_text(data)
        if not text.strip():
            raise ValueError("No readable text found in this document.")
        return (
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            text.strip(),
        )
    raise ValueError("Only .pdf and .docx files are supported.")


def _pdf_text(data: bytes) -> str:
    parts: list[str] = []
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        for page in pdf.pages:
            t = page.extract_text()
            if t:
                parts.append(t)
    return _collapse_ws("\n".join(parts))


def _docx_text(data: bytes) -> str:
    doc = Document(io.BytesIO(data))
    parts = [p.text for p in doc.paragraphs if p.text and p.text.strip()]
    return _collapse_ws("\n".join(parts))


def _collapse_ws(s: str) -> str:
    s = re.sub(r"[ \t]+", " ", s)
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip()
