import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs";

const params = new URLSearchParams(window.location.search);
const documentId = params.get("document");
const pageNumber = Math.max(Number(params.get("page")) || 1, 1);
const targetSection = (params.get("section") || "").trim().toLowerCase();

const status = document.querySelector("#viewer-status");
const title = document.querySelector("#viewer-title");
const badge = document.querySelector("#viewer-badge");
const externalLink = document.querySelector("#viewer-external-link");
const documentElement = document.querySelector("#pdf-document");

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

async function renderPdf(docInfo) {
  if (docInfo?.original_name) {
    title.textContent = docInfo.original_name;
  }
  const pdf = await pdfjsLib.getDocument(`/api/documents/${encodeURIComponent(documentId)}/file`).promise;
  if (pageNumber > pdf.numPages) throw new Error("Referenced page is unavailable.");

  for (let number = 1; number <= pdf.numPages; number += 1) {
    const page = await pdf.getPage(number);
    const scale = 1.35;
    const viewport = page.getViewport({ scale });
    const pageElement = document.createElement("section");
    pageElement.className = "pdf-page";
    pageElement.id = `page-${number}`;
    pageElement.dataset.page = number;
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    pageElement.style.width = `${viewport.width}px`;
    pageElement.style.height = `${viewport.height}px`;
    pageElement.append(canvas);
    documentElement.appendChild(pageElement);
    await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
    if (number === pageNumber) {
      pageElement.classList.add("is-target-page");
    }
  }

  document.querySelector(`#page-${pageNumber}`)?.scrollIntoView({
    behavior: "smooth",
    block: "start",
  });
  status.textContent = `Page ${pageNumber} of ${pdf.numPages}`;
}

function renderWebpageDocument(doc) {
  title.textContent = doc.original_name || "Webpage Document";
  if (badge) {
    badge.textContent = "🌐 Webpage Source";
    badge.hidden = false;
  }

  if (externalLink && doc.url) {
    externalLink.href = doc.url;
    externalLink.hidden = false;
  }

  const container = document.createElement("article");
  container.className = "webpage-viewer";

  const metaCard = document.createElement("div");
  metaCard.className = "webpage-meta-card";
  metaCard.innerHTML = `
    <h2>${escapeHtml(doc.original_name)}</h2>
    <p>Source URL: <a href="${escapeHtml(doc.url || "#")}" target="_blank" rel="noopener" style="color: #6857e8; text-decoration: underline;">${escapeHtml(doc.url || "Webpage")}</a> · ${doc.passages?.length || 0} extracted sections</p>
  `;
  container.appendChild(metaCard);

  const passages = Array.isArray(doc.passages) ? doc.passages : [];
  let targetElement = null;

  passages.forEach((passage, index) => {
    const block = document.createElement("div");
    block.className = "webpage-section-block";
    block.id = `section-${passage.passage_id || index}`;

    const heading = passage.heading || passage.section || "General";
    const sectionNum = passage.section_number && passage.section_number !== "—" ? passage.section_number : "";

    const normalizedHeading = heading.toLowerCase();
    const isTarget = targetSection && (
      normalizedHeading.includes(targetSection) ||
      targetSection.includes(normalizedHeading) ||
      (sectionNum && targetSection.includes(sectionNum))
    );

    if (isTarget) {
      block.classList.add("is-target-section");
      if (!targetElement) targetElement = block;
    }

    block.innerHTML = `
      <div class="webpage-section-header">
        <h3 class="webpage-section-title">${sectionNum ? `<span class="section-badge">${escapeHtml(sectionNum)}</span> ` : ""}${escapeHtml(heading)}</h3>
        ${isTarget ? `<span class="target-reference-badge">Referenced in Chat</span>` : ""}
      </div>
      <p class="webpage-section-content">${escapeHtml(passage.content || "")}</p>
    `;
    container.appendChild(block);
  });

  documentElement.appendChild(container);
  status.textContent = `${passages.length} sections extracted`;

  if (targetElement) {
    setTimeout(() => {
      targetElement.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 200);
  }
}

async function render() {
  if (!documentId) throw new Error("Missing document reference in query parameters.");

  let docInfo = null;
  try {
    const res = await fetch(`/api/documents/${encodeURIComponent(documentId)}`);
    if (res.ok) {
      docInfo = (await res.json()).document;
    }
  } catch {
    // If metadata fetch fails, attempt PDF directly
  }

  if (docInfo && docInfo.file_type !== "pdf") {
    renderWebpageDocument(docInfo);
  } else {
    await renderPdf(docInfo);
  }
}

render().catch((error) => {
  status.textContent = error.message;
});
