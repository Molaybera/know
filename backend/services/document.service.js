// File: backend/services/document.service.js
// Purpose: Persists document metadata and passage records in local JSON storage.

const fs = require("fs/promises");
const path = require("path");

const dataDirectory = path.join(__dirname, "..", "data");
const metadataDirectory = path.join(dataDirectory, "metadata");
const uploadDirectory = path.join(dataDirectory, "uploads");

async function ensureStorage() {
  await Promise.all([
    fs.mkdir(metadataDirectory, { recursive: true }),
    fs.mkdir(uploadDirectory, { recursive: true }),
  ]);
}

function metadataPath(documentId) {
  return path.join(metadataDirectory, `${documentId}.json`);
}

async function saveDocument(document) {
  await ensureStorage();
  await fs.writeFile(metadataPath(document.document_id), JSON.stringify(document, null, 2), "utf8");
  return document;
}

async function getDocument(documentId) {
  try {
    return JSON.parse(await fs.readFile(metadataPath(documentId), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function listDocuments() {
  await ensureStorage();
  const files = (await fs.readdir(metadataDirectory)).filter((file) => file.endsWith(".json"));
  const documents = await Promise.all(files.map((file) => fs.readFile(path.join(metadataDirectory, file), "utf8").then(JSON.parse)));
  return documents.sort((left, right) => new Date(right.created_at) - new Date(left.created_at));
}

async function updateDocument(document) {
  return saveDocument(document);
}

async function deleteDocument(documentId) {
  const document = await getDocument(documentId);
  if (!document) return false;
  await Promise.all([
    fs.rm(document.file_path, { force: true }),
    fs.rm(metadataPath(documentId), { force: true }),
  ]);
  return true;
}

module.exports = {
  ensureStorage,
  saveDocument,
  getDocument,
  listDocuments,
  updateDocument,
  deleteDocument,
  uploadDirectory,
  metadataDirectory,
};
