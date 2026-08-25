function createElement(tag, options = {}) {
  const element = document.createElement(tag);

  if (options.className) element.className = options.className;
  if (options.text !== undefined) element.textContent = options.text;
  if (options.type) element.type = options.type;
  if (options.href) element.href = options.href;
  if (options.src) element.src = options.src;
  if (options.alt) element.alt = options.alt;
  if (options.disabled) element.disabled = true;
  if (options.attrs) Object.entries(options.attrs).forEach(([key, value]) => element.setAttribute(key, value));

  return element;
}

function formatDate(value, withTime = false) {
  if (!value) return "Não informado";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Não informado";

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "medium",
    ...(withTime ? { timeStyle: "short" } : {})
  }).format(date);
}

function formatPrice(value) {
  const price = Number(value);
  if (!Number.isFinite(price) || price <= 0) return "Sob consulta";

  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0
  }).format(price);
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function startOfToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

function showToast(message, type = "success") {
  const toast = document.getElementById("crmToast");
  if (!toast) return;

  toast.textContent = message;
  toast.className = `crm-toast is-visible is-${type}`;
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    toast.className = "crm-toast";
  }, 3500);
}

function createEmptyState(title, description, action) {
  const box = createElement("section", { className: "empty-state" });
  box.append(createElement("h2", { text: title }), createElement("p", { text: description }));
  if (action) box.append(action);
  return box;
}
