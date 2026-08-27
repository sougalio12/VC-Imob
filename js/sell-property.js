/* WhatsApp agora; payload reutilizável para futura origem anunciar_imovel no CRM. */
(function () {
  const form = document.getElementById("sellForm");
  if (!form) return;

  const clean = (value, maxLength) => String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
  const field = (id) => document.getElementById(id);

  function buildSubmission() {
    return {
      origin: "anunciar_imovel",
      name: clean(field("sellerName")?.value, 120),
      phone: clean(field("sellerPhone")?.value, 24),
      propertyType: clean(field("propertyType")?.value, 60),
      location: clean(field("propertyLocation")?.value, 160),
      approximateValue: clean(field("propertyValue")?.value, 80),
      description: clean(field("propertyDescription")?.value, 800),
      preferredTime: clean(field("preferredContactTime")?.value, 20)
    };
  }

  function validateSubmission(submission) {
    if (submission.name.length < 2) return "Informe seu nome.";
    if (submission.phone.replace(/\D/g, "").length < 8) return "Informe um telefone ou WhatsApp válido.";
    if (!submission.propertyType) return "Selecione o tipo do imóvel.";
    if (submission.location.length < 2) return "Informe a cidade, bairro ou região do imóvel.";
    if (!submission.preferredTime) return "Selecione o horário preferido para atendimento.";
    return "";
  }

  function buildWhatsAppMessage(submission) {
    return `Olá! Gostaria de anunciar meu imóvel com a Valdiney Capistrano Imóveis.

Nome: ${submission.name}
Telefone: ${submission.phone}
Tipo: ${submission.propertyType}
Localização: ${submission.location}
Valor aproximado: ${submission.approximateValue || "Não informado"}
Preferência de atendimento: ${submission.preferredTime}
Descrição: ${submission.description || "Não informada"}`;
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const submission = buildSubmission();
    const error = validateSubmission(submission);
    const errorElement = document.getElementById("sellFormError");
    if (errorElement) errorElement.textContent = error;
    if (error) return;
    window.dispatchEvent(new CustomEvent("vci:property-ad-submitted", { detail: submission }));
    if (typeof window.abrirWhatsApp === "function") window.abrirWhatsApp(buildWhatsAppMessage(submission));
  });
})();
