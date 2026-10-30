// File: frontend/js/chat.js
// Purpose: Sends questions to vector retrieval and renders grounded source passages.

(() => {
  const form = document.querySelector("#question-form");
  const input = document.querySelector("#question-input");
  const button = document.querySelector("#ask-button");
  const panel = document.querySelector("#answer-panel");
  const content = document.querySelector("#answer-content");
  if (!form) return;

  const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  }[character]));

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const question = input.value.trim();
    if (!question) return;
    button.disabled = true;
    button.textContent = "Searching...";
    content.hidden = false;
    content.innerHTML = "<p class=\"answer-loading\">Searching indexed passages...</p>";
    try {
      const response = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Search failed.");
      content.innerHTML = `<span class="answer-status">${escapeHtml(result.status)}</span><p>${escapeHtml(result.answer)}</p><div class="citation-list">${result.citations.map((citation) => `<article><strong>${escapeHtml(citation.document_name)}</strong><small>${escapeHtml(citation.section)} · page ${escapeHtml(citation.page)} · ${escapeHtml(citation.passage_id)}</small><p>${escapeHtml(citation.passage)}</p></article>`).join("") || "<p>No supporting passages met the relevance threshold.</p>"}</div>`;
    } catch (error) {
      content.innerHTML = `<p class="answer-error">${escapeHtml(error.message)}</p>`;
    } finally {
      button.disabled = false;
      button.innerHTML = "Ask <span>↗</span>";
    }
  });
})();
