// File: frontend/js/settings.js
// Purpose: Handles webpage URL knowledge source import and local service configuration.

(() => {
  const form = document.querySelector("#url-import-form");
  const urlInput = document.querySelector("#webpage-url-input");
  const submitButton = document.querySelector("#import-url-button");
  const feedback = document.querySelector("#url-feedback");

  if (!form || !urlInput) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const url = urlInput.value.trim();
    if (!url) return;

    submitButton.disabled = true;
    submitButton.textContent = "Scraping & Indexing…";
    feedback.className = "url-feedback";
    feedback.textContent = "Fetching webpage content and preparing knowledge layer…";

    try {
      const response = await fetch("/api/documents/url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to import webpage.");
      }

      feedback.className = "url-feedback success";
      feedback.textContent = `✓ Successfully imported "${data.document.original_name}". It is now being indexed for chat!`;
      urlInput.value = "";
    } catch (error) {
      feedback.className = "url-feedback error";
      feedback.textContent = `✕ ${error.message}`;
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = "Import Webpage";
    }
  });
})();
