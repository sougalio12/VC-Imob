const { chromium, webkit, devices } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const source = JSON.parse(
  fs.readFileSync("tests/vc-imob-2/fixtures/public-catalog.json", "utf8"),
);
(async () => {
  for (const engine of [chromium, webkit])
    for (const mobile of [false, true]) {
      const browser = await engine.launch({
        headless: true,
        executablePath:
          engine === webkit ? process.env.WEBKIT_EXECUTABLE : undefined,
      });
      const context = await browser.newContext(
        mobile
          ? { ...devices["iPhone 13"], reducedMotion: "reduce" }
          : {
              viewport: { width: 1440, height: 1000 },
              reducedMotion: "reduce",
            },
      );
      const page = await context.newPage();
      const errors = [];
      await context.addInitScript(() =>
        localStorage.setItem("vci_cookie_choice", "essential"),
      );
      page.on("pageerror", (e) => errors.push(e.message));
      let rows = source,
        offline = false,
        delay = 0;
      await page.route(
        "**/rest/v1/rpc/list_public_properties",
        async (route) => {
          if (offline) return route.abort();
          if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
          await route.fulfill({ json: rows }).catch(() => {});
        },
      );
      await page.goto(
        (process.env.BASE_URL || "http://127.0.0.1:8000") +
          "/index.html?catalogo=1&modalidade=locacao",
      );
      await page.waitForFunction(
        () =>
          document.querySelectorAll("#propertiesGrid .property-card").length ===
          1,
      );
      assert.match(
        await page.locator("#propertiesGrid").innerText(),
        /VCI000007/,
      );
      assert.match(
        await page.locator(".property-price strong").innerText(),
        /2\.300.*mês/,
      );
      assert.doesNotMatch(
        await page.locator(".property-price strong").innerText(),
        /condomínio/,
      );
      await page.evaluate(() =>
        renderizarImoveis([
          {
            ...todosImoveis.find((p) => p.codigo === "VCI000007"),
            preco: 2300.5,
          },
        ]),
      );
      assert.match(
        await page.locator(".property-price strong").innerText(),
        /2\.300,50/,
      );
      await page.evaluate(() =>
        renderizarImoveis([
          {
            ...todosImoveis.find((p) => p.codigo === "VCI000007"),
            preco: null,
          },
        ]),
      );
      assert.match(
        await page.locator(".property-price strong").innerText(),
        /Consulte/,
      );
      await page.evaluate(() => renderizarImoveis(todosImoveis));
      assert.equal(await page.locator("a a").count(), 0);
      await page.getByRole("button", { name: "Comprar", exact: true }).click();
      assert.equal(await page.locator(".property-card").count(), 5);
      assert.match(page.url(), /modalidade=venda/);
      await page.goBack();
      assert.equal(await page.locator(".property-card").count(), 1);
      if (mobile) {
        const menu = page.locator("#mobileMenuButton");
        await menu.click();
        await page.waitForTimeout(100);
        assert.equal(await menu.getAttribute("aria-expanded"), "true");
        assert.equal(await page.locator("#mainNav").isVisible(), true);
        await page.screenshot({
          path: `artifacts/vc-imob-2/${engine.name()}-mobile-menu.png`,
        });
        await menu.focus();
        await page.keyboard.press("Tab");
        assert.equal(
          await page.evaluate(
            () =>
              document.activeElement === document.querySelector("#mainNav a"),
          ),
          true,
        );
        await page.keyboard.press("Shift+Tab");
        assert.equal(
          await menu.evaluate((e) => document.activeElement === e),
          true,
        );
        await page.keyboard.press("Escape");
        assert.equal(await menu.getAttribute("aria-expanded"), "false");
        assert.equal(await page.locator("#mainNav").isVisible(), false);
        await menu.click();
        await page.mouse.click(10, 300);
        assert.equal(await menu.getAttribute("aria-expanded"), "false");
        await menu.click();
        await page.locator('#mainNav a[href="#atendimento"]').click();
        assert.equal(await menu.getAttribute("aria-expanded"), "false");
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
        );
      }
      // Inspect footer and ensure hidden sections have no remaining anchor links.
      for (const target of ["categorias", "noticias", "financiamento"])
        assert.equal(await page.locator(`a[href="#${target}"]`).count(), 0);
      await page.locator(".site-footer").scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `artifacts/vc-imob-2/${engine.name()}-${mobile ? "iphone" : "desktop"}-footer.png`,
      });
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({
        path: `artifacts/vc-imob-2/${engine.name()}-${mobile ? "iphone" : "desktop"}.png`,
        fullPage: false,
      });
      // Lead modal is exercised without submitting or creating a lead.
      await page.locator(".property-interest-button").first().click();
      assert.equal(await page.locator(".site-lead-modal").isVisible(), true);
      await page.keyboard.press("Escape");
      // URL filters must retain a no-results state rather than silently broadening.
      await page.goto(
        (process.env.BASE_URL || "http://127.0.0.1:8000") +
          "/index.html?catalogo=1&bairro=INEXISTENTE",
      );
      await page.waitForFunction(
        () =>
          document.getElementById("propertiesEmpty").style.display === "block",
      );
      assert.equal(await page.locator(".property-card").count(), 0);
      if (!mobile) {
        rows = [...source, { ...source[0], codigo: "TEST-ONLY-EXTRA" }];
        await page.goto(
          (process.env.BASE_URL || "http://127.0.0.1:8000") + "/index.html",
        );
        await page.waitForFunction(
          () => document.querySelectorAll(".property-card").length === 6,
        );
        await page.locator("#vcAllProperties a").click();
        await page.waitForFunction(
          () => document.querySelectorAll(".property-card").length === 7,
        );
        rows = [];
        await page.reload();
        await page.waitForFunction(
          () =>
            document.getElementById("propertiesEmpty").style.display ===
            "block",
        );
        assert.equal(await page.locator(".property-card").count(), 0);
        rows = source;
        delay = 750;
        await page.reload();
        await page.waitForFunction(
          () => document.querySelectorAll(".property-card").length === 6,
        );
        delay = 0;
        offline = true;
        await page.reload();
        await page.waitForFunction(() => window.vcCatalogSource === "cache");
        assert.equal(await page.locator("#vcCatalogStatus").isVisible(), true);
        await page.evaluate(() =>
          localStorage.removeItem("vcimob-public-catalog-v1"),
        );
        await page.reload();
        await page.waitForFunction(() => window.vcCatalogSource === "json");
        assert.equal(await page.locator("#vcCatalogStatus").isVisible(), true);
        offline = false;
        await page.emulateMedia({ reducedMotion: "no-preference" });
        await page.evaluate(() => sessionStorage.removeItem("vcimob-welcome"));
        await page.reload();
        assert.equal(await page.locator(".vc-welcome button").count(), 0);
        await page.waitForFunction(
          () => !document.querySelector(".vc-welcome"),
        );
        await page.reload();
        assert.equal(await page.locator(".vc-welcome").count(), 0);
      }
      assert.deepEqual(errors, []);
      console.log(`PASS ${engine.name()} ${mobile ? "iphone" : "desktop"}`);
      await browser.close();
    }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
