# File: backend/python/rag_service.py
# Purpose: Indexes passages in ChromaDB and retrieves them using Ollama embeddings.

import argparse
import json
import re
import sys
from pathlib import Path
from urllib.error import URLError
from urllib.request import Request, urlopen


OLLAMA_URL = "http://localhost:11434"
EMBEDDING_MODEL = "nomic-embed-text"
ANSWER_MODEL = "llama3.2:3b"
RELEVANCE_DISTANCE_THRESHOLD = 0.60
RELATIVE_MARGIN = 0.10      # keep only passages close to the best match
MAX_CONTEXT_PASSAGES = 3    # fewer passages = shorter, more accurate answers
MAX_POINTS = 5              # maximum bullet points shown in an answer


def ollama_embedding(text: str) -> list[float]:
    request = Request(
        f"{OLLAMA_URL}/api/embed",
        data=json.dumps({"model": EMBEDDING_MODEL, "input": text}).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=120) as response:
            body = json.loads(response.read().decode("utf-8"))
    except URLError as error:
        raise RuntimeError("Ollama is unavailable. Start Ollama and install nomic-embed-text.") from error
    embeddings = body.get("embeddings")
    if not embeddings:
        raise RuntimeError(f"Ollama did not return an embedding for model {EMBEDDING_MODEL}.")
    return embeddings[0]


def get_collection(db_path: str):
    try:
        import chromadb
    except ImportError as error:
        raise RuntimeError("ChromaDB is missing. Install dependencies with: pip install -r backend/python/requirements.txt") from error
    client = chromadb.PersistentClient(path=db_path)
    return client.get_or_create_collection(
        name="document_passages",
        metadata={"hnsw:space": "cosine"},
    )


def index_document(db_path: str, payload: dict) -> dict:
    collection = get_collection(db_path)
    passages = payload["passages"]
    if not passages:
        raise RuntimeError("The document contains no extractable text.")
    embeddings = [ollama_embedding(passage["content"]) for passage in passages]
    ids = [f'{payload["document_id"]}:{passage["passage_id"]}' for passage in passages]
    metadatas = [
        {
            "document_id": payload["document_id"],
            "document_name": payload["document_name"],
            "passage_id": passage["passage_id"],
            "section": passage["section"],
            "section_number": passage.get("section_number") or (
                re.match(r"^(\d+(?:\.\d+)*)\b", passage["section"]).group(1)
                if re.match(r"^(\d+(?:\.\d+)*)\b", passage["section"])
                else "—"
            ),
            "heading": passage.get("heading", passage["section"]),
            "page": passage["page"],
        }
        for passage in passages
    ]
    collection.upsert(
        ids=ids,
        embeddings=embeddings,
        documents=[passage["content"] for passage in passages],
        metadatas=metadatas,
    )
    return {"indexed": len(ids)}


def search(db_path: str, payload: dict) -> dict:
    collection = get_collection(db_path)
    if collection.count() == 0:
        return {"results": []}
    result = collection.query(
        query_embeddings=[ollama_embedding(payload["question"])],
        n_results=min(max(int(payload.get("limit", 5)), 1), 20),
        include=["documents", "metadatas", "distances"],
    )
    results = []
    for content, metadata, distance in zip(
        result["documents"][0], result["metadatas"][0], result["distances"][0]
    ):
        results.append({"content": content, "metadata": metadata, "distance": distance})
    return {"results": results}


