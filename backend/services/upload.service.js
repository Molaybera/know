// File: backend/services/upload.service.js
// Purpose: Validates uploads, starts extraction, and records processing status.

const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const { spawn } = require("child_process");
const multer = require("multer");
const documentService = require("./document.service");
const ragService = require("./rag.service");

const allowedExtensions = new Set([".pdf", ".txt", ".md"]);
const maxFileSize = 25 * 1024 * 1024;
const upload = multer({
  dest: documentService.uploadDirectory,
  limits: { fileSize: maxFileSize, files: 10 },
  fileFilter: (_request, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    if (!allowedExtensions.has(extension)) {
      return callback(new Error("Only PDF, TXT, and Markdown files are supported."));
    }
    return callback(null, true);
  },
});

function pythonCommand() {
  return process.platform === "win32" ? "python" : "python3";
}

function runProcessor(file, outputPath) {
  let scriptName = "text_processor.py";
  let targetArg = file.path;
  if (file.file_type === "url" || file.is_url) {
    scriptName = "url_processor.py";
    targetArg = file.url || file.path;
  } else {
    const extension = path.extname(file.originalname || "").toLowerCase();
    scriptName = extension === ".pdf" ? "pdf_processor.py" : "text_processor.py";
  }
  const scriptPath = path.join(__dirname, "..", "python", scriptName);
  return new Promise((resolve, reject) => {
    const process = spawn(pythonCommand(), [scriptPath, targetArg, outputPath], { stdio: ["ignore", "pipe", "pipe"] });
    let errorOutput = "";
    process.stderr.on("data", (chunk) => { errorOutput += chunk.toString(); });
    process.on("error", reject);
    process.on("close", (code) => {
      if (code === 0) return resolve();
      reject(new Error(errorOutput.trim() || `Document processor exited with code ${code}.`));
    });
  });
}

async function processDocument(document) {
  const outputPath = path.join(documentService.uploadDirectory, `${document.document_id}.processed.json`);
  try {
    await runProcessor(
      {
        originalname: document.original_name,
        path: document.file_path,
        file_type: document.file_type,
        is_url: document.file_type === "url",
        url: document.url,
      },
      outputPath
    );
    const processed = JSON.parse(await fs.readFile(outputPath, "utf8"));
    await fs.rm(outputPath, { force: true });
    const processedDocument = {
      ...document,
      original_name: processed.title && document.file_type === "url" ? `${processed.title} (${document.original_name})` : document.original_name,
      status: "processed",
      processed_at: new Date().toISOString(),
      page_count: processed.page_count || 1,
      passage_count: processed.passages.length,
      passages: processed.passages,
    };
    await ragService.indexDocument(processedDocument);
    await documentService.updateDocument(processedDocument);
  } catch (error) {
    console.error(`Processing failed for ${document.document_id}:`, error.message);
    await fs.rm(outputPath, { force: true });
    await documentService.updateDocument({
      ...document,
      status: "failed",
      error: error.message,
      processed_at: new Date().toISOString(),
    });
  }
}

async function handleUpload(file) {
  const documentId = `DOC-${crypto.randomUUID()}`;
  const document = {
    document_id: documentId,
    original_name: file.originalname,
    file_type: path.extname(file.originalname).toLowerCase().slice(1),
    file_size: file.size,
    file_path: file.path,
    status: "processing",
    created_at: new Date().toISOString(),
    page_count: 0,
    passage_count: 0,
    passages: [],
  };
  await documentService.saveDocument(document);
  processDocument(document);
  return { ...document, file_path: undefined, passages: undefined };
}

async function handleUrl(webUrl) {
  const documentId = `DOC-${crypto.randomUUID()}`;
  let domain = "";
  try {
    domain = new URL(webUrl).hostname;
  } catch {
    domain = "webpage";
  }

  // Create a record holding the target URL
  const tempPath = path.join(documentService.uploadDirectory, `${documentId}.url.txt`);
  await fs.writeFile(tempPath, webUrl, "utf8");

  const document = {
    document_id: documentId,
    original_name: domain || webUrl,
    file_type: "url",
    file_size: 0,
    file_path: tempPath,
    url: webUrl,
    status: "processing",
    created_at: new Date().toISOString(),
    page_count: 0,
    passage_count: 0,
    passages: [],
  };

  await documentService.saveDocument(document);
  processDocument(document);
  return { ...document, file_path: undefined, passages: undefined };
}

module.exports = { upload, handleUpload, handleUrl };
