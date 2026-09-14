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

function normalizePhone(value) { const digits = String(value || "").replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "").slice(0, 11); return digits; }
function formatPhone(value) { const digits = normalizePhone(value); if (digits.length <= 2) return digits ? `(${digits}` : ""; if (digits.length <= 6) return `(${digits.slice(0,2)}) ${digits.slice(2)}`; const split = digits.length === 11 ? 7 : 6; return `(${digits.slice(0,2)}) ${digits.slice(2,split)}-${digits.slice(split)}`; }
function bindPhoneMask(input) { input.inputMode = "tel"; input.autocomplete = "tel"; input.addEventListener("input", () => { input.value = formatPhone(input.value); }); if (input.value) input.value = formatPhone(input.value); }
function parseBrlNumber(value) { if (typeof value === "number") return value; const clean = String(value || "").trim().replace(/R\$\s?/g, "").replace(/\./g, "").replace(",", ".").replace(/[^\d.-]/g, ""); return clean ? Number(clean) : NaN; }
function formatBrlInput(value) { const number = parseBrlNumber(value); return Number.isFinite(number) ? new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(number) : ""; }

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
