# File: backend/python/pdf_processor.py
# Purpose: Extracts PDF text page by page while preserving page numbers and headings.

import json
import re
import sys
from pathlib import Path


def build_passages(page_text: list[str]) -> list[dict]:
    passages = []
    passage_number = 1
    for page_number, text in enumerate(page_text, start=1):
        chunks = [chunk.strip() for chunk in re.split(r"\n\s*\n", text) if chunk.strip()]
        for chunk in chunks:
            heading = "General"
            first_line = chunk.splitlines()[0].strip()
            if len(first_line) <= 120 and (first_line.startswith("#") or (len(first_line.split()) <= 12 and not first_line.endswith("."))):
                heading = first_line.lstrip("# ").strip()
            passages.append({
                "passage_id": f"P{passage_number:04d}",
                "section": heading,
                "page": page_number,
                "content": chunk,
            })
            passage_number += 1
    return passages


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("Usage: pdf_processor.py INPUT_PATH OUTPUT_PATH")
    try:
        import fitz
    except ImportError as error:
        raise SystemExit("PyMuPDF is required for PDF processing. Install it with: pip install PyMuPDF") from error
    input_path, output_path = map(Path, sys.argv[1:])
    document = fitz.open(input_path)
    pages = [page.get_text("text") for page in document]
    result = {"page_count": len(pages), "passages": build_passages(pages)}
    Path(output_path).write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
    document.close()


if __name__ == "__main__":
    main()
