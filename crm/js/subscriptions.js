(function initializeSubscriptionAdapter() {
  "use strict";
  function platform() {
    if (!window.Capacitor?.isNativePlatform?.()) return "web";
    return window.Capacitor.getPlatform?.() === "ios" ? "apple" : "google";
  }
  window.beginSubscriptionCheckout = async function beginSubscriptionCheckout(selection) {
    const provider = platform();
    const channel = provider === "apple" ? "App Store" : provider === "google" ? "Google Play" : "cobrança web";
    showToast(`A contratação por ${channel} será habilitada após a configuração comercial dos produtos. Nenhuma cobrança foi realizada.`, "error");
    return { configured: false, provider, selection };
  };
  window.restoreSubscriptionPurchases = async function restoreSubscriptionPurchases() {
    const provider = platform();
    if (provider === "web") { showToast("A restauração é feita pela loja no aplicativo iOS ou Android.", "error"); return; }
    showToast("A restauração será habilitada quando os produtos da loja forem configurados. Nenhum acesso foi concedido sem validação.", "error");
  };
})();
