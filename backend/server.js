// File: backend/server.js
// Purpose: Serves the phase-one frontend and exposes the foundational health endpoint.

const express = require("express");
const path = require("path");

const app = express();
const port = Number(process.env.PORT) || 3000;
const frontendDirectory = path.join(__dirname, "..", "frontend");

app.use(express.json());
app.use(express.static(frontendDirectory));

app.get("/api/health", (_request, response) => {
  response.json({
    status: "ok",
    service: "document-intelligence-assistant",
    phase: 1,
  });
});

app.get("/", (_request, response) => {
  response.redirect("/pages/ask.html");
});

app.get("*", (_request, response) => {
  response.sendFile(path.join(frontendDirectory, "pages", "ask.html"));
});

app.listen(port, () => {
  console.log(`Document Intelligence Assistant listening on http://localhost:${port}`);
});
