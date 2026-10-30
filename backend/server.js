// File: backend/server.js
// Purpose: Serves the frontend and wires document upload and management APIs.

const express = require("express");
const path = require("path");
const { upload, handleUpload } = require("./services/upload.service");
const documentService = require("./services/document.service");
const ragService = require("./services/rag.service");

const app = express();
const port = Number(process.env.PORT) || 3000;
const frontendDirectory = path.join(__dirname, "..", "frontend");

app.use(express.json());
app.use(express.static(frontendDirectory));
documentService.ensureStorage().catch((error) => {
  console.error("Could not initialize document storage:", error);
});
documentService.listDocuments().then((documents) => {
  const processedDocuments = documents.filter((document) => document.status === "processed" && document.passages?.length);
  return Promise.all(processedDocuments.map((document) => ragService.indexDocument(document)));
}).catch((error) => {
  console.error("Could not reindex existing documents:", error.message);
});

app.get("/api/health", (_request, response) => {
  response.json({
    status: "ok",
    service: "document-intelligence-assistant",
    phase: 3,
  });
});

app.get("/api/documents", async (_request, response) => {
  try {
    response.json({ documents: await documentService.listDocuments() });
  } catch (error) {
    console.error("Could not list documents:", error);
    response.status(500).json({ error: "Could not load documents." });
  }
});

app.post("/api/documents/upload", (request, response, next) => {
  documentService.ensureStorage()
    .then(() => upload.array("documents", 10)(request, response, next))
    .catch(next);
}, async (request, response) => {
  try {
    if (!request.files || request.files.length === 0) {
      return response.status(400).json({ error: "Choose at least one PDF, TXT, or Markdown file." });
    }

    const documents = await Promise.all(request.files.map((file) => handleUpload(file)));
    return response.status(202).json({ documents });
  } catch (error) {
    console.error("Could not start document processing:", error);
    return response.status(500).json({ error: "Could not start document processing." });
  }
});

app.delete("/api/documents/:documentId", async (request, response) => {
  try {
    const document = await documentService.getDocument(request.params.documentId);
    if (!document) return response.status(404).json({ error: "Document not found." });
    await ragService.deleteDocument(request.params.documentId);
    const deleted = await documentService.deleteDocument(request.params.documentId);
    if (!deleted) return response.status(404).json({ error: "Document not found." });
    return response.status(204).end();
  } catch (error) {
    console.error("Could not delete document:", error);
    return response.status(500).json({ error: "Could not delete document." });
  }
});

app.post("/api/query", async (request, response) => {
  try {
    const question = typeof request.body.question === "string" ? request.body.question.trim() : "";
    if (!question) return response.status(400).json({ error: "Enter a question." });
    const result = await ragService.answer(question);
    return response.json({
      answer: result.answer,
      status: result.status,
      missing_information: result.missing_information,
      citations: result.results.map((source) => ({ ...source.metadata, passage: source.content })),
      retrieval: { count: result.results.length, distances: result.results.map((source) => source.distance) },
    });
  } catch (error) {
    console.error("Could not retrieve document passages:", error);
    return response.status(503).json({ error: error.message });
  }
});

app.use((error, _request, response, _next) => {
  if (error.type === "entity.parse.failed") {
    return response.status(400).json({ error: "Request body must contain valid JSON." });
  }
  if (error instanceof require("multer").MulterError || error.message?.includes("Only PDF")) {
    return response.status(400).json({ error: error.message });
  }
  console.error("Unhandled server error:", error);
  return response.status(500).json({ error: "Unexpected server error." });
});

app.get("/", (_request, response) => {
  response.redirect("/pages/ask.html");
});

app.get("*", (_request, response) => {
  response.sendFile(path.join(frontendDirectory, "pages", "ask.html"));
});

app.listen(port, () => {
  console.log(`Document Intelligence Assistant listening on http://localhost:${port}`);
});
