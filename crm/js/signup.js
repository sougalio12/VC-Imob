(function initializePublicSignup() {
  "use strict";
  const form = document.getElementById("signupForm");
  if (!form) return;
  const error = document.getElementById("signupError");
  const submit = form.querySelector('button[type="submit"]');
  const phoneInput = form.elements.namedItem("phone");
  if (typeof bindPhoneInput === "function") bindPhoneInput(phoneInput);
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const phoneDigits = value => String(value || "").replace(/\D/g, "");
  const maskEmail = value => {
    const [local, domain] = String(value || "").split("@");
    if (!local || !domain) return "seu e-mail";
    return `${local.slice(0, 2)}${"•".repeat(Math.max(2, Math.min(6, local.length - 2)))}@${domain}`;
  };

  function showConfirmation(email) {
    const panel = document.createElement("section");
    panel.className = "signup-confirmation";
    panel.setAttribute("aria-live", "polite");
    const title = Object.assign(document.createElement("h2"), { textContent: "Verifique seu e-mail" });
    const message = Object.assign(document.createElement("p"), { textContent: "Enviamos um link de confirmação para:" });
    const destination = Object.assign(document.createElement("p"), { className: "confirmation-email", textContent: maskEmail(email) });
    const help = Object.assign(document.createElement("p"), { textContent: "Abra a mensagem e toque em “Confirmar meu e-mail” para concluir o cadastro." });
    const actions = Object.assign(document.createElement("div"), { className: "confirmation-actions" });
    const resend = Object.assign(document.createElement("button"), { type: "button", className: "crm-button crm-button-outline", textContent: "Reenviar e-mail" });
    const login = Object.assign(document.createElement("a"), { className: "crm-button crm-button-primary", href: "./login.html", textContent: "Ir para o login" });
    const status = document.createElement("p"); status.setAttribute("role", "status");
    actions.append(resend, login); panel.append(title, message, destination, help, actions, status); form.replaceWith(panel);
    let seconds = 60, timer = null;
    const updateCooldown = () => { resend.disabled = seconds > 0; resend.textContent = seconds > 0 ? `Reenviar em ${seconds}s` : "Reenviar e-mail"; if (seconds-- <= 0) clearInterval(timer); };
    updateCooldown(); timer = setInterval(updateCooldown, 1000);
    resend.addEventListener("click", async () => {
      if (resend.disabled) return;
      resend.disabled = true; status.textContent = "Enviando…";
      try { await resendSignupConfirmation(email); status.textContent = "Se o cadastro estiver pendente, um novo e-mail será enviado."; seconds = 60; updateCooldown(); timer = setInterval(updateCooldown, 1000); }
      catch (exception) { status.textContent = exception.message || "Não foi possível reenviar agora."; resend.disabled = false; }
    });
  }

  form.addEventListener("submit", async event => {
    event.preventDefault(); error.textContent = "";
    const data = new FormData(form);
    const payload = {
      fullName: String(data.get("fullName") || "").trim(), email: String(data.get("email") || "").trim().toLowerCase(),
      phone: String(data.get("phone") || "").trim(), password: String(data.get("password") || ""),
      creci: String(data.get("creci") || "").trim(), companyName: String(data.get("companyName") || "").trim()
    };
    if (!payload.fullName) { error.textContent = "Informe seu nome."; return; }
    if (!emailPattern.test(payload.email)) { error.textContent = "Informe um e-mail válido."; return; }
    if (phoneDigits(payload.phone).length < 10) { error.textContent = "Informe um telefone válido com DDD."; return; }
    if (payload.password.length < 8) { error.textContent = "A senha deve ter pelo menos 8 caracteres."; return; }
    if (!data.get("legalAccepted")) { error.textContent = "Aceite os Termos e a Política de Privacidade para continuar."; return; }
    submit.disabled = true; submit.textContent = "Criando sua conta…";
    try {
      const result = await signUpPublicAccount(payload);
      if (result?.access_token) window.location.replace("./index.html#billing");
      else showConfirmation(payload.email);
    } catch (exception) { error.textContent = exception.message || "Não foi possível criar sua conta."; submit.disabled = false; submit.textContent = "Criar conta e iniciar trial"; }
  });
})();
