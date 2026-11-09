const { chromium, webkit, devices } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const base = process.env.BASE_URL || "http://127.0.0.1:8000";
const fixture = JSON.parse(
  fs.readFileSync("tests/vc-imob-2/fixtures/public-catalog.json", "utf8"),
);
(async () => {
  for (const engine of [chromium, webkit]) {
    const browser = await engine.launch({
      headless: true,
      executablePath:
        engine === webkit ? process.env.WEBKIT_EXECUTABLE : undefined,
    });
    for (const mobile of [false, true]) {
      const context = await browser.newContext(
        mobile
          ? devices["iPhone 13"]
          : { viewport: { width: 1440, height: 1000 } },
      );
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      if (!process.env.BASE_URL)
        await page.route("**/rest/v1/rpc/list_public_properties", (r) =>
          r.fulfill({ json: fixture }),
        );
      await page.addInitScript(() => {
        const timer = window.setTimeout;
        window.setTimeout = (fn, ms, ...args) =>
          timer(fn, ms === 5500 ? 15000 : ms, ...args);
      });
      await page.goto(base + "/index.html", { waitUntil: "domcontentloaded" });
      const splash = page.locator(".vc-welcome");
      await splash.waitFor();
      assert.equal(await splash.locator("button").count(), 0);
      assert.equal(
        await splash
          .getByRole("heading", { name: "Bem-vindo à VC Imob.", exact: true })
          .count(),
        1,
      );
      assert.equal(
        await splash.locator("p .visually-hidden").textContent(),
        "Onde novos caminhos encontram seu endereço.",
      );
      assert.equal(await splash.locator("h2 > [aria-hidden=true]").count(), 1);
      assert.equal(await splash.locator("p > [aria-hidden=true]").count(), 1);
      await page.waitForFunction(
        () => document.querySelector(".vc-welcome img").naturalWidth > 0,
      );
      await page.evaluate(() => {
        window.welcomeAnimations = document
          .querySelector(".vc-welcome")
          .getAnimations({ subtree: true });
        window.welcomeAnimations.forEach((a) => a.pause());
      });
      const frame = async (time) => {
        await page.evaluate(
          (time) =>
            window.welcomeAnimations.forEach((a) => (a.currentTime = time)),
          time,
        );
        return splash.evaluate((s) => {
          const opacity = (e) => Number(getComputedStyle(e).opacity);
          const title = [...s.querySelectorAll("h2 .vc-welcome__letter")].map(
            opacity,
          );
          const subtitle = [...s.querySelectorAll("p .vc-welcome__letter")].map(
            opacity,
          );
          return {
            title,
            subtitle,
            logo: opacity(s.querySelector("img")),
            background: opacity(s),
            height: s.querySelector("h2").getBoundingClientRect().height,
          };
        });
      };
      let state = await frame(500);
      assert.ok(state.logo > 0 && state.logo < 1);
      assert.ok([...state.title, ...state.subtitle].every((v) => v === 0));
      const initialHeight = state.height;
      state = await frame(1000);
      assert.ok(state.logo > 0.99);
      assert.ok([...state.title, ...state.subtitle].every((v) => v === 0));
      state = await frame(1600);
      assert.ok(state.title[0] > state.title.at(-1));
      assert.ok(state.subtitle.every((v) => v === 0));
      state = await frame(2200);
      assert.ok(state.title.every((v) => v > 0.99));
      assert.ok(state.subtitle.every((v) => v === 0));
      state = await frame(2800);
      assert.ok(state.title.every((v) => v > 0.99));
      assert.ok(state.subtitle[0] > state.subtitle.at(-1));
      for (const time of [3400, 4000, 4500]) {
        state = await frame(time);
        assert.ok([...state.title, ...state.subtitle].every((v) => v > 0.99));
        assert.ok(state.logo > 0.99);
        assert.equal(state.background, 1);
      }
      assert.equal(state.height, initialHeight);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      await page.screenshot({
        path: `artifacts/vc-imob-2/welcome-${engine.name()}-${mobile ? "iphone" : "desktop"}-hold.png`,
      });
      state = await frame(4650);
      assert.ok(state.title[0] < state.title.at(-1));
      assert.ok(state.subtitle[0] < state.subtitle.at(-1));
      assert.ok(state.logo > 0.99);
      state = await frame(4900);
      assert.ok([...state.title, ...state.subtitle].every((v) => v < 0.01));
      assert.ok(state.logo > 0.99);
      state = await frame(5050);
      assert.ok(state.logo > 0 && state.logo < 1);
      assert.equal(state.background, 1);
      state = await frame(5200);
      assert.ok(state.logo < 0.01);
      assert.equal(state.background, 1);
      state = await frame(5350);
      assert.ok(state.background > 0 && state.background < 1);
      assert.ok(state.logo < 0.01);
      await page.evaluate(() =>
        window.welcomeAnimations.forEach((a) => a.play()),
      );
      await splash.waitFor({ state: "detached", timeout: 3000 });
      await page.reload({ waitUntil: "domcontentloaded" });
      assert.equal(await splash.count(), 0);
      assert.deepEqual(errors, []);
      await context.close();
      console.log(
        `PASS welcome sequence ${engine.name()} ${mobile ? "iPhone" : "desktop"}`,
      );
    }
    // Independent real-time cleanup with CSS animations disabled.
    const context = await browser.newContext();
    const page = await context.newPage();
    if (!process.env.BASE_URL)
      await page.route("**/rest/v1/rpc/list_public_properties", (r) =>
        r.fulfill({ json: fixture }),
      );
    await page.addInitScript(() => {
      window.welcomeTimes = [];
      new MutationObserver((records) =>
        records.forEach((r) => {
          for (const n of r.addedNodes)
            if (n.nodeType === 1 && n.matches(".vc-welcome"))
              window.welcomeTimes.push(performance.now());
          for (const n of r.removedNodes)
            if (n.nodeType === 1 && n.matches(".vc-welcome"))
              window.welcomeTimes.push(performance.now());
        }),
      ).observe(document, { childList: true, subtree: true });
    });
    await page.goto(base + "/index.html", { waitUntil: "domcontentloaded" });
    await page.addStyleTag({
      content: ".vc-welcome,.vc-welcome *{animation:none!important}",
    });
    await page.waitForFunction(
      () => window.welcomeTimes.length === 2,
      {},
      { timeout: 7500 },
    );
    const elapsed = await page.evaluate(
      () => welcomeTimes[1] - welcomeTimes[0],
    );
    assert.ok(
      elapsed >= 5400 && elapsed < 6500,
      `fallback duration ${elapsed}`,
    );
    await context.close();
    const reduced = await browser.newContext({ reducedMotion: "reduce" });
    const reducedPage = await reduced.newPage();
    await reducedPage.goto(base + "/index.html", {
      waitUntil: "domcontentloaded",
    });
    assert.equal(await reducedPage.locator(".vc-welcome").count(), 0);
    await reduced.close();
    const restricted = await browser.newContext();
    const restrictedPage = await restricted.newPage();
    await restrictedPage.addInitScript(() =>
      Object.defineProperty(window, "sessionStorage", {
        value: {
          getItem() {
            throw Error("Storage denied");
          },
          setItem() {
            throw Error("Storage denied");
          },
        },
      }),
    );
    await restrictedPage.goto(base + "/index.html", {
      waitUntil: "domcontentloaded",
    });
    assert.equal(await restrictedPage.locator(".vc-welcome").count(), 0);
    await restricted.close();
    console.log(
      `PASS welcome fallback, reduced motion, restricted storage ${engine.name()}`,
    );
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
