(function initializePasswordToggles() {
  "use strict";

  document.querySelectorAll("[data-password-toggle]").forEach(button => {
    const input = document.getElementById(button.getAttribute("aria-controls"));
    if (!input) return;

    button.addEventListener("pointerdown", event => event.preventDefault());
    button.addEventListener("click", () => {
      const start = input.selectionStart;
      const end = input.selectionEnd;
      const visible = input.type === "password";
      input.type = visible ? "text" : "password";
      button.setAttribute("aria-pressed", String(visible));
      button.setAttribute("aria-label", visible ? "Ocultar senha" : "Mostrar senha");
      input.focus({ preventScroll: true });
      requestAnimationFrame(() => {
        if (start !== null && end !== null) input.setSelectionRange(start, end);
      });
    });
  });
})();
