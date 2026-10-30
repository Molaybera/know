# File: backend/python/pdf_processor.py
# Purpose: Extracts PDF text page by page while preserving page numbers and headings.

import json
import re
import sys
from collections import Counter
from pathlib import Path

MAX_CHUNK_CHARS = 1200

# "4.3.2 Applications for leave", "4.3.2. Applications for leave", "7 Leave approval"
NUMBERED_HEADING = re.compile(r"^(\d+(?:\.\d+)*)\.?\s+(\S.*)$")
# A heading number sitting alone on its own line, e.g. "4.3.2" (title is on the next line)
NUMBER_ONLY = re.compile(r"^(\d+(?:\.\d+)*)\.?$")
SMALL_WORDS = {
    "a", "an", "and", "or", "of", "the", "to", "for", "in", "on", "at", "by",
    "with", "from", "as", "is", "vs", "per", "&", "&amp;",
}


def is_title_case(text: str) -> bool:
    """True for 'Non-Reimbursable Expenses' or 'LEAVE POLICY'; False for a wrapped sentence."""
    words = re.findall(r"[A-Za-z][A-Za-z'&/-]*", text)
    significant = [word for word in words if word.lower() not in SMALL_WORDS]
    if not significant:
        return False
    capitalised = sum(1 for word in significant if word[0].isupper())
    return capitalised / len(significant) >= 0.8


def looks_like_title(text: str, dotted: bool) -> bool:
    """Decide (without font information) whether text after a number is a heading."""
    text = text.strip()
    if not text or len(text) > 120:
        return False
    if dotted:
        # 4.3.2-style numbers are almost always real headings, even in sentence case
        return not text.endswith(".") or len(text.split()) <= 10
    # Single-level numbers (1, 2, 7) are also used for list items and wrapped sentences,
    # so only accept short Title Case / UPPER CASE text with no sentence punctuation.
    return (
        len(text.split()) <= 8
        and not text.endswith((".", ",", ";", ":"))
        and is_title_case(text)
    )


def normalise_pages(page_text: list) -> list[list[dict]]:
    """Accept plain strings or lists of {'text','bold','size'} line dictionaries."""
    pages = []
    for page in page_text:
        if isinstance(page, str):
            lines = [
                {"text": line.strip(), "bold": False, "size": 0.0}
                for line in page.splitlines()
                if line.strip()
            ]
        else:
            lines = [line for line in page if line["text"].strip()]
        pages.append(lines)
    return pages


def detect_style_mode(pages: list[list[dict]]) -> tuple[bool, float]:
    """Use font styling when it separates numbered headings from numbered clauses."""
    sizes = Counter()
    for lines in pages:
        for line in lines:
            if line["size"]:
                sizes[round(line["size"], 1)] += len(line["text"])
    body_size = sizes.most_common(1)[0][0] if sizes else 0.0

    def styled(line):
        return line["bold"] or (body_size and line["size"] >= body_size * 1.15)

    candidates = [
        line
        for lines in pages
        for line in lines
        if NUMBERED_HEADING.match(line["text"]) or NUMBER_ONLY.match(line["text"])
    ]
    styled_count = sum(1 for line in candidates if styled(line))
    use_style = bool(candidates) and 0 < styled_count < len(candidates)
    return use_style, body_size


def detect_heading(lines: list[dict], index: int, use_style: bool, body_size: float):
    """Return (number, title, lines_consumed) if lines[index] starts a heading, else None."""

    def styled(line):
        return line["bold"] or (body_size and line["size"] >= body_size * 1.15)

    line = lines[index]
    text = line["text"].strip()

    match = NUMBERED_HEADING.match(text)
    if match:
        number, title = match.group(1), match.group(2).strip()
        if len(title) <= 120:
            ok = styled(line) if use_style else looks_like_title(title, "." in number)
            if ok:
                return number, title, 1

    match = NUMBER_ONLY.match(text)
    if match and index + 1 < len(lines):
        number = match.group(1)
        next_line = lines[index + 1]
        title = next_line["text"].strip()
        if len(title) <= 120:
            ok = (
                (styled(line) or styled(next_line))
                if use_style
                else looks_like_title(title, "." in number)
            )
            if ok:
                return number, title, 2

    if text.startswith("#"):
        title = text.lstrip("# ").strip()
        if title:
            return "", title, 1
    return None


def build_passages(page_text: list) -> list[dict]:
    pages = normalise_pages(page_text)
    use_style, body_size = detect_style_mode(pages)

    # 1) Walk every line, tracking the current section across paragraphs and pages.
    sections = []
    current = {"number": "—", "title": "General", "page": 1, "lines": []}
    for page_number, lines in enumerate(pages, start=1):
        index = 0
        while index < len(lines):
            heading = detect_heading(lines, index, use_style, body_size)
            if heading:
                number, title, consumed = heading
                if current["lines"]:
                    sections.append(current)
                current = {"number": number or "—", "title": title, "page": page_number, "lines": []}
                index += consumed
                continue
            current["lines"].append((page_number, lines[index]["text"].strip()))
            index += 1
    if current["lines"]:
        sections.append(current)

    # 2) Turn each section into one or more passages, always carrying the section heading.
    passages = []
    passage_number = 1
    for section in sections:
        number, title = section["number"], section["title"]
        label = f"{number} {title}" if number != "—" else title
        chunk_lines, chunk_page, chunk_length = [], section["page"], 0

        def flush():
            nonlocal chunk_lines, chunk_length, passage_number
            if not chunk_lines:
                return
            passages.append({
                "passage_id": f"P{passage_number:04d}",
                "section": label,
                "section_number": number,
                "heading": title,
                "page": chunk_page,
                "content": f"{label}\n" + " ".join(chunk_lines),
            })
            passage_number += 1
            chunk_lines, chunk_length = [], 0

        for page_number, line in section["lines"]:
            if not chunk_lines:
                chunk_page = page_number
            chunk_lines.append(line)
            chunk_length += len(line) + 1
            if chunk_length >= MAX_CHUNK_CHARS:
                flush()
        flush()
    return passages


def extract_page_lines(page) -> list[dict]:
    """Read lines with font information so bold/larger headings can be told apart from clauses."""
    lines = []
    for block in page.get_text("dict").get("blocks", []):
        if block.get("type") != 0:
            continue
        for line in block.get("lines", []):
            spans = line.get("spans", [])
            text = "".join(span["text"] for span in spans).strip()
            if not text:
                continue
            total = sum(len(span["text"]) for span in spans) or 1
            bold = sum(
                len(span["text"])
                for span in spans
                if (span["flags"] & 16) or "bold" in span["font"].lower()
            )
            lines.append({
                "text": text,
                "bold": bold / total >= 0.6,
                "size": max(span["size"] for span in spans),
            })
    return lines


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("Usage: pdf_processor.py INPUT_PATH OUTPUT_PATH")
    try:
        import pymupdf as fitz  # type: ignore
    except ImportError:
        try:
            import fitz  # type: ignore
        except ImportError as error:
            raise SystemExit("PyMuPDF is required for PDF processing. Install it with: pip install PyMuPDF") from error
    
    input_path, output_path = map(Path, sys.argv[1:])
    document = fitz.open(input_path)
    pages = [extract_page_lines(page) for page in document]
    result = {"page_count": len(pages), "passages": build_passages(pages)}
    Path(output_path).write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
    document.close()


if __name__ == "__main__":
    main()