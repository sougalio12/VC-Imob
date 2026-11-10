import { test, expect } from "@playwright/test";

test("public seller phone supports typing, formatted paste, editing and validation", async ({ page }) => {
  await page.setContent('<label for="sellerPhone">Telefone / WhatsApp</label><input id="sellerPhone" type="tel" required inputmode="numeric" autocomplete="tel" maxlength="24">');
  await page.addScriptTag({ path: "js/phone-mask.js" });
  await page.evaluate(() => window.VCPhoneMask.bind(document.getElementById("sellerPhone")));
  const phone = page.locator("#sellerPhone");
  await phone.scrollIntoViewIfNeeded();
  await phone.fill("65999999999");
  await expect(phone).toHaveValue("(65) 99999-9999");

  await phone.evaluate(input => {
    input.value = "+55 (65) 3542-1234";
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertFromPaste" }));
  });
  await expect(phone).toHaveValue("(65) 3542-1234");

  await phone.evaluate(input => input.setSelectionRange(8, 8));
  await phone.press("Backspace");
  await expect.poll(() => phone.evaluate(input => input.value.replace(/\D/g, "").length)).toBe(9);
  await expect(phone).toHaveValue("(65) 3521-234");

  await phone.fill("00999999999");
  await phone.blur();
  await expect.poll(() => phone.evaluate(input => input.validationMessage)).toContain("DDD válido");
});

test("mobile property editor is full-screen, previews reference and keeps focused fields visible", async ({ page }) => {
  await page.setContent(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"></head><body class="crm-app">
    <div id="crmModal" class="crm-modal" aria-hidden="true">
      <section class="modal-card property-editor" role="dialog" aria-modal="true" aria-labelledby="propertyEditorTitle">
        <h2 id="propertyEditorTitle">Cadastrar imóvel</h2>
        <form class="crm-form property-editor-form">
          <div style="height:420px">Dados principais</div>
          <label>Tipo<select name="property_type"><option>Casa</option></select></label>
          <p class="property-reference-preview" role="status">Prévia: CA0001. A referência definitiva será confirmada ao salvar.</p>
          <div style="height:420px">Características</div>
          <label>Descrição<textarea name="description"></textarea></label>
          <div class="modal-actions"><button type="button">Cancelar</button><button type="submit">Salvar imóvel</button></div>
        </form>
      </section>
    </div>
  </body></html>`);
  for (const path of ["crm/css/crm.css", "crm/css/phase-g.css", "crm/css/premium.css", "crm/css/responsive-system.css", "crm/css/clean-system.css"]) await page.addStyleTag({ path });
  await page.addScriptTag({ path: "crm/js/pwa.js" });
  await page.evaluate(() => {
    window.closeModal = () => document.getElementById("crmModal").classList.remove("is-open");
    document.dispatchEvent(new Event("DOMContentLoaded"));
    const modal = document.getElementById("crmModal");
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
  });

  const editor = page.locator(".property-editor");
  const form = page.locator(".property-editor-form");
  await expect(editor).toBeVisible();
  await expect.poll(() => page.evaluate(() => !document.activeElement?.matches("input, select, textarea"))).toBe(true);
  await expect.poll(() => form.evaluate(element => getComputedStyle(element).overflowY)).toBe("auto");

  await expect(page.locator(".property-reference-preview")).toContainText("CA0001");

  const description = page.locator('textarea[name="description"]');
  await description.focus();
  await page.setViewportSize({ width: 390, height: 480 });
  await expect.poll(async () => {
    const box = await description.boundingBox();
    return box && box.y >= 0 && box.y + Math.min(box.height, 80) <= 480;
  }).toBeTruthy();

  const editorBox = await editor.boundingBox();
  expect(editorBox.y).toBeGreaterThanOrEqual(0);
  expect(editorBox.height).toBeLessThanOrEqual(481);
});
