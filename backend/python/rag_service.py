# File: backend/python/rag_service.py
# Purpose: Indexes passages in ChromaDB and retrieves them using Ollama embeddings.

import argparse
import json
import sys
from pathlib import Path
from urllib.error import URLError
from urllib.request import Request, urlopen


OLLAMA_URL = "http://localhost:11434"
EMBEDDING_MODEL = "nomic-embed-text"
ANSWER_MODEL = "llama3.2:3b"
RELEVANCE_DISTANCE_THRESHOLD = 0.60


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
        "options": {"temperature": 0, "num_predict": 256},
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


def ollama_answer(question: str, results: list[dict]) -> dict:
    evidence = "\n\n".join(
        f'[{result["metadata"]["passage_id"]}] {result["metadata"]["document_name"]}, '
        f'page {result["metadata"]["page"]}, section {result["metadata"]["section"]}\n'
        f'{result["content"]}'
        for result in results
    )
    prompt = (
        "You are a document-grounded assistant. Answer only from the supplied evidence. "
        "Do not use outside knowledge or invent facts. If the evidence is incomplete, say what is missing. "
        'Return JSON with exactly these keys: "answer", "status", "missing_information". '
        'The status must be "ANSWERED" or "PARTIALLY ANSWERED".\n\n'
        f"Question: {question}\n\nEvidence:\n{evidence}"
    )
    try:
        answer = json.loads(request_answer(prompt, structured=True))
    except (RuntimeError, json.JSONDecodeError):
        retry_prompt = (
            "Answer the question in one concise paragraph using only the evidence below. "
            "Do not return an empty response or use outside knowledge.\n\n"
            f"Question: {question}\n\nEvidence:\n{evidence}"
        )
        try:
            answer = {"answer": request_answer(retry_prompt, structured=False), "status": "PARTIALLY ANSWERED"}
        except RuntimeError as error:
            raise RuntimeError(
                "The local answer model returned no usable answer after a retry."
            ) from error
    if not isinstance(answer.get("answer"), str) or not answer["answer"].strip():
        raise RuntimeError("The local answer model returned an empty answer after a retry.")
    return {
        "answer": answer["answer"],
        "status": answer.get("status") if answer.get("status") in {"ANSWERED", "PARTIALLY ANSWERED"} else "PARTIALLY ANSWERED",
        "missing_information": answer.get("missing_information"),
    }


def answer(db_path: str, payload: dict) -> dict:
    retrieval = search(db_path, {"question": payload["question"], "limit": 5})
    supported = [
        result
        for result in retrieval["results"]
        if result["distance"] <= RELEVANCE_DISTANCE_THRESHOLD
    ]
    if not supported:
        return {
            "answer": "This question is not covered by the uploaded documents.",
            "status": "NOT COVERED",
            "missing_information": "No sufficiently relevant passage was retrieved.",
            "results": [],
        }
    generated = ollama_answer(payload["question"], supported)
    return {**generated, "results": supported}


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
