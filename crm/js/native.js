(function initializeNativeShell() {
  "use strict";

  const capacitor = window.Capacitor;
  const isNative = Boolean(capacitor?.isNativePlatform?.());
  window.VC_IMOB_NATIVE = isNative;
  if (!isNative) return;

  document.documentElement.classList.add("is-native");
  const plugins = capacitor.Plugins || {};
  const publicSite = "https://valdineycapistranoimoveis.com.br";

  async function openOutside(url) {
    if (/^(?:tel|mailto):/i.test(url) && plugins.AppLauncher?.openUrl) {
      await plugins.AppLauncher.openUrl({ url });
      return;
    }
    if (/^https:/i.test(url) && plugins.Browser?.open) {
      await plugins.Browser.open({ url, presentationStyle: "popover" });
      return;
    }
    window.location.href = url;
  }

  const webOpen = typeof window.open === "function" ? window.open.bind(window) : null;
  window.open = function nativeWindowOpen(url, target, features) {
    const destination = String(url || "");
    if (/^(?:https|tel|mailto):/i.test(destination)) {
      openOutside(destination).catch(() => { window.location.href = destination; });
      return null;
    }
    return webOpen?.(url, target, features) || null;
  };

  document.addEventListener("click", event => {
    const link = event.target.closest("a[href]");
    if (!link || event.defaultPrevented) return;
    const raw = link.getAttribute("href") || "";
    if (raw.startsWith("#") || raw.startsWith("javascript:")) return;

    const target = new URL(raw, window.location.href);
    const isPublicHome = target.origin === window.location.origin && /\/index\.html$/.test(target.pathname) && !target.pathname.includes("/crm/");
    const isExternalHttps = target.protocol === "https:" && target.origin !== window.location.origin;
    const isExternalScheme = /^(?:tel|mailto):$/i.test(target.protocol);
    if (!isPublicHome && !isExternalHttps && !isExternalScheme) return;

    event.preventDefault();
    const destination = isPublicHome ? `${publicSite}${target.pathname}${target.search}${target.hash}` : target.href;
    openOutside(destination).catch(() => { window.location.href = destination; });
  }, true);

  plugins.Network?.addListener?.("networkStatusChange", status => {
    window.dispatchEvent(new Event(status.connected ? "online" : "offline"));
  });

  plugins.App?.addListener?.("appUrlOpen", ({ url }) => {
    try {
      const deepLink = new URL(url);
      if (deepLink.protocol !== "vcimob:" || deepLink.hostname !== "crm") return;
      const view = deepLink.pathname.replace(/^\//, "");
      const allowedViews = new Set(["dashboard", "leads", "kanban", "properties", "agenda", "team", "billing"]);
      window.location.href = view && allowedViews.has(view) ? `./index.html#${view}` : "./index.html";
    } catch {
      // Deep links inválidos falham fechados e não alteram a navegação.
    }
  });
})();
