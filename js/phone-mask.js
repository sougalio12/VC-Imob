(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.VCPhoneMask = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const VALID_DDDS = new Set([
    "11","12","13","14","15","16","17","18","19","21","22","24","27","28",
    "31","32","33","34","35","37","38","41","42","43","44","45","46","47","48","49",
    "51","53","54","55","61","62","63","64","65","66","67","68","69","71","73","74",
    "75","77","79","81","82","83","84","85","86","87","88","89","91","92","93","94",
    "95","96","97","98","99"
  ]);

  function digits(value) {
    let number = String(value || "").replace(/\D/g, "");
    if ((number.length === 12 || number.length === 13) && number.startsWith("55")) number = number.slice(2);
    return number.slice(0, 11);
  }

  function format(value) {
    const number = digits(value);
    if (!number) return "";
    if (number.length < 3) return `(${number}`;
    const ddd = number.slice(0, 2);
    const local = number.slice(2);
    const split = number.length > 10 ? 5 : 4;
    return `(${ddd}) ${local.slice(0, split)}${local.length > split ? `-${local.slice(split)}` : ""}`;
  }

  function validate(value) {
    const number = digits(value);
    if (number.length !== 10 && number.length !== 11) return { valid: false, reason: "length", digits: number };
    if (!VALID_DDDS.has(number.slice(0, 2))) return { valid: false, reason: "ddd", digits: number };
    return { valid: true, reason: "", digits: number };
  }

  function caretForDigitIndex(formatted, digitIndex) {
    if (digitIndex <= 0) return formatted ? 1 : 0;
    let seen = 0;
    for (let index = 0; index < formatted.length; index += 1) {
      if (/\d/.test(formatted[index])) seen += 1;
      if (seen === digitIndex) return index + 1;
    }
    return formatted.length;
  }

  function bind(input) {
    if (!input || input.dataset.phoneMask === "true") return;
    input.dataset.phoneMask = "true";
    input.inputMode = "numeric";
    input.autocomplete = "tel";
    input.maxLength = 24;

    input.addEventListener("beforeinput", event => {
      if (event.inputType === "insertText" && event.data && /\D/.test(event.data)) event.preventDefault();
      if (!event.inputType.startsWith("delete") || input.selectionStart !== input.selectionEnd) return;
      const position = input.selectionStart;
      const backward = event.inputType === "deleteContentBackward";
      const adjacent = backward ? input.value[position - 1] : input.value[position];
      if (!adjacent || /\d/.test(adjacent)) return;
      const currentDigits = digits(input.value);
      const digitsBefore = digits(input.value.slice(0, position)).length;
      const removeAt = backward ? digitsBefore - 1 : digitsBefore;
      if (removeAt < 0 || removeAt >= currentDigits.length) return;
      event.preventDefault();
      const next = currentDigits.slice(0, removeAt) + currentDigits.slice(removeAt + 1);
      input.value = format(next);
      const nextPosition = caretForDigitIndex(input.value, Math.max(0, removeAt));
      input.setSelectionRange(nextPosition, nextPosition);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    input.addEventListener("input", () => {
      const selection = input.selectionStart ?? input.value.length;
      const digitIndex = digits(input.value.slice(0, selection)).length;
      const formatted = format(input.value);
      input.value = formatted;
      const nextPosition = caretForDigitIndex(formatted, digitIndex);
      input.setSelectionRange(nextPosition, nextPosition);
      input.setCustomValidity("");
    });

    input.addEventListener("blur", () => {
      if (!input.value) return input.setCustomValidity("");
      const result = validate(input.value);
      input.setCustomValidity(result.valid ? "" : result.reason === "ddd" ? "Informe um DDD válido." : "Informe um telefone com 10 ou 11 dígitos.");
    });

    input.value = format(input.value);
  }

  return { VALID_DDDS, digits, format, validate, caretForDigitIndex, bind };
});