def request_answer(prompt: str, structured: bool) -> str:
    request_body = {
        "model": ANSWER_MODEL,
        "stream": False,
        "options": {"temperature": 0, "num_predict": 350},
        "messages": [
            {"role": "system", "content": "Answer strictly from document evidence."},
            {"role": "user", "content": prompt},
        ],
    }
    if structured:
        request_body["format"] = "json"
    request = Request(
        f"{OLLAMA_URL}/api/chat",
        data=json.dumps(request_body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=180) as response:
            body = json.loads(response.read().decode("utf-8"))
    except URLError as error:
        raise RuntimeError("Ollama answer generation failed. Check the local answer model.") from error
    content = body.get("message", {}).get("content", "")
    if not isinstance(content, str) or not content.strip():
        raise RuntimeError("Ollama returned an empty message.content response.")
    return content.strip()


def reference_label(metadata: dict) -> str:
    """Build a label like '4.3.2 Applications for leave exceeding five consecutive working days'."""
    number = (metadata.get("section_number") or "").strip()
    heading = (metadata.get("heading") or metadata.get("section") or "").strip()
    if not number or number == "—":
        return heading
    if heading.startswith(number):
        return heading  # heading already contains the number
    return f"{number} {heading}"


def build_references(results: list[dict]) -> list[dict]:
    references, seen = [], set()
    for result in results:
        meta = result["metadata"]
        key = (meta["document_id"], reference_label(meta), meta["page"])
        if key in seen:
            continue
        seen.add(key)
        references.append({
            "document_id": meta["document_id"],
            "document_name": meta["document_name"],
            "section_number": meta.get("section_number"),
            "heading": meta.get("heading") or meta.get("section"),
            "label": reference_label(meta),
            "page": meta["page"],
        })
    return references


def clean_text(value) -> str:
    """Trim a model-generated string and strip any bullet characters it added itself."""
    if not isinstance(value, str):
        return ""
    return re.sub(r"^\s*(?:[-*•]|\d+[.)])\s+", "", value.strip()).strip()


def clean_points(value) -> list[str]:
    if isinstance(value, str):
        value = [line for line in value.splitlines()]
    if not isinstance(value, list):
        return []
    points, seen = [], set()
    for item in value:
        text = clean_text(item)
        if text and text.lower() not in seen:
            seen.add(text.lower())
            points.append(text)
    return points[:MAX_POINTS]


def format_answer_text(summary: str, points: list[str], next_step: str) -> str:
    """Plain-text / markdown version of the structured answer (used as a fallback by the UI)."""
    parts = [summary]
    if points:
        parts.append("\n".join(f"- {point}" for point in points))
    if next_step:
        parts.append(f"Next step: {next_step}")
    return "\n\n".join(part for part in parts if part)


def ollama_answer(question: str, results: list[dict], history: list[dict]) -> dict:
    evidence = "\n\n".join(
        f'Section {reference_label(r["metadata"])} (page {r["metadata"]["page"]}):\n{r["content"]}'
        for r in results
    )
    conversation = "\n".join(
        f'{m.get("role", "user").title()}: {m.get("content", "")}'
        for m in history[-6:]
        if m.get("content")
    )
    prompt = (
        "You are a friendly HR policy assistant. Answer the question using ONLY the policy text below.\n"
        "Write in simple, plain English that anyone can understand. Use your own words, do not copy the policy.\n\n"
        "Return JSON with exactly these keys:\n"
        '- "summary": ONE or TWO short sentences that directly answer the question, with units (e.g. "working days").\n'
        '- "points": a list of 0 to 5 short bullet points (each under 25 words) covering only the rules, conditions, '
        "limits, deadlines or approvals that apply to this exact question. Use an empty list if the summary says it all. "
        "Do not add bullet characters or numbering inside the strings.\n"
        '- "next_step": one short sentence telling the user what to do next, or null if nothing is needed.\n'
        '- "status": "ANSWERED" or "PARTIALLY ANSWERED".\n'
        '- "missing_information": what the policy does not say, or null.\n'
        '- "offer_escalation": true if the policy does not clearly cover the request or needs an exception, otherwise false.\n\n'
        "Rules:\n"
        "- Do not list unrelated rules, repeat yourself, or mention 'evidence', 'passages' or section numbers.\n"
        "- Do not contradict yourself and do not guess.\n"
        "- If the policy does not clearly cover it, say so in the summary and set next_step to: "
        "'Would you like me to help draft an email to the Head of HR?'\n"
        "- Use the conversation only to understand follow-up references.\n\n"
        f"Conversation:\n{conversation or '(new conversation)'}\n\n"
        f"Question: {question}\n\nPolicy text:\n{evidence}"
    )

    summary, points, next_step = "", [], ""
    status, missing, escalate = "ANSWERED", None, False

    try:
        data = json.loads(request_answer(prompt, structured=True))
        if not isinstance(data, dict):
            raise json.JSONDecodeError("Expected an object", "", 0)
        summary = clean_text(data.get("summary") or data.get("answer"))
        points = clean_points(data.get("points"))
        next_step = clean_text(data.get("next_step"))
        status = data.get("status") if data.get("status") in {"ANSWERED", "PARTIALLY ANSWERED"} else "ANSWERED"
        missing = data.get("missing_information")
        escalate = bool(data.get("offer_escalation"))
    except (RuntimeError, json.JSONDecodeError):
        retry_prompt = (
            "Answer in simple, plain English using ONLY the policy text below. "
            "Start with one or two sentences that directly answer the question. "
            "If several rules or conditions apply, list them as short lines starting with '- '. "
            "Keep it under 120 words. "
            "If the policy does not cover it, say so and ask if the user wants help drafting an email to the Head of HR.\n\n"
            f"Question: {question}\n\nPolicy text:\n{evidence}"
        )
        try:
            text = request_answer(retry_prompt, structured=False)
        except RuntimeError as error:
            raise RuntimeError("The local answer model returned no usable answer after a retry.") from error
        lines = [line.strip() for line in text.splitlines() if line.strip()]
        bullet_lines = [line for line in lines if re.match(r"^(?:[-*•]|\d+[.)])\s+", line)]
        other_lines = [line for line in lines if line not in bullet_lines]
        summary = clean_text(" ".join(other_lines))
        points = clean_points(bullet_lines)
        status, escalate = "PARTIALLY ANSWERED", True

    if not summary and points:
        summary, points = points[0], points[1:]
    if not summary:
        raise RuntimeError("The local answer model returned an empty answer after a retry.")

    return {
        "answer": format_answer_text(summary, points, next_step),
        "summary": summary,
        "points": points,
        "next_step": next_step or None,
        "status": status,
        "missing_information": missing,
        "offer_escalation": escalate,
    }


def answer(db_path: str, payload: dict) -> dict:
    retrieval = search(db_path, {"question": payload["question"], "limit": 8})
    supported = [r for r in retrieval["results"] if r["distance"] <= RELEVANCE_DISTANCE_THRESHOLD]
    if not supported:
        return {
            "answer": "This question is not covered by the uploaded documents.",
            "summary": "This question is not covered by the uploaded documents.",
            "points": [],
            "next_step": "Would you like me to help draft an email to the Head of HR?",
            "status": "NOT COVERED",
            "missing_information": "No sufficiently relevant passage was retrieved.",
            "offer_escalation": True,
            "results": [],
            "references": [],
        }
    supported.sort(key=lambda r: r["distance"])
    best = supported[0]["distance"]
    supported = [r for r in supported if r["distance"] <= best + RELATIVE_MARGIN][:MAX_CONTEXT_PASSAGES]

    history = payload.get("history", [])
    if not isinstance(history, list):
        history = []
    generated = ollama_answer(payload["question"], supported, history)
    return {**generated, "results": supported, "references": build_references(supported)}


def delete_document(db_path: str, payload: dict) -> dict:
    collection = get_collection(db_path)
    collection.delete(where={"document_id": payload["document_id"]})
    return {"deleted": payload["document_id"]}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["index", "search", "answer", "delete"])
    parser.add_argument("--db-path", required=True)
    parser.add_argument("--payload", required=True)
    arguments = parser.parse_args()
    payload = json.loads(arguments.payload)
    handlers = {"index": index_document, "search": search, "answer": answer, "delete": delete_document}
    result = handlers[arguments.command](arguments.db_path, payload)
    print(json.dumps(result), flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)