(function initializePhaseG() {
  "use strict";

  const isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  const isIos = /iphone|ipad|ipod/i.test(window.navigator.userAgent);
  let deferredInstallPrompt = null;

  document.documentElement.classList.toggle("is-standalone", isStandalone);

  function setConnectivity() {
    const offline = !window.navigator.onLine;
    document.documentElement.classList.toggle("is-offline", offline);
    const banner = document.getElementById("crmConnectivity");
    if (banner) banner.hidden = !offline;
  }

  function ensureInstallButton() {
    if (isStandalone || document.getElementById("pwaInstallButton")) return null;
    const host = document.querySelector(".topbar-actions") || document.querySelector(".login-panel");
    if (!host) return null;
    const button = document.createElement("button");
    button.id = "pwaInstallButton";
    button.type = "button";
    button.className = "pwa-install-button";
    button.textContent = "Instalar VC Imob";
    button.hidden = true;
    host.append(button);
    return button;
  }

  function showIosInstructions() {
    if (!isIos || isStandalone || sessionStorage.getItem("vc-imob-ios-install-dismissed") === "true") return;
    const button = ensureInstallButton();
    if (!button) return;
    button.hidden = false;
    button.addEventListener("click", () => {
      const panel = document.createElement("aside");
      panel.className = "pwa-install-guide";
      panel.setAttribute("role", "dialog");
      panel.setAttribute("aria-label", "Como instalar o VC Imob");
      panel.innerHTML = "<strong>Instalar no iPhone ou iPad</strong><p>No Safari, toque em Compartilhar e depois em Adicionar à Tela de Início.</p><button type=\"button\">Entendi</button>";
      panel.querySelector("button").addEventListener("click", () => {
        sessionStorage.setItem("vc-imob-ios-install-dismissed", "true");
        panel.remove();
        button.hidden = true;
      });
      document.body.append(panel);
      panel.querySelector("button").focus();
    }, { once: true });
  }

  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    deferredInstallPrompt = event;
    if (sessionStorage.getItem("vc-imob-install-dismissed") === "true") return;
    const button = ensureInstallButton();
    if (!button) return;
    button.hidden = false;
    button.addEventListener("click", async () => {
      button.hidden = true;
      await deferredInstallPrompt.prompt();
      const choice = await deferredInstallPrompt.userChoice;
      if (choice.outcome !== "accepted") sessionStorage.setItem("vc-imob-install-dismissed", "true");
      deferredInstallPrompt = null;
    }, { once: true });
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    document.getElementById("pwaInstallButton")?.remove();
  });

  function enhanceTables(root = document) {
    root.querySelectorAll("table").forEach(table => {
      const labels = [...table.querySelectorAll("thead th")].map(th => th.textContent.trim());
      table.querySelectorAll("tbody tr").forEach(row => [...row.children].forEach((cell, index) => {
        if (labels[index] && !cell.dataset.label) cell.dataset.label = labels[index];
      }));
    });
  }

  function enhanceForms(root = document) {
    root.querySelectorAll('input[type="tel"]').forEach(input => input.setAttribute("inputmode", "tel"));
    root.querySelectorAll('input[type="email"]').forEach(input => input.setAttribute("inputmode", "email"));
    root.querySelectorAll('input[type="number"]').forEach(input => input.setAttribute("inputmode", "numeric"));
  }

  function bindMobileNavigation() {
    const more = document.getElementById("mobileMoreButton");
    if (!more) return;
    more.addEventListener("click", () => {
      const open = !document.getElementById("crmSidebar")?.classList.contains("is-open");
      if (typeof toggleSidebar === "function") toggleSidebar(open);
      more.setAttribute("aria-expanded", String(open));
    });
    document.getElementById("crmBackdrop")?.addEventListener("click", () => more.setAttribute("aria-expanded", "false"));
  }

  function bindModalAccessibility() {
    const modal = document.getElementById("crmModal");
    if (!modal) return;
    let wasOpen = false;
    let returnFocus = null;
    const observer = new MutationObserver(() => {
      const open = modal.classList.contains("is-open");
      document.body.classList.toggle("has-open-modal", open);
      if (open) {
        enhanceForms(modal);
        const card = modal.querySelector(".modal-card");
        card?.setAttribute("tabindex", "-1");
        if (!wasOpen) {
          returnFocus = document.activeElement;
          queueMicrotask(() => (modal.querySelector("input, select, textarea, button, [tabindex='0']") || card)?.focus());
        }
      } else if (wasOpen && returnFocus instanceof HTMLElement) {
        returnFocus.focus();
      }
      wasOpen = open;
    });
    observer.observe(modal, { attributes: true, attributeFilter: ["class"], childList: true, subtree: true });
    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && modal.classList.contains("is-open") && typeof closeModal === "function") closeModal();
      if (event.key !== "Tab" || !modal.classList.contains("is-open")) return;
      const focusable = [...modal.querySelectorAll("button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex='0']")].filter(element => !element.hidden);
      if (!focusable.length) return;
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
  }

  document.addEventListener("submit", event => {
    if (window.navigator.onLine || !event.target.closest(".crm-app, .crm-login-page")) return;
    event.preventDefault();
    if (typeof showToast === "function") showToast("Reconecte-se para salvar alterações.", "error");
  }, true);

  window.addEventListener("online", setConnectivity);
  window.addEventListener("offline", setConnectivity);
  document.addEventListener("DOMContentLoaded", () => {
    setConnectivity();
    bindMobileNavigation();
    bindModalAccessibility();
    showIosInstructions();
    const content = document.getElementById("crmContent");
    if (content) new MutationObserver(() => { enhanceTables(content); enhanceForms(content); }).observe(content, { childList: true, subtree: true });
    enhanceTables();
    enhanceForms();
  });

  if (!window.VC_IMOB_NATIVE && "serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
    window.addEventListener("load", async () => {
      try {
        const registration = await navigator.serviceWorker.register("./service-worker.js", { scope: "./", updateViaCache: "none" });
        registration.addEventListener("updatefound", () => {
          const worker = registration.installing;
          worker?.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller && typeof showToast === "function") showToast("Nova versão disponível. Ela será usada na próxima abertura.");
          });
        });
      } catch {
        // Progressive enhancement: the CRM remains usable when service workers are unavailable.
      }
    });
  }
})();
