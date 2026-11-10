const test = require("node:test");
const assert = require("node:assert/strict");
const phone = require("../js/phone-mask.js");

test("formata celular e telefone fixo automaticamente", () => {
  assert.equal(phone.format("65999999999"), "(65) 99999-9999");
  assert.equal(phone.format("6535421234"), "(65) 3542-1234");
});

test("aceita colagem formatada, remove caracteres e limita a 11 dígitos", () => {
  assert.equal(phone.format("+55 (65) 99999-9999"), "(65) 99999-9999");
  assert.equal(phone.format("(65) 99999-9999abc123"), "(65) 99999-9999");
});

test("mantém formatação parcial durante edição", () => {
  assert.equal(phone.format("6"), "(6");
  assert.equal(phone.format("65"), "(65");
  assert.equal(phone.format("659"), "(65) 9");
  assert.equal(phone.format("6599999"), "(65) 9999-9");
});

test("valida DDD e comprimento brasileiros", () => {
  assert.deepEqual(phone.validate("(65) 99999-9999"), { valid: true, reason: "", digits: "65999999999" });
  assert.equal(phone.validate("(00) 99999-9999").reason, "ddd");
  assert.equal(phone.validate("(65) 9999-999").reason, "length");
});

test("calcula o cursor pelo índice do dígito para edição intermediária", () => {
  const formatted = "(65) 99999-9999";
  assert.equal(phone.caretForDigitIndex(formatted, 2), 3);
  assert.equal(phone.caretForDigitIndex(formatted, 7), 10);
  assert.equal(phone.caretForDigitIndex(formatted, 11), formatted.length);
});
