/* VC Imob 2.0: progressive enhancement, no CRM/database writes */
(() => {
  "use strict";
  const $ = (s) => document.querySelector(s),
    byId = (s) => document.getElementById(s);
  const status = document.createElement("p");
  status.id = "vcCatalogStatus";
  status.setAttribute("role", "status");
  status.hidden = true;
  byId("propertiesGrid")?.before(status);
  const catalogStatus = (source) => {
    status.hidden = source === "rpc";
    status.textContent =
      "Catálogo temporariamente em contingência. Confirme valores e disponibilidade com o atendimento.";
  };
  addEventListener("vc:catalog-source", (e) => catalogStatus(e.detail));
  if (window.vcCatalogSource) catalogStatus(window.vcCatalogSource);
  const header = $(".site-header");
  const updateHeader = () =>
    header?.classList.toggle("vc-compact", scrollY > 60);
  addEventListener("scroll", updateHeader, { passive: true });
  updateHeader();
  const hero = $(".hero h1");
  if (hero) hero.textContent = "Encontre seu próximo imóvel.";
  const desc = $(".hero-description");
  if (desc)
    desc.textContent =
      "Compra e locação em Lucas do Rio Verde, com atendimento próximo e transparente.";
  const buyLink = document.querySelector('#mainNav a[href="#imoveis"]');
  if (buyLink) {
    buyLink.textContent = "Comprar";
    buyLink.href = "./index.html?catalogo=1&modalidade=venda#imoveis";
    const li = buyLink.closest("li").cloneNode(true);
    li.querySelector("a").textContent = "Alugar";
    li.querySelector("a").href =
      "./index.html?catalogo=1&modalidade=locacao#imoveis";
    buyLink.closest("li").after(li);
  }
  const heading = $("#imoveis .section-title");
  if (heading) heading.textContent = "Imóveis disponíveis";
  const intro = $("#imoveis .section-description");
  if (intro)
    intro.textContent = "Confira as oportunidades de compra e locação.";
  const cta = $("#anunciar .sell-cta");
  if (cta) {
    const title = cta.querySelector("h2");
    if (title) title.textContent = "Seu imóvel merece a apresentação certa.";
    const p = cta.querySelector("p");
    if (p)
      p.textContent =
        "Conte com a VC Imob para apresentar seu imóvel a quem procura comprar ou alugar.";
    const link = cta.querySelector("a");
    if (link) {
      link.textContent = "Anunciar meu imóvel";
      link.href =
        "https://wa.me/" +
        SITE_CONFIG.contato.whatsapp +
        "?text=" +
        encodeURIComponent(
          "Olá! Tenho um imóvel em Lucas do Rio Verde e gostaria de saber como anunciá-lo pela VC Imob.",
        );
    }
  }

  // Keep legacy lead capture and share handlers; enhance the generated cards after rendering.
  try {
    const originalRender = renderizarImoveis;
    renderizarImoveis = function (items) {
      if (window.vcCatalogSelect) items = window.vcCatalogSelect(items);
      originalRender(items);
      const lookup = new Map(
        (Array.isArray(items) ? items : []).map((p) => [String(p.codigo), p]),
      );
      document
        .querySelectorAll("#propertiesGrid .property-card")
        .forEach((card) => {
          const code = card
            .querySelector(".property-code")
            ?.textContent?.replace(/Código:\s*/i, "")
            .trim();
          const p = lookup.get(code);
          if (!p) return;
          const rent = String(p.finalidade || p.purpose || "venda")
            .toLowerCase()
            .includes("loc");
          const badge = card.querySelector(".property-badge");
          if (badge) {
            badge.textContent = rent ? "PARA ALUGAR" : "À VENDA";
            badge.classList.toggle("vc-rental-badge", rent);
          }
          const small = card.querySelector(".property-price small");
          if (small)
            small.textContent = rent ? "Aluguel mensal" : "Valor de venda";
          const price = card.querySelector(".property-price strong");
          if (price && rent) {
            price.textContent =
              p.preco == null || p.preco === ""
                ? "Consulte o valor"
                : Number.isFinite(Number(p.preco)) && Number(p.preco) > 0
                  ? new Intl.NumberFormat("pt-BR", {
                      style: "currency",
                      currency: "BRL",
                      minimumFractionDigits: Number.isInteger(Number(p.preco))
                        ? 0
                        : 2,
                      maximumFractionDigits: 2,
                    }).format(Number(p.preco)) + "/mês"
                  : "Consulte o valor";
          }
          const features = card.querySelector(".property-features");
          if (features) {
            while (features.children.length > 3)
              features.lastElementChild.remove();
          }
          const title = card.querySelector(".property-title");
          const image = card.querySelector(".property-image");
          if (title && image) {
            const link = document.createElement("a");
            link.href = image.href;
            link.textContent = title.textContent;
            title.replaceChildren(link);
          }
        });
    };
  } catch (error) {
    console.warn("Aprimoramento dos cartões indisponível", error);
  }

  const searchGrid = $(".search-grid"),
    locationInput = byId("searchLocation"),
    type = byId("searchType");
  if (searchGrid && locationInput && type) {
    const purpose = document.createElement("div");
    purpose.className = "vc-purpose";
    purpose.setAttribute("role", "group");
    purpose.setAttribute("aria-label", "Modalidade");
    purpose.innerHTML =
      '<button type="button" data-purpose="" aria-pressed="true">Todos</button><button type="button" data-purpose="venda" aria-pressed="false">Comprar</button><button type="button" data-purpose="locacao" aria-pressed="false">Alugar</button>';
    searchGrid.parentNode.insertBefore(purpose, searchGrid);
    const neighborhood = document.createElement("select");
    neighborhood.id = "vcNeighborhood";
    neighborhood.setAttribute("aria-label", "Bairro");
    neighborhood.innerHTML = '<option value="">Todos os bairros</option>';
    locationInput.replaceWith(neighborhood);
    const locationField = neighborhood.closest(".form-field");
    locationField
      ?.querySelector("label")
      ?.setAttribute("for", "vcNeighborhood");
    if (locationField?.querySelector("label"))
      locationField.querySelector("label").textContent = "Bairro";
    const price = byId("searchPrice");
    price?.closest(".form-field")?.remove();
    const originalSearch = byId("searchButton");
    const originalType = type;
    let urlParams = new URLSearchParams(window.location.search);
    let full = urlParams.get("catalogo") === "1";
    let mode = ["venda", "locacao"].includes(urlParams.get("modalidade"))
      ? urlParams.get("modalidade")
      : "";
    const normalized = (s) =>
      String(s || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
    function properties() {
      try {
        return Array.isArray(todosImoveis) ? todosImoveis : [];
      } catch {
        return [];
      }
    }
    function kind(p) {
      return normalized(
        p.finalidade || p.purpose || p.modalidade || p.negocio || "venda",
      ).includes("loc")
        ? "locacao"
        : "venda";
    }
    function refresh() {
      const source = properties().filter(
        (p) => p.ativo !== false && (!mode || kind(p) === mode),
      );
      const neighborhoods = [
        ...new Set(
          source
            .map((p) => String(p.bairro || p.neighborhood || "").trim())
            .filter(Boolean),
        ),
      ].sort((a, b) => a.localeCompare(b, "pt-BR"));
      const current =
        neighborhood.value ||
        (!neighborhood.dataset.initialized
          ? urlParams.get("bairro") || ""
          : "");
      neighborhood.dataset.initialized = "1";
      neighborhood.replaceChildren(
        new Option("Todos os bairros", ""),
        ...neighborhoods.map((v) => new Option(v, v)),
      );
      if (current && !neighborhoods.includes(current))
        neighborhood.add(new Option(current, current));
      neighborhood.value = current;
      const filtered = source.filter(
        (p) =>
          !neighborhood.value ||
          normalized(p.bairro || p.neighborhood) ===
            normalized(neighborhood.value),
      );
      const types = [
        ...new Set(
          filtered
            .map((p) => String(p.tipo || p.type || "").trim())
            .filter(Boolean),
        ),
      ].sort((a, b) => a.localeCompare(b, "pt-BR"));
      const chosen =
        originalType.value ||
        (!originalType.dataset.initialized ? urlParams.get("tipo") || "" : "");
      originalType.dataset.initialized = "1";
      originalType.replaceChildren(
        new Option("Todos os tipos", ""),
        ...types.map((v) => new Option(v, v)),
      );
      if (chosen && !types.includes(chosen))
        originalType.add(new Option(chosen, chosen));
      originalType.value = chosen;
    }
    window.vcCatalogSelect = (items) => {
      const results = items.filter(
        (p) =>
          p.ativo !== false &&
          (!mode || kind(p) === mode) &&
          (!neighborhood.value ||
            normalized(p.bairro) === normalized(neighborhood.value)) &&
          (!originalType.value ||
            normalized(p.tipo) === normalized(originalType.value)),
      );
      return full ? results : results.slice(0, 6);
    };
    function search() {
      const results = properties().filter(
        (p) =>
          p.ativo !== false &&
          (!mode || kind(p) === mode) &&
          (!neighborhood.value ||
            normalized(p.bairro || p.neighborhood) ===
              normalized(neighborhood.value)) &&
          (!originalType.value ||
            normalized(p.tipo || p.type) === normalized(originalType.value)),
      );
      if (typeof renderizarImoveis === "function")
        renderizarImoveis(full ? results : results.slice(0, 6));
      const empty = byId("propertiesEmpty");
      if (empty) empty.style.display = results.length ? "none" : "block";
      const link = byId("vcAllProperties");
      if (link) {
        link.hidden = full || !results.length;
        const q = new URLSearchParams();
        if (mode) q.set("modalidade", mode);
        if (neighborhood.value) q.set("bairro", neighborhood.value);
        if (originalType.value) q.set("tipo", originalType.value);
        q.set("catalogo", "1");
        link.querySelector("a").href =
          "./index.html?" + q.toString() + "#imoveis";
      }
    }
    purpose
      .querySelectorAll("button")
      .forEach((x) =>
        x.setAttribute("aria-pressed", String(x.dataset.purpose === mode)),
      );
    if (full) {
      document.body.classList.add("vc-catalog-full");
      const title = $("#imoveis .section-title");
      if (title) title.textContent = "Todos os imóveis";
    }
    function syncUrl() {
      const q = new URLSearchParams(location.search);
      for (const [key, value] of [
        ["modalidade", mode],
        ["bairro", neighborhood.value],
        ["tipo", originalType.value],
      ]) {
        if (value) q.set(key, value);
        else q.delete(key);
      }
      history.pushState(
        null,
        "",
        location.pathname + (q.size ? "?" + q : "") + location.hash,
      );
    }
    addEventListener("popstate", () => {
      urlParams = new URLSearchParams(location.search);
      mode = urlParams.get("modalidade") || "";
      full = urlParams.get("catalogo") === "1";
      document.body.classList.toggle("vc-catalog-full", full);
      neighborhood.value = "";
      originalType.value = "";
      delete neighborhood.dataset.initialized;
      delete originalType.dataset.initialized;
      refresh();
      purpose
        .querySelectorAll("button")
        .forEach((x) =>
          x.setAttribute("aria-pressed", String(x.dataset.purpose === mode)),
        );
      search();
    });
    purpose.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-purpose]");
      if (!b) return;
      mode = b.dataset.purpose;
      purpose
        .querySelectorAll("button")
        .forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      refresh();
      search();
      syncUrl();
    });
    neighborhood.addEventListener("change", () => {
      refresh();
      search();
      syncUrl();
    });
    originalType.addEventListener("change", () => {
      search();
      syncUrl();
    });
    originalSearch?.addEventListener(
      "click",
      (e) => {
        e.stopImmediatePropagation();
        refresh();
        search();
      },
      true,
    );
    const grid = byId("propertiesGrid");
    if (grid) {
      const observer = new MutationObserver(() => {
        observer.disconnect();
        refresh();
        search();
      });
      observer.observe(grid, { childList: true });
    }
    refresh();
    const section = byId("imoveis");
    if (section) {
      const more = document.createElement("div");
      more.id = "vcAllProperties";
      more.className = "vc-all-link";
      more.hidden = true;
      more.innerHTML =
        '<a href="./index.html?catalogo=1#imoveis">Ver todos os imóveis ↗</a>';
      section.querySelector(".container")?.appendChild(more);
    }
  }
  const whatsapp = document.createElement("a");
  whatsapp.className = "vc-whatsapp";
  whatsapp.href =
    "https://wa.me/" +
    SITE_CONFIG.contato.whatsapp +
    "?text=" +
    encodeURIComponent(
      "Olá! Gostaria de conhecer os imóveis disponíveis na VC Imob.",
    );
  whatsapp.target = "_blank";
  whatsapp.rel = "noopener noreferrer";
  whatsapp.setAttribute("aria-label", "Conversar pelo WhatsApp");
  whatsapp.textContent = "✆";
  const legacyWhatsapp = $(".whatsapp-floating");
  if (legacyWhatsapp) legacyWhatsapp.replaceWith(whatsapp);
  else document.body.appendChild(whatsapp);
  document
    .querySelectorAll(
      'a[href="#categorias"],a[href="#noticias"],a[href="#financiamento"]',
    )
    .forEach((a) => a.closest("li")?.remove());
  document.querySelectorAll(".footer-column").forEach((column) => {
    const list = column.querySelector("ul");
    if (list && !list.children.length) column.remove();
  });
  const menu = byId("mobileMenuButton");
  const nav = byId("mainNav");
  const closeMenu = () => {
    nav?.classList.remove("is-open");
    document.body.classList.remove("menu-open", "vc-mobile-open");
    menu?.setAttribute("aria-expanded", "false");
    if (nav?.contains(document.activeElement)) menu?.focus();
  };
  menu?.setAttribute("aria-expanded", "false");
  addEventListener("resize", () => {
    if (innerWidth > 1100) closeMenu();
  });
  menu?.setAttribute("aria-controls", "mainNav");
  menu?.addEventListener("click", () => {
    setTimeout(() => {
      const open = nav?.classList.contains("is-open");
      document.body.classList.toggle("vc-mobile-open", !!open);
      menu.setAttribute("aria-expanded", String(!!open));
      if (open) nav.querySelector("a")?.focus();
    }, 0);
  });
  nav
    ?.querySelectorAll("a")
    .forEach((a) => a.addEventListener("click", closeMenu));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeMenu();
    if (e.key === "Tab" && nav?.classList.contains("is-open")) {
      const nodes = [menu, ...nav.querySelectorAll("a")];
      e.preventDefault();
      const index = nodes.indexOf(document.activeElement);
      const next =
        (index + (e.shiftKey ? -1 : 1) + nodes.length) % nodes.length;
      nodes[next].focus();
    }
  });
  document.addEventListener("click", (e) => {
    if (
      nav?.classList.contains("is-open") &&
      !nav.contains(e.target) &&
      !menu?.contains(e.target)
    )
      closeMenu();
  });
  try {
    if (!sessionStorage.getItem("vcimob-welcome")) {
      sessionStorage.setItem("vcimob-welcome", "1");
      if (
        !matchMedia("(prefers-reduced-motion: reduce)").matches &&
        !window.location.pathname.includes("imovel")
      ) {
        const splash = document.createElement("div");
        splash.className = "vc-welcome";
        splash.setAttribute("role", "region");
        splash.setAttribute("aria-label", "Boas-vindas à VC Imob");
        splash.innerHTML =
          '<img src="./assets/images/4d6f85cd-fe07-4c5c-bbbf-be216a48a1b1.jpeg" alt="VC Imob"><h2>Bem-vindo à VC Imob.</h2><p>Onde novos caminhos encontram seu endereço.</p><button type="button">Pular apresentação</button>';
        document.body.appendChild(splash);
        let done = false;
        const close = () => {
          if (done) return;
          done = true;
          splash.classList.add("vc-out");
          setTimeout(() => splash.remove(), 420);
        };
        splash.querySelector("button").addEventListener("click", close);
        document.addEventListener("keydown", close, { once: true });
        setTimeout(close, 1800);
      }
    }
  } catch {}
})();
