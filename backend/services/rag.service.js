// File: backend/services/rag.service.js
// Purpose: Runs local ChromaDB indexing and Ollama-backed vector retrieval.

const path = require("path");
const { spawn } = require("child_process");

const scriptPath = path.join(__dirname, "..", "python", "rag_service.py");
const databasePath = path.join(__dirname, "..", "data", "vector_db");

function runRagCommand(command, payload) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.platform === "win32" ? "python" : "python3", [
      scriptPath,
      command,
      "--db-path",
      databasePath,
      "--payload",
      JSON.stringify(payload),
    ], { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let errorOutput = "";
    child.stdout.on("data", (chunk) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk) => { errorOutput += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
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
  });
}

function search(question, limit = 5) {
  return runRagCommand("search", { question, limit });
}

function answer(question) {
  return runRagCommand("answer", { question });
}

function deleteDocument(documentId) {
  return runRagCommand("delete", { document_id: documentId });
}

module.exports = { indexDocument, search, answer, deleteDocument };
