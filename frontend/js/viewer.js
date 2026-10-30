import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs";

const params = new URLSearchParams(window.location.search);
const documentId = params.get("document");
const pageNumber = Math.max(Number(params.get("page")) || 1, 1);
const highlightText = (params.get("highlight") || "").replace(/\s+/g, " ").trim();
const status = document.querySelector("#viewer-status");
const title = document.querySelector("#viewer-title");
const pageElement = document.querySelector("#pdf-page");
const canvas = document.querySelector("#pdf-canvas");
const textLayer = document.querySelector("#text-layer");

function normalize(value) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function highlightTerms() {
  const target = normalize(highlightText);
  if (!target) return;
  const terms = target.split(/\W+/).filter((term) => term.length > 3);
  const spans = [...textLayer.querySelectorAll("span")];
  const ranked = spans
    .map((span) => {
      const value = normalize(span.textContent);
      const score = terms.reduce(
        (total, term) => total + (value.includes(term) ? 1 : 0),
        0,
      );
      return { span, score };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score);
  ranked.slice(0, 2).forEach(({ span }) => span.classList.add("highlight"));
}

async function render() {
  if (!documentId) throw new Error("Missing document reference.");
  const pdf = await pdfjsLib.getDocument(`/api/documents/${encodeURIComponent(documentId)}/file`).promise;
  if (pageNumber > pdf.numPages) throw new Error("Referenced page is unavailable.");
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1.35 });
  const context = canvas.getContext("2d");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  pageElement.style.width = `${viewport.width}px`;
  pageElement.style.height = `${viewport.height}px`;
  await page.render({ canvasContext: context, viewport }).promise;

  const content = await page.getTextContent();
  content.items.forEach((item) => {
    const span = document.createElement("span");
    const [scaleX, skewY, skewX, scaleY, x, y] = item.transform;
    span.textContent = item.str;
    span.style.left = `${x * 1.35}px`;
    span.style.top = `${viewport.height - y * 1.35}px`;
    span.style.fontSize = `${Math.abs(scaleY) * 1.35}px`;
    span.style.transform = `scaleX(${scaleX / Math.abs(scaleY)}) translateY(-100%)`;
    textLayer.appendChild(span);
  });
  highlightTerms();
  status.textContent = `Page ${pageNumber} of ${pdf.numPages}`;
}

render().catch((error) => {
  status.textContent = error.message;
});
