// File: backend/services/rag.service.js
// Purpose: Runs local ChromaDB indexing and Ollama-backed vector retrieval.

const path = require("path");
const { spawn } = require("child_process");

const crypto = require("crypto");
const fs = require("fs/promises");

const scriptPath = path.join(__dirname, "..", "python", "rag_service.py");
const databasePath = path.join(__dirname, "..", "data", "vector_db");
const uploadDirectory = path.join(__dirname, "..", "data", "uploads");

async function runRagCommand(command, payload) {
  const tempPayloadFile = path.join(uploadDirectory, `rag-${crypto.randomUUID()}.json`);
  await fs.writeFile(tempPayloadFile, JSON.stringify(payload), "utf8");

  return new Promise((resolve, reject) => {
    const child = spawn(process.platform === "win32" ? "python" : "python3", [
      scriptPath,
      command,
      "--db-path",
      databasePath,
      "--payload-file",
      tempPayloadFile,
    ], { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let errorOutput = "";
    child.stdout.on("data", (chunk) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk) => { errorOutput += chunk.toString(); });
    child.on("error", async (err) => {
      await fs.rm(tempPayloadFile, { force: true });
      reject(err);
    });
    child.on("close", async (code) => {
      await fs.rm(tempPayloadFile, { force: true });
      if (code !== 0) return reject(new Error(errorOutput.trim() || `RAG service exited with code ${code}.`));
      try {
        return resolve(JSON.parse(output));
      } catch {
        return reject(new Error("RAG service returned invalid JSON."));
      }
    });
  });
}

function indexDocument(document) {
  return runRagCommand("index", {
    document_id: document.document_id,
    document_name: document.original_name,
    passages: document.passages,
    url: document.url || "",
    file_type: document.file_type || "",
  });
}

function search(question, limit = 5) {
  return runRagCommand("search", { question, limit });
}

function answer(question, history = []) {
  return runRagCommand("answer", { question, history });
}

function deleteDocument(documentId) {
  return runRagCommand("delete", { document_id: documentId });
}

module.exports = { indexDocument, search, answer, deleteDocument };
