// File: frontend/js/upload.js
// Purpose: Uploads documents and renders processing status from the document API.

(() => {
  const input = document.querySelector("#file-input");
  const chooseButton = document.querySelector("#choose-files");
  const zone = document.querySelector("#upload-zone");
  const table = document.querySelector("#documents-table");
  const emptyState = document.querySelector("#empty-documents");
  const summary = document.querySelector("#document-summary");
  const count = document.querySelector("#document-count");
  const feedback = document.querySelector("#upload-feedback");

  if (!input || !chooseButton || !zone) return;

  const formatSize = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  const escapeHtml = (value) =>
    String(value).replace(
      /[&<>"']/g,
      (character) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#039;",
        })[character],
    );

  function render(documents) {
    count.textContent = `${documents.length} document${documents.length === 1 ? "" : "s"}`;
    summary.textContent = documents.length
      ? `${documents.length} in library`
      : "No documents yet";
    emptyState.hidden = documents.length > 0;
    table.innerHTML = documents
      .map((document) => {
        const state =
          document.status === "processed"
            ? "Processed"
            : document.status === "failed"
              ? "Failed"
              : "Processing";
        const detail =
          document.status === "processed"
            ? `${document.passage_count} passages · ${document.page_count} page${document.page_count === 1 ? "" : "s"}`
            : document.status === "failed"
              ? escapeHtml(document.error || "Processing failed.")
              : "Extracting text and passages...";
        return `<article class="document-row"><div class="file-type">${escapeHtml(document.file_type.toUpperCase())}</div><div class="document-main"><strong>${escapeHtml(document.original_name)}</strong><small>${formatSize(document.file_size)} · ${detail}</small></div><span class="document-status status-${document.status}">${state}</span><button class="delete-document" data-id="${escapeHtml(document.document_id)}" type="button" aria-label="Delete ${escapeHtml(document.original_name)}">×</button></article>`;
      })
      .join("");
    table.querySelectorAll(".delete-document").forEach((button) => {
      button.addEventListener("click", () => removeDocument(button.dataset.id));
    });
  }

  async function loadDocuments() {
    const response = await fetch("/api/documents");
    if (!response.ok) throw new Error("Could not load documents.");
    render((await response.json()).documents);
  }

  async function removeDocument(documentId) {
    const response = await fetch(
      `/api/documents/${encodeURIComponent(documentId)}`,
      { method: "DELETE" },
    );
    if (!response.ok) {
      feedback.textContent = "Could not delete that document.";
      return;
    }
    await pollDocuments();
  }

  async function uploadFiles(files) {
    if (!files.length) return;
    const formData = new FormData();
    [...files].forEach((file) => formData.append("documents", file));
    feedback.textContent = "Uploading and starting extraction...";
    const response = await fetch("/api/documents/upload", {
      method: "POST",
      body: formData,
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Upload failed.");
    feedback.textContent = `${body.documents.length} upload${body.documents.length === 1 ? "" : "s"} queued for processing.`;
    await loadDocuments();
  }

  chooseButton.addEventListener("click", () => input.click());
  input.addEventListener("change", () =>
    uploadFiles(input.files).catch((error) => {
      feedback.textContent = error.message;
    }),
  );
  ["dragenter", "dragover"].forEach((eventName) =>
    zone.addEventListener(eventName, (event) => {
      event.preventDefault();
      zone.classList.add("is-dragging");
    }),
  );
  ["dragleave", "drop"].forEach((eventName) =>
    zone.addEventListener(eventName, (event) => {
      event.preventDefault();
      zone.classList.remove("is-dragging");
    }),
  );
  zone.addEventListener("drop", (event) =>
    uploadFiles(event.dataTransfer.files).catch((error) => {
      feedback.textContent = error.message;
    }),
  );
  let polling = false;
  async function pollDocuments() {
    if (polling) return;
    polling = true;
    try {
      await loadDocuments();
      const response = await fetch("/api/documents");
      const documents = (await response.json()).documents;
      if (documents.some((document) => document.status === "processing")) {
        window.setTimeout(() => {
          polling = false;
          pollDocuments();
        }, 1000);
      } else {
        polling = false;
      }
    } catch (error) {
      polling = false;
      feedback.textContent = error.message;
    }
  }
  pollDocuments();
})();
