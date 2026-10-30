import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs";

const params = new URLSearchParams(window.location.search);
const documentId = params.get("document");
const pageNumber = Math.max(Number(params.get("page")) || 1, 1);
const status = document.querySelector("#viewer-status");
const title = document.querySelector("#viewer-title");
const documentElement = document.querySelector("#pdf-document");

async function renderPage(pdf, number) {
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

async function render() {
  if (!documentId) throw new Error("Missing document reference.");
  const pdf = await pdfjsLib.getDocument(`/api/documents/${encodeURIComponent(documentId)}/file`).promise;
  if (pageNumber > pdf.numPages) throw new Error("Referenced page is unavailable.");
  for (let number = 1; number <= pdf.numPages; number += 1) {
    await renderPage(pdf, number);
  }
  document.querySelector(`#page-${pageNumber}`)?.scrollIntoView({
    behavior: "smooth",
    block: "start",
  });
  status.textContent = `Page ${pageNumber} of ${pdf.numPages}`;
}

render().catch((error) => {
  status.textContent = error.message;
});
