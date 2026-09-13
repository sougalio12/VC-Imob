(function initializePublicSignup() {
  "use strict";
  const form = document.getElementById("signupForm");
  if (!form) return;
  const error = document.getElementById("signupError");
  const submit = form.querySelector('button[type="submit"]');
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const phoneDigits = value => String(value || "").replace(/\D/g, "");

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
      else form.replaceChildren(Object.assign(document.createElement("p"), { className: "signup-success", textContent: "Conta criada. Confira seu e-mail para confirmar o cadastro e depois entre no VC Imob." }));
    } catch (exception) { error.textContent = exception.message || "Não foi possível criar sua conta."; submit.disabled = false; submit.textContent = "Criar conta e iniciar trial"; }
  });
})();
