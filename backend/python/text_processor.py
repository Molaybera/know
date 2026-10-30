# File: backend/python/text_processor.py
# Purpose: Extracts TXT and Markdown content into searchable, numbered passages.

import json
import re
import sys
from pathlib import Path


def build_passages(text: str) -> list[dict]:
    passages = []
    current_section = "General"
    chunks = [chunk.strip() for chunk in re.split(r"\n\s*\n", text) if chunk.strip()]
    for index, chunk in enumerate(chunks, start=1):
        heading = re.match(r"^(?:#{1,6}\s+|([A-Z][A-Za-z0-9 &/()-]{2,80})\s*$)", chunk)
        if heading and chunk.count("\n") == 0 and len(chunk) < 120:
            current_section = chunk.lstrip("# ").strip()
        passages.append({
            "passage_id": f"P{index:04d}",
            "section": current_section,
            "page": 1,
            "content": chunk,
        })
    return passages


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("Usage: text_processor.py INPUT_PATH OUTPUT_PATH")
    input_path, output_path = map(Path, sys.argv[1:])
    text = input_path.read_text(encoding="utf-8-sig")
    result = {"page_count": 1, "passages": build_passages(text)}
    Path(output_path).write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    main()
