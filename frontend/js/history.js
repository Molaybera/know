// File: frontend/js/history.js
// Purpose: Renders locally saved conversations and links them back to Ask AI.

(() => {
  const storageKey = "know.ask-ai.chats";
  const list = document.querySelector("#history-page-list");
  const empty = document.querySelector("#history-page-empty");
  if (!list) return;

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

  let chats = [];
  try {
    chats = JSON.parse(localStorage.getItem(storageKey) || "[]");
  } catch {
    chats = [];
  }
  chats = Array.isArray(chats) ? chats.filter((chat) => chat && chat.id) : [];

  function saveChats() {
    localStorage.setItem(storageKey, JSON.stringify(chats));
  }

  function render() {
    empty.hidden = chats.length > 0;
    list.innerHTML = chats
      .map(
        (chat) => `
      <div class="history-page-item">
        <span class="chat-list-icon">✦</span>
        <span class="chat-list-copy"><strong>${escapeHtml(chat.title || "New conversation")}</strong><small>${chat.messages?.length ? `${Math.ceil(chat.messages.length / 2)} questions` : "No messages yet"}</small></span>
        <span class="history-actions">
          <a class="history-open" href="/pages/ask.html?chat=${encodeURIComponent(chat.id)}">Open →</a>
          <button class="history-action-button" type="button" aria-label="Rename chat" title="Rename chat" data-action="rename" data-chat-id="${escapeHtml(chat.id)}">✏️</button>
          <button class="history-action-button history-delete" type="button" aria-label="Delete chat" title="Delete chat" data-action="delete" data-chat-id="${escapeHtml(chat.id)}">🗑️</button>
        </span>
      </div>
    `,
      )
      .join("");
  }

  list.addEventListener("click", (event) => {
    const action = event.target.closest("[data-action]");
    if (!action) return;
    const chat = chats.find((item) => item.id === action.dataset.chatId);
    if (!chat) return;
    event.preventDefault();
    if (action.dataset.action === "delete") {
      if (!window.confirm(`Delete "${chat.title || "New conversation"}"?`)) return;
      chats = chats.filter((item) => item.id !== chat.id);
    } else {
      const nextTitle = window.prompt("Enter a new chat name:", chat.title || "New conversation")?.trim();
      if (!nextTitle) return;
      chat.title = nextTitle.slice(0, 80);
      chat.updatedAt = new Date().toISOString();
    }
    saveChats();
    render();
  });

  render();
})();
