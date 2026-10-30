"# Document Intelligence Assistant

Phase 3 adds local vector retrieval to the document-grounded assistant. Documents are extracted into passages, embedded with Ollama, stored in ChromaDB, and searched through the Ask AI tab.

## Technology stack

- Node.js and Express.js backend
- HTML5, CSS3, and vanilla JavaScript frontend
- Fetch API for browser-to-backend communication

The document processing, Ollama, ChromaDB, and question-answering workflows are implemented in the current local-first phase.

## Prerequisites

- Node.js 18 or newer
- npm

## Run locally

```powershell
cd backend
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000) in a browser.

For development with automatic restarts:

```powershell
npm run dev
```

## Phase 2 verification

- Visit the application and open the Documents tab.
- Upload PDF, TXT, or Markdown files and observe processing and indexing status.
- Confirm processed documents show passage and page counts.
- Ask a question from the Ask AI tab and inspect retrieved citations.
- Delete a document and confirm it is removed from the library.
- Confirm the API responds from `GET /api/health`.
- Resize the browser to verify the responsive sidebar and four-tab layout.

## Project structure

```text
backend/
  server.js
  package.json
frontend/
  pages/
    documents.html
    ask.html
    batch.html
    settings.html
  css/
    style.css
    documents.css
    chat.css
    responsive.css
  js/
    app.js
    navigation.js
    upload.js
    chat.js
    batch.js
    settings.js
```

## Phase 3 setup

- Install Python dependencies:

```powershell
pip install -r backend/python/requirements.txt
```

- Start Ollama and install the embedding model:

```powershell
ollama pull nomic-embed-text
```

- The backend uses Ollama at `http://localhost:11434` and persists ChromaDB data under `backend/data/vector_db`.

## Known limitations

This phase uses `nomic-embed-text` for embeddings and `llama3.2:3b` for strict evidence-only answer generation. Retrieval accepts cosine distances up to `0.60`; lower distances are more relevant. Uploads and queries fail explicitly if Ollama, either local model, or ChromaDB is unavailable.

Ask AI stores multiple conversations in browser `localStorage`. The History navigation tab lists saved conversations, and each one can be reopened in Ask AI. New chat starts a separate conversation. Chats are restored on the same browser/device and recent turns are sent to the local model as follow-up context. Chat history is device-local and is not shared across browsers or devices.

## Phase 2 implementation

- `POST /api/documents/upload` accepts up to 10 PDF, TXT, or Markdown files, with a 25 MB per-file limit.
- `GET /api/documents` returns document metadata and processing status.
- `DELETE /api/documents/:documentId` removes the source file and metadata.
- TXT and Markdown extraction runs through `backend/python/text_processor.py`.
- PDF extraction runs through `backend/python/pdf_processor.py` and requires PyMuPDF.
- Extracted passage metadata includes passage ID, page, heading, section number, and content.

## Next phase

Grounded answers are generated as concise explanations, with a structured reference list showing the document name, page, and heading."
Reference document names open a new PDF viewer tab at the cited page, where matching extracted text is highlighted."
