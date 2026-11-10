const { chromium, webkit, devices } = require("playwright");
const fs = require("node:fs");
const assert = require("node:assert/strict");
(async () => {
  const base = process.env.BASE_URL;
  if (!base) throw new Error("BASE_URL required");
  for (const engine of [chromium, webkit])
    for (const mobile of [false, true]) {
      const browser = await engine.launch({
        headless: true,
        executablePath:
          engine === webkit ? process.env.WEBKIT_EXECUTABLE : undefined,
      });
      const page = await browser.newPage(
        mobile
          ? { ...devices["iPhone 13"], reducedMotion: "reduce" }
          : {
              viewport: { width: 1440, height: 1000 },
              reducedMotion: "reduce",
            },
      );
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(base + "/index.html?catalogo=1&modalidade=locacao", {
        waitUntil: "networkidle",
      });
      await page.waitForFunction(
        () => document.querySelectorAll(".property-card").length > 0,
      );
      console.log(
        engine.name(),
        mobile ? "mobile" : "desktop",
        "source",
        await page.evaluate(() => window.vcCatalogSource),
      );
      assert.equal(await page.evaluate(() => window.vcCatalogSource), "rpc");
      assert.match(
        await page.locator("#propertiesGrid").innerText(),
        /VCI000007/,
      );
      assert.equal(await page.locator(".property-card").count(), 1);
      assert.match(
        await page.locator(".property-price").innerText(),
        /2\.300.*mês/s,
      );
      if (mobile) {
        await page.locator("#mobileMenuButton").click();
        assert.equal(await page.locator("#mainNav").isVisible(), true);
        await page.keyboard.press("Escape");
        assert.equal(await page.locator("#mainNav").isVisible(), false);
      }
      await page.screenshot({
        path: `artifacts/vc-imob-2/live-${engine.name()}-${mobile ? "mobile" : "desktop"}.png`,
      });
      await page.locator(".property-title a").click();
      await page.waitForFunction(() =>
        document
          .getElementById("propertyDetailRoot")
          ?.textContent.includes("VCI000007"),
      );
      assert.match(
        await page.locator(".property-detail-price").innerText(),
        /Aluguel mensal/i,
      );
      assert.match(
        await page.locator(".property-detail-price").innerText(),
        /mês/,
      );
      await page.goto(base + "/index.html");
      await page.waitForFunction(
        () => document.querySelectorAll(".property-card").length > 0,
      );
      assert.ok((await page.locator(".property-card").count()) <= 6);
      assert.equal(
        await page.locator(".hero h1").innerText(),
        "Encontre seu próximo imóvel.",
      );
      assert.match(
        await page.locator(".vc-whatsapp").getAttribute("href"),
        /wa.me\/5565999337268/,
      );
      for (const image of await page.locator("#propertiesGrid img").all())
        await image.scrollIntoViewIfNeeded();
      await page.waitForFunction(() =>
        [...document.querySelectorAll("#propertiesGrid img")].every(
          (i) => i.complete && i.naturalWidth > 0,
        ),
      );
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({
        path: `artifacts/vc-imob-2/live-home-${engine.name()}-${mobile ? "mobile" : "desktop"}.png`,
      });
      await page.goto(base + "/crm/index.html", { waitUntil: "networkidle" });
      assert.match(page.url(), /crm\/(?:login|index)(?:\.html)?\/?$/);
      assert.ok((await page.locator("input[type=password]").count()) > 0);
      console.log("CRM", page.url());
      assert.deepEqual(errors, []);
      console.log("PASS live", base, engine.name(), mobile);
      await browser.close();
    }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
