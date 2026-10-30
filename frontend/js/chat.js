// File: frontend/js/chat.js
// Purpose: Persists multiple chats and renders grounded answers with references.

(() => {
  const storageKey = "know.ask-ai.chats";
  const maxStoredMessages = 20;
  const form = document.querySelector("#question-form");
  const input = document.querySelector("#question-input");
  const button = document.querySelector("#ask-button");
  const thread = document.querySelector("#chat-thread");
  const intro = document.querySelector("#chat-intro");
  const title = document.querySelector("#chat-title");
  const answerPanel = document.querySelector("#answer-panel");
  const newChatButton = document.querySelector("#new-chat-button");
  if (!form) return;

  let chats = loadChats();
  const requestedChatId = new URLSearchParams(window.location.search).get(
    "chat",
  );
  let activeChatId =
    requestedChatId && chats.some((chat) => chat.id === requestedChatId)
      ? requestedChatId
      : chats[0]?.id || null;
  if (!activeChatId) {
    activeChatId = createChat().id;
  }
  let messages = getActiveChat().messages;
  let isThinking = false;
  let lastError = "";

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

  function createChat() {
    const chat = {
      id: `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title: "New conversation",
      updatedAt: new Date().toISOString(),
      messages: [],
    };
    chats.unshift(chat);
    activeChatId = chat.id;
    saveChats();
    return chat;
  }

  function loadChats() {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || "[]");
      if (Array.isArray(saved) && saved.length > 0) {
        return saved.filter(
          (chat) => chat && chat.id && Array.isArray(chat.messages),
        );
      }
      const previousMessages = JSON.parse(
        localStorage.getItem("know.ask-ai.conversation") || "[]",
      );
      if (Array.isArray(previousMessages) && previousMessages.length > 0) {
        const migratedChat = {
          id: `chat-migrated-${Date.now()}`,
          title: "Previous conversation",
          updatedAt: new Date().toISOString(),
          messages: previousMessages.slice(-maxStoredMessages),
        };
        localStorage.removeItem("know.ask-ai.conversation");
        return [migratedChat];
      }
      return [];
    } catch {
      return [];
    }
  }

  function saveChats() {
    localStorage.setItem(storageKey, JSON.stringify(chats));
  }

  function getActiveChat() {
    return chats.find((chat) => chat.id === activeChatId) || chats[0];
  }

  function selectChat(chatId) {
    const chat = chats.find((item) => item.id === chatId);
    if (!chat) return;
    activeChatId = chat.id;
    messages = chat.messages;
    lastError = "";
    renderMessages();
  }

  function renderChatList() {
    const chatList = document.querySelector("#chat-list");
    const chatCount = document.querySelector("#chat-count");
    const emptyHistory = document.querySelector("#chat-history-empty");
    if (!chatList || !chatCount || !emptyHistory) return;
    chatCount.textContent = chats.length;
    emptyHistory.hidden = chats.length > 0;
    chatList.innerHTML = chats
      .map(
        (chat) =>
          `<button class="chat-list-item${chat.id === activeChatId ? " is-active" : ""}" type="button" data-chat-id="${escapeHtml(chat.id)}"><span class="chat-list-icon">✦</span><span class="chat-list-copy"><strong>${escapeHtml(chat.title)}</strong><small>${chat.messages.length ? `${Math.ceil(chat.messages.length / 2)} question${chat.messages.length === 2 ? "" : "s"}` : "No messages yet"}</small></span></button>`,
      )
      .join("");
    chatList.querySelectorAll("[data-chat-id]").forEach((item) => {
      item.addEventListener("click", () => selectChat(item.dataset.chatId));
    });
  }

  // ---------------------------------------------------------------------
  // Answer formatting helpers
  // ---------------------------------------------------------------------
  const bulletPattern = /^\s*(?:[-*•]|\d+[.)])\s+/;

  // Splits a plain-text answer into summary, bullet points and next step.
  // Works for older saved chats and for any backend that only returns `answer`.
  function parseAnswer(content) {
    const lines = String(content || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const points = [];
    const summaryLines = [];
    let nextStep = "";
    lines.forEach((line) => {
      if (/^next step:/i.test(line)) {
        nextStep = line.replace(/^next step:\s*/i, "");
      } else if (bulletPattern.test(line)) {
        points.push(line.replace(bulletPattern, ""));
      } else {
        summaryLines.push(line);
      }
    });
    return { summary: summaryLines.join(" "), points, nextStep };
  }

  function getAnswerParts(message) {
    if (message.summary) {
      return {
        summary: message.summary,
        points: Array.isArray(message.points) ? message.points : [],
        nextStep: message.next_step || "",
      };
    }
    return parseAnswer(message.content);
  }

  function statusClass(status) {
    const value = String(status || "").toUpperCase();
    if (value === "ANSWERED") return "status-answered";
    if (value === "PARTIALLY ANSWERED") return "status-partial";
    return "status-none";
  }

  function referenceLabel(citation) {
    const rawNumber =
      citation.section_number || citation.heading?.match(/^\d+(?:\.\d+)*/)?.[0] || "";
    const number = rawNumber === "—" ? "" : rawNumber;
    const headingText = String(citation.heading || "")
      .replace(/^\d+(?:\.\d+)*\s*/, "")
      .trim();
    if (number && headingText) return `${number} ${headingText}`;
    if (number) return `Section ${number}`;
    return headingText;
  }

  function renderReferences(citations) {
    const seen = new Set();
    const items = (citations || [])
      .map((citation) => {
        const label = citation.label || referenceLabel(citation);
        const key = `${citation.document_id}|${label}|${citation.page}`;
        if (seen.has(key)) return "";
        seen.add(key);
        const viewerUrl = `/pages/viewer.html?document=${encodeURIComponent(citation.document_id || "")}&page=${encodeURIComponent(citation.page || 1)}`;
        const page = `<span class="reference-chip-page">Page ${escapeHtml(citation.page ?? "—")}</span>`;
        const text = label
          ? `<span class="reference-chip-label">${escapeHtml(label)}</span>`
          : `<span class="reference-chip-label">${escapeHtml(citation.document_name || "Document")}</span>`;
        const doc = label
          ? `<span class="reference-chip-doc">${escapeHtml(citation.document_name || "Document")}</span>`
          : "";
        return `<a class="reference-chip" href="${viewerUrl}" target="_blank" rel="noopener"><span class="reference-chip-icon">§</span><span class="reference-chip-copy">${text}${doc}</span>${page}</a>`;
      })
      .filter(Boolean);
    if (!items.length) {
      return `<div class="citation-list"><strong class="references-heading">Sources</strong><p class="no-references">No supporting references were found.</p></div>`;
    }
    return `<div class="citation-list"><strong class="references-heading">Sources <span class="references-count">${items.length}</span></strong><div class="reference-chips">${items.join("")}</div></div>`;
  }

  function renderAssistantMessage(message) {
    const { summary, points, nextStep } = getAnswerParts(message);
    const summaryHtml = summary
      ? `<p class="answer-summary">${escapeHtml(summary)}</p>`
      : "";
    const pointsHtml = points.length
      ? `<ul class="answer-points">${points.map((point) => `<li>${escapeHtml(point)}</li>`).join("")}</ul>`
      : "";
    const nextStepHtml = nextStep
      ? `<div class="next-step"><span class="next-step-label">Next step</span><span>${escapeHtml(nextStep)}</span></div>`
      : "";
    const escalation =
      message.offer_escalation &&
      !/head of hr|email/i.test(message.content || "")
        ? `<div class="escalation-note">Would you like me to help draft an email to the Head of HR?</div>`
        : "";
    const missing = message.missing_information
      ? `<small class="missing-information">${escapeHtml(message.missing_information)}</small>`
      : "";
    return `<div class="chat-message assistant-message"><span class="message-label">Know AI <b class="answer-status ${statusClass(message.status)}">${escapeHtml(message.status || "")}</b></span>${summaryHtml}${pointsHtml}${nextStepHtml}${missing}${escalation}${renderReferences(message.citations)}</div>`;
  }

  function renderMessages() {
    const chat = getActiveChat();
    title.textContent = chat.title;
    intro.hidden = messages.length > 0;
    answerPanel.classList.toggle("has-messages", messages.length > 0);
    thread.innerHTML = messages
      .map((message) => {
        if (message.role === "user") {
          return `<div class="chat-message user-message"><span class="message-label">You</span><p>${escapeHtml(message.content)}</p></div>`;
        }
        return renderAssistantMessage(message);
      })
      .join("");
    if (isThinking) {
      thread.insertAdjacentHTML(
        "beforeend",
        `<div class="chat-message assistant-message thinking-message"><span class="message-label">Know AI</span><p><span class="typing-dots" aria-label="Know AI is thinking"><i></i><i></i><i></i></span><span class="thinking-copy">Reviewing your documents…</span></p></div>`,
      );
    }
    if (lastError) {
      thread.insertAdjacentHTML(
        "beforeend",
        `<p class="answer-error">${escapeHtml(lastError)}</p>`,
      );
    }
    thread.scrollTop = thread.scrollHeight;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const question = input.value.trim();
    if (!question) return;
    input.value = "";
    lastError = "";
    button.disabled = true;
    button.innerHTML = `<span class="button-spinner" aria-hidden="true"></span> Thinking…`;
    messages.push({ role: "user", content: question });
    const chat = getActiveChat();
    if (chat.title === "New conversation") {
      chat.title =
        question.length > 34 ? `${question.slice(0, 34)}...` : question;
    }
    chat.updatedAt = new Date().toISOString();
    saveChats();
    isThinking = true;
    renderMessages();
    try {
      const response = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          history: messages
            .slice(-9, -1)
            .map(({ role, content }) => ({ role, content })),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Search failed.");
      messages.push({
        role: "assistant",
        content: result.answer,
        summary: result.summary,
        points: result.points,
        next_step: result.next_step,
        status: result.status,
        citations: result.citations || result.references,
        missing_information: result.missing_information,
        offer_escalation: result.offer_escalation,
      });
      chat.updatedAt = new Date().toISOString();
      chat.messages = messages.slice(-maxStoredMessages);
      saveChats();
    } catch (error) {
      messages.pop();
      chat.title =
        messages.find((message) => message.role === "user")?.content ||
        "New conversation";
      chat.updatedAt = new Date().toISOString();
      chat.messages = messages.slice(-maxStoredMessages);
      saveChats();
      renderChatList();
      lastError = error.message;
    } finally {
      isThinking = false;
      renderMessages();
      button.disabled = false;
      button.innerHTML = "Ask <span>↗</span>";
    }
  });

  newChatButton?.addEventListener("click", () => {
    createChat();
    messages = getActiveChat().messages;
    lastError = "";
    renderMessages();
    input.focus();
  });

  renderChatList();
  renderMessages();
})();