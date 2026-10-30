"# Document Intelligence Assistant

Phase 1 establishes the runnable web application foundation for a document-grounded AI assistant. It includes responsive navigation for Documents, Ask AI, Batch Questions, and Settings, plus empty states for the upcoming workflows.

## Technology stack

- Node.js and Express.js backend
- HTML5, CSS3, and vanilla JavaScript frontend
- Fetch API for browser-to-backend communication

The document processing, Ollama, ChromaDB, and question-answering workflows are intentionally reserved for later phases.

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

## Phase 1 verification

- Visit the application and use each sidebar item to switch views.
- Confirm the root URL redirects to the Documents tab.
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

## Known limitations

Phase 1 uses intentionally empty application data. Upload processing, PDF/TXT/Markdown extraction, Ollama, ChromaDB, citations, version handling, and batch execution will be implemented in later phases.

## Next phase

Phase 2 will add validated PDF, TXT, and Markdown uploads, Python-based extraction, passage metadata, processing status, and document management."
