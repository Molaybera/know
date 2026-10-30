// File: backend/server.js
// Purpose: Serves the frontend and wires document upload and management APIs.

const express = require("express");
const fs = require("fs");
const path = require("path");
const { upload, handleUpload, handleUrl } = require("./services/upload.service");
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

app.post("/api/documents/url", async (request, response) => {
  try {
    const rawUrl = typeof request.body?.url === "string" ? request.body.url.trim() : "";
    if (!rawUrl) {
      return response.status(400).json({ error: "Please enter a valid webpage URL." });
    }
    let parsed;
    try {
      parsed = new URL(rawUrl);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        throw new Error();
      }
    } catch {
      return response.status(400).json({ error: "Please enter a valid URL starting with http:// or https://" });
    }

    await documentService.ensureStorage();
    const document = await handleUrl(rawUrl);
    return response.status(202).json({ document });
  } catch (error) {
    console.error("Could not process webpage URL:", error);
    return response.status(500).json({ error: "Could not start webpage processing." });
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

app.get("/api/documents/:documentId", async (request, response) => {
  try {
    const document = await documentService.getDocument(request.params.documentId);
    if (!document) return response.status(404).json({ error: "Document not found." });
    return response.json({ document });
  } catch (error) {
    console.error("Could not fetch document:", error);
    return response.status(500).json({ error: "Could not fetch document." });
  }
});

app.get("/api/documents/:documentId/file", async (request, response) => {
  try {
    const document = await documentService.getDocument(request.params.documentId);
    if (!document || document.file_type !== "pdf") {
      return response.status(404).json({ error: "PDF document not found." });
    }
    await fs.promises.access(document.file_path, fs.constants.R_OK);
    return response.sendFile(path.resolve(document.file_path), {
      headers: { "Content-Type": "application/pdf" },
    });
  } catch (error) {
    console.error("Could not open document PDF:", error);
    return response.status(404).json({ error: "PDF document is unavailable." });
  }
});

app.post("/api/query", async (request, response) => {
  try {
    const question = typeof request.body.question === "string" ? request.body.question.trim() : "";
    if (!question) return response.status(400).json({ error: "Enter a question." });
    const history = Array.isArray(request.body.history)
      ? request.body.history
        .filter((message) => message && ["user", "assistant"].includes(message.role) && typeof message.content === "string")
        .slice(-8)
      : [];
    const result = await ragService.answer(question, history);

    const citations = await Promise.all(result.results.map(async (source) => {
      const sectionText = source.metadata.section || source.content || "";
      const sectionNumber = source.metadata.section_number && source.metadata.section_number !== "—"
        ? source.metadata.section_number
        : sectionText.match(/^\d+(?:\.\d+)*/)?.[0] || "";
      const rawHeading = source.metadata.heading || source.metadata.section || "";
      const heading = rawHeading.replace(
        new RegExp(`^${sectionNumber.replace(/\./g, "\\.")}\\s*`),
        "",
      ).trim();

      let fileType = source.metadata.file_type || "";
      let url = source.metadata.url || "";
      if (!fileType || !url) {
        try {
          const doc = await documentService.getDocument(source.metadata.document_id);
          if (doc) {
            fileType = fileType || doc.file_type || "";
            url = url || doc.url || "";
          }
        } catch {
          // Ignore lookup failure
        }
      }

      return {
        document_id: source.metadata.document_id,
        document_name: source.metadata.document_name,
        page: source.metadata.page,
        section_number: sectionNumber,
        heading,
        file_type: fileType,
        url,
      };
    }));

    return response.json({
      answer: result.answer,
      status: result.status,
      missing_information: result.missing_information,
      citations,
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
