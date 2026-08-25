/* Captura pública: apenas a Publishable Key é exposta; a função nunca recebe organization_id. */
const PUBLIC_LEAD_CONFIG = {
  supabaseUrl: "https://isbkhhobutbdtdtpaavn.supabase.co",
  publishableKey: "sb_publishable_cGq_OqxifhWpbVEGobB-7Q_De9SuyBC"
};

(function () {
  let modal;
  let lastFocusedElement;

  function clean(value, max) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
  }

  function ensureModal() {
    if (modal) return modal;
    modal = document.createElement("div");
    modal.className = "site-lead-modal";
    modal.hidden = true;
    modal.setAttribute("role", "presentation");
    modal.innerHTML = `<section class="site-lead-dialog" role="dialog" aria-modal="true" aria-labelledby="siteLeadTitle"><div class="site-lead-dialog-header"><h2 id="siteLeadTitle">Tenho interesse neste imóvel</h2><button class="site-lead-close" type="button" aria-label="Fechar">×</button></div><p>Informe seus dados para que possamos registrar seu interesse. Em seguida, você continuará para o WhatsApp.</p><form class="site-lead-form" novalidate><label class="site-lead-field">Nome<input name="name" autocomplete="name" maxlength="120" required></label><label class="site-lead-field">Telefone / WhatsApp<input name="phone" inputmode="tel" autocomplete="tel" maxlength="24" required></label><label class="site-lead-field">E-mail <span>(opcional)</span><input name="email" inputmode="email" autocomplete="email" maxlength="254"></label><label class="site-lead-honeypot" aria-hidden="true">Não preencha<input name="website" tabindex="-1" autocomplete="off"></label><p class="site-lead-error" aria-live="polite"></p><div class="site-lead-actions"><button class="btn btn-primary site-lead-submit" type="submit">Continuar para o WhatsApp</button><button class="site-lead-skip" type="button">Continuar sem cadastrar dados</button></div></form></section>`;
    document.body.append(modal);
    modal.querySelector(".site-lead-close").addEventListener("click", close);
    modal.querySelector(".site-lead-skip").addEventListener("click", () => finish(false));
    modal.addEventListener("click", (event) => { if (event.target === modal) close(); });
    document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !modal.hidden) close(); });
    return modal;
  }

  function close() {
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    modal.querySelector("form").reset();
    lastFocusedElement?.focus?.();
  }

  function finish(capture) {
    const state = modal._siteLeadState;
    if (!state) return close();
    if (capture) sendLead(state.payload).catch(() => undefined);
    const continueToWhatsApp = state.onContinue;
    close();
    continueToWhatsApp();
  }

  async function sendLead(payload) {
    const response = await fetch(`${PUBLIC_LEAD_CONFIG.supabaseUrl}/functions/v1/site-lead`, {
      method: "POST",
      headers: { apikey: PUBLIC_LEAD_CONFIG.publishableKey, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true
    });
    if (!response.ok) throw new Error("Lead capture failed");
  }

  function openInterestFlow({ propertyCode, propertyTitle, onContinue }) {
    const dialog = ensureModal();
    const form = dialog.querySelector("form");
    const error = dialog.querySelector(".site-lead-error");
    lastFocusedElement = document.activeElement;
    form.reset();
    error.textContent = "";
    dialog.hidden = false;
    dialog.querySelector("input[name=name]").focus();
    form.onsubmit = (event) => {
      event.preventDefault();
      const formData = new FormData(form);
      const name = clean(formData.get("name"), 120);
      const phone = String(formData.get("phone") || "").replace(/\D/g, "").slice(0, 15);
      const email = clean(formData.get("email"), 254).toLowerCase();
      if (name.length < 2 || phone.length < 8) {
        error.textContent = "Informe nome e telefone válidos.";
        return;
      }
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        error.textContent = "Informe um e-mail válido ou deixe o campo em branco.";
        return;
      }
      dialog._siteLeadState = { payload: { name, phone, email, propertyCode: clean(propertyCode, 32), propertyTitle: clean(propertyTitle, 180), website: clean(formData.get("website"), 120) }, onContinue };
      finish(true);
    };
  }

  window.siteLeadCapture = { openInterestFlow };
})();
