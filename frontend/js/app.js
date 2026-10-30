// File: frontend/js/app.js
// Purpose: Initializes shared navigation and responsive sidebar behavior.

(() => {
  const sidebar = document.querySelector("#sidebar");
  const menuButton = document.querySelector("#menu-button");
  const currentPage = window.location.pathname.includes("/pages/")
    ? window.location.pathname.split("/").pop().replace(".html", "")
    : "documents";

  document.querySelectorAll(".nav-item").forEach((item) => {
    item.classList.toggle("is-active", item.dataset.page === currentPage);
  });

  menuButton?.addEventListener("click", () => {
    sidebar?.classList.toggle("is-open");
  });

})();
