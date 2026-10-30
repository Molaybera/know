// File: frontend/js/navigation.js
// Purpose: Holds navigation-specific behavior that can be extended as views become interactive.

export function closeNavigation(sidebar) {
  sidebar?.classList.remove("is-open");
}
