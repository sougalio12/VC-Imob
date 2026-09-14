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

function normalizePhone(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.length >= 12 && digits.startsWith("55")) digits = digits.slice(2);
  return digits.slice(0, 11);
}

function formatPhone(value) {
  const digits = normalizePhone(value);
  if (!digits) return "";
  if (digits.length <= 2) return `(${digits}`;
  const areaCode = digits.slice(0, 2), subscriber = digits.slice(2);
  if (subscriber.length <= 4) return `(${areaCode}) ${subscriber}`;
  const split = subscriber.length > 8 ? 5 : 4;
  return `(${areaCode}) ${subscriber.slice(0, split)}-${subscriber.slice(split)}`;
}

function bindPhoneInput(input) {
  if (!input || input.dataset.phoneInput === "true") return input;
  input.dataset.phoneInput = "true";
  input.inputMode = "tel";
  input.autocomplete = input.autocomplete || "tel";
  input.maxLength = 15;
  input.addEventListener("input", () => {
    let digits = String(input.value || "").replace(/\D/g, "");
    if (digits.length >= 12 && digits.startsWith("55")) digits = digits.slice(2);
    digits = digits.slice(0, 11);
    if (!digits) input.value = "";
    else if (digits.length <= 2) input.value = `(${digits}`;
    else {
      const subscriber = digits.slice(2), split = subscriber.length > 8 ? 5 : 4;
      input.value = subscriber.length <= 4
        ? `(${digits.slice(0, 2)}) ${subscriber}`
        : `(${digits.slice(0, 2)}) ${subscriber.slice(0, split)}-${subscriber.slice(split)}`;
    }
  });
  if (input.value) input.value = formatPhone(input.value);
  return input;
}

// Backwards-compatible name used by earlier CRM modules.
function bindPhoneMask(input) { return bindPhoneInput(input); }

function parseBrlNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
  let clean = String(value ?? "").trim();
  if (!clean) return NaN;
  const negative = /^\s*-/.test(clean);
  clean = clean.replace(/R\$/gi, "").replace(/\s/g, "").replace(/[^\d.,]/g, "");
  if (!clean) return NaN;
  const comma = clean.lastIndexOf(","), dot = clean.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) {
    const decimal = comma > dot ? "," : ".";
    const thousands = decimal === "," ? /\./g : /,/g;
    clean = clean.replace(thousands, "").replace(decimal, ".");
  } else if (comma >= 0) {
    clean = clean.replace(/\./g, "").replace(",", ".");
  } else if (dot >= 0) {
    const brazilianGrouping = /^\d{1,3}(?:\.\d{3})+$/.test(clean);
    if (brazilianGrouping) clean = clean.replace(/\./g, "");
  }
  const parsed = Number(`${negative ? "-" : ""}${clean}`);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function formatBrlInput(value) {
  const number = parseBrlNumber(value);
  return Number.isFinite(number)
    ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(number)
    : "";
}

function placeCurrencyCaret(input) {
  const decimalAt = input.value.lastIndexOf(",");
  const caret = decimalAt >= 0 ? decimalAt : input.value.length;
  requestAnimationFrame(() => input.setSelectionRange?.(caret, caret));
}

function bindCurrencyInput(input) {
  if (!input || input.dataset.currencyInput === "true") return input;
  input.dataset.currencyInput = "true";
  input.inputMode = "decimal";
  input.autocomplete = "off";
  input.placeholder = input.placeholder || "R$ 0,00";
  if (input.value) input.value = formatBrlInput(input.value);
  input.addEventListener("focus", () => {
    if (!input.value) return;
    placeCurrencyCaret(input);
  });
  input.addEventListener("input", () => {
    const number = parseBrlNumber(input.value);
    input.value = Number.isFinite(number) ? formatBrlInput(number) : "";
    if (input.value) placeCurrencyCaret(input);
  });
  return input;
}

function bindDateTimeInput(input) {
  if (!input || input.dataset.dateTimeInput === "true") return input;
  input.dataset.dateTimeInput = "true";
  input.classList.add("date-time-input");
  input.autocomplete = "off";
  if (!input.step) input.step = "300";
  return input;
}

function getDisplayName(profile = {}, session) {
  const activeSession = session || (typeof getStoredSession === "function" ? getStoredSession() : null);
  const metadata = activeSession?.user?.user_metadata || {};
  const candidates = [profile.full_name, profile.display_name, metadata.full_name, metadata.name, metadata.display_name];
  const name = candidates.map(value => String(value || "").trim()).find(value => value && !value.includes("@"));
  return name || String(profile.email || activeSession?.user?.email || "Usuário").trim() || "Usuário";
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
