# File: backend/python/url_processor.py
# Purpose: Extracts text from web pages / URLs and chunks into searchable passages.

import json
import re
import sys
import urllib.request
import urllib.error
from pathlib import Path
from html.parser import HTMLParser

try:
    from bs4 import BeautifulSoup  # type: ignore
    HAS_BS4 = True
except ImportError:
    BeautifulSoup = None  # type: ignore
    HAS_BS4 = False


class BuiltinHTMLCleaner(HTMLParser):
    def __init__(self):
        super().__init__()
        self.title = ""
        self.in_title = False
        self.ignored_depth = 0
        self.ignore_tags = {"script", "style", "nav", "footer", "header", "aside", "noscript", "svg", "form"}
        self.text_parts = []

    def handle_starttag(self, tag, attrs):
        tag_lower = tag.lower()
        if tag_lower in self.ignore_tags:
            self.ignored_depth += 1
            return
        if self.ignored_depth > 0:
            return
        if tag_lower == "title":
            self.in_title = True
        elif tag_lower in {"h1", "h2", "h3", "h4", "h5", "h6"}:
            self.text_parts.append("\n\n### ")
        elif tag_lower in {"p", "div", "li", "tr"}:
            self.text_parts.append("\n")

    def handle_endtag(self, tag):
        tag_lower = tag.lower()
        if tag_lower in self.ignore_tags:
            if self.ignored_depth > 0:
                self.ignored_depth -= 1
            return
        if self.ignored_depth > 0:
            return
        if tag_lower == "title":
            self.in_title = False
        elif tag_lower in {"h1", "h2", "h3", "h4", "h5", "h6"}:
            self.text_parts.append("\n\n")
        elif tag_lower in {"p", "div", "li", "tr"}:
            self.text_parts.append("\n")

    def handle_data(self, data):
        if self.ignored_depth > 0:
            return
        if self.in_title:
            self.title += data.strip()
        else:
            cleaned = data.strip()
            if cleaned:
                self.text_parts.append(cleaned + " ")

    def get_clean_text(self) -> tuple[str, str]:
        raw_text = "".join(self.text_parts)
        cleaned = re.sub(r"[ \t]+", " ", raw_text)
        cleaned = re.sub(r"\n{3,}", "\n\n", cleaned).strip()
        title = self.title.strip() if self.title else "Webpage Document"
        return title, cleaned


def clean_html_content(html: str) -> tuple[str, str]:
    if HAS_BS4 and BeautifulSoup is not None:
        try:
            soup = BeautifulSoup(html, "html.parser")
            title = soup.title.string.strip() if soup.title and soup.title.string else "Webpage Document"
            for tag in soup(["script", "style", "nav", "footer", "header", "aside", "noscript", "svg", "form"]):
                tag.decompose()
            main_container = soup.find("article") or soup.find("main") or soup.body or soup
            for heading in main_container.find_all(["h1", "h2", "h3", "h4", "h5", "h6"]):
                heading.insert_before("\n\n### ")
                heading.insert_after("\n\n")
            for paragraph in main_container.find_all(["p", "li"]):
                paragraph.insert_before("\n")
                paragraph.insert_after("\n")
            text = main_container.get_text(separator=" ", strip=True)
            text = re.sub(r"\n{3,}", "\n\n", text)
            return title, text
        except Exception:
            pass

    # Standard library fallback (zero dependencies required)
    parser = BuiltinHTMLCleaner()
    parser.feed(html)
    return parser.get_clean_text()


def build_passages(text: str, default_title: str) -> list[dict]:
    passages = []
    current_section = default_title
    chunks = [chunk.strip() for chunk in re.split(r"\n\s*\n", text) if chunk.strip()]

    # If single huge blob or too few chunks, split by sentence/length
    processed_chunks = []
    for chunk in chunks:
        if len(chunk) > 1200:
            sentences = re.split(r"(?<=[.?!])\s+", chunk)
            buf = ""
            for s in sentences:
                if len(buf) + len(s) > 800:
                    if buf:
                        processed_chunks.append(buf.strip())
                    buf = s
                else:
                    buf = f"{buf} {s}".strip()
            if buf:
                processed_chunks.append(buf.strip())
        else:
            processed_chunks.append(chunk)

    for index, chunk in enumerate(processed_chunks, start=1):
        if chunk.startswith("### "):
            current_section = chunk.replace("### ", "").strip()
            continue

        heading_match = re.match(r"^([A-Z][A-Za-z0-9 &/()-]{2,80})$", chunk)
        if heading_match and chunk.count("\n") == 0 and len(chunk) < 100:
            current_section = chunk.strip()
            continue

        section_match = re.match(r"^(\d+(?:\.\d+)*)\b", current_section)
        passages.append({
            "passage_id": f"P{index:04d}",
            "section": current_section,
            "section_number": section_match.group(1) if section_match else "—",
            "heading": current_section,
            "page": 1,
            "content": chunk,
        })
    return passages


BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
}


def fetch_url(url: str) -> str:
    # 1. Primary method: requests with full session, cookies, redirect support
    try:
        import requests  # type: ignore
        import urllib3  # type: ignore
        urllib3.disable_warnings()

        session = requests.Session()
        session.headers.update(BROWSER_HEADERS)
        response = session.get(url, timeout=25, verify=False, allow_redirects=True)
        if response.text and (response.status_code == 200 or len(response.text) > 1000):
            return response.text
    except Exception:
        pass

    # 2. Fallback: urllib.request with standard browser headers
    import ssl
    req = urllib.request.Request(url, headers=BROWSER_HEADERS)
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

    with urllib.request.urlopen(req, context=ctx, timeout=25) as response:
        charset = response.headers.get_content_charset() or "utf-8"
        raw_html = response.read().decode(charset, errors="replace")
        return raw_html


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("Usage: url_processor.py <URL_OR_FILE> <OUTPUT_PATH>")

    target = sys.argv[1]
    output_path = Path(sys.argv[2])

    # Check if target is a URL or a file containing the URL
    if target.startswith("http://") or target.startswith("https://"):
        url = target
    else:
        url = Path(target).read_text(encoding="utf-8").strip()

    try:
        html = fetch_url(url)
        title, clean_text = clean_html_content(html)
        passages = build_passages(clean_text, title)

        if not passages:
            passages = [{
                "passage_id": "P0001",
                "section": title,
                "section_number": "1",
                "heading": title,
                "page": 1,
                "content": clean_text[:1000] if clean_text else "No textual content could be extracted from this webpage.",
            }]

        result = {
            "title": title,
            "url": url,
            "page_count": 1,
            "passages": passages,
        }
        output_path.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
    except Exception as exc:
        sys.stderr.write(f"Scraping failed: {exc}\n")
        sys.exit(1)


if __name__ == "__main__":
    main()
