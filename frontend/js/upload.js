// File: frontend/js/upload.js
// Purpose: Reserves the document upload interaction for Phase 2 processing.

document.querySelector(".upload-zone")?.addEventListener("click", (event) => {
  if (event.target.closest("button")) {
    event.preventDefault();
  }
});
