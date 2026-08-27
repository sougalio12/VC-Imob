/* =========================================================
   PÁGINA INDIVIDUAL DE IMÓVEL
   ========================================================= */

const propertyDetailState = {
  property: null,
  images: [],
  activeImage: 0
};

function escapeHTML(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatPrice(value) {
  const price = Number(value);

  if (!Number.isFinite(price) || price <= 0) {
    return "Sob consulta";
  }

  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0
  }).format(price);
}

function propertyLocation(property) {
  if (property.enderecoExibir) return property.enderecoExibir;
  return [property.bairro, property.cidade, property.estado]
    .filter(Boolean)
    .join(" • ");
}

function propertyArea(property) {
  if (property.areaConstruida) return `${property.areaConstruida} m²`;
  if (property.areaTotal) return `${property.areaTotal} ${property.unidadeAreaTotal || "m²"}`;
  return null;
}

function updateSeo(property) {
  const title = property.titulo || "Imóvel";
  const description = property.descricao || `Detalhes do imóvel ${property.codigo || ""}.`;
  const metaDescription = document.querySelector('meta[name="description"]');

  document.title = `${title} | Valdiney Capistrano Imóveis`;

  if (metaDescription) {
    metaDescription.setAttribute("content", description);
  }
}

function getWhatsAppNumber() {
  return SITE_CONFIG?.contato?.whatsapp || "";
}

function openWhatsAppForProperty() {
  const property = propertyDetailState.property;
  const number = getWhatsAppNumber();

  if (!property || !number) {
    return;
  }

  const message = `Olá, tenho interesse no imóvel ${property.codigo || ""} - ${property.titulo || ""}.`;
  const url = `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
  const continueToWhatsApp = () => window.open(url, "_blank", "noopener,noreferrer");

  if (window.siteLeadCapture?.openInterestFlow && property.codigo) {
    window.siteLeadCapture.openInterestFlow({
      propertyCode: property.codigo,
      propertyTitle: property.titulo || "",
      onContinue: continueToWhatsApp
    });
    return;
  }

  continueToWhatsApp();
}

function openGeneralWhatsApp() {
  const number = getWhatsAppNumber();
  const message = SITE_CONFIG?.contato?.mensagemWhatsapp || "Olá! Gostaria de mais informações.";

  if (number) {
    window.open(`https://wa.me/${number}?text=${encodeURIComponent(message)}`, "_blank", "noopener,noreferrer");
  }
}

function renderNotFound() {
  document.getElementById("propertyDetailRoot").innerHTML = `
    <section class="property-empty-state">
      <p class="section-label">Imóvel não encontrado</p>
      <h1>Este imóvel não está disponível.</h1>
      <p>Confira outros imóveis anunciados ou volte para a listagem.</p>
      <a class="btn btn-primary" href="./index.html#imoveis">Ver imóveis</a>
    </section>
  `;
}

function imageAlt(property, index) {
  return `${property.titulo || "Imóvel"} — foto ${index + 1}`;
}

function renderProperty(property) {
  const root = document.getElementById("propertyDetailRoot");
  const images = Array.isArray(property.imagens)
    ? property.imagens.filter(Boolean)
    : [];
  const facts = [
    propertyArea(property) ? ["Área", escapeHTML(propertyArea(property))] : null,
    property.quartos ? ["Quartos", escapeHTML(property.quartos)] : null,
    property.suites ? ["Suítes", escapeHTML(property.suites)] : null,
    property.banheiros ? ["Banheiros", escapeHTML(property.banheiros)] : null,
    property.vagas ? ["Vagas", escapeHTML(property.vagas)] : null
  ].filter(Boolean);
  const characteristics = Array.isArray(property.caracteristicas)
    ? property.caracteristicas.filter(Boolean)
    : [];

  propertyDetailState.property = property;
  propertyDetailState.images = images;
  propertyDetailState.activeImage = 0;
  updateSeo(property);

  root.innerHTML = `
    <div class="property-breadcrumb"><a href="./index.html#imoveis">Imóveis</a> <span aria-hidden="true">/</span> ${escapeHTML(property.codigo || "Detalhes")}</div>

    <section class="property-detail-header">
      <div>
        <p class="property-detail-code">Código: ${escapeHTML(property.codigo || "Não informado")}</p>
        <h1 class="property-detail-title">${escapeHTML(property.titulo || "Imóvel à venda")}</h1>
        <p class="property-detail-location">${escapeHTML(propertyLocation(property) || "Localização não informada")}</p>
      </div>
      <div class="property-detail-price"><small>Valor</small><strong>${formatPrice(property.preco)}</strong></div>
    </section>

    ${images.length ? `
      <section class="property-gallery" aria-label="Galeria de fotos do imóvel">
        <button class="property-gallery-main" type="button" id="galleryMainButton" aria-label="Ampliar foto principal">
          <img id="galleryMainImage" src="${escapeHTML(images[0])}" alt="${escapeHTML(imageAlt(property, 0))}">
        </button>
        <div class="property-thumbnails" id="propertyThumbnails">
          ${images.map((image, index) => `
            <button class="property-thumbnail${index === 0 ? " is-active" : ""}" type="button" data-image-index="${index}" aria-label="Ver foto ${index + 1}" aria-current="${index === 0 ? "true" : "false"}">
              <img src="${escapeHTML(image)}" alt="${escapeHTML(imageAlt(property, index))}" loading="${index === 0 ? "eager" : "lazy"}">
            </button>
          `).join("")}
        </div>
      </section>
    ` : ""}

    <section class="property-detail-layout">
      <div>
        ${facts.length ? `
          <section class="property-info-panel">
            <h2>Informações do imóvel</h2>
            <div class="property-facts">
              ${facts.map(([label, value]) => `<div class="property-fact"><span>${label}</span><strong>${value}</strong></div>`).join("")}
            </div>
          </section>
        ` : ""}

        ${characteristics.length ? `
          <section class="property-info-panel">
            <h2>Características</h2>
            <ul class="property-characteristics">
              ${characteristics.map(item => `<li>${escapeHTML(item)}</li>`).join("")}
            </ul>
          </section>
        ` : ""}

        ${property.descricao ? `
          <section class="property-info-panel">
            <h2>Descrição</h2>
            <p class="property-description">${escapeHTML(property.descricao)}</p>
          </section>
        ` : ""}
      </div>

      <aside class="property-contact-panel">
        <h2>Gostou deste imóvel?</h2>
        <p>Fale com Valdiney Capistrano e receba mais informações.</p>
        <button class="btn btn-champagne" type="button" id="propertyWhatsAppButton">Tenho interesse neste imóvel</button>
      </aside>
    </section>
  `;

  const lightboxImage = document.getElementById("lightboxImage");
  if (lightboxImage && images.length) {
    lightboxImage.src = images[0];
    lightboxImage.alt = imageAlt(property, 0);
  }

  bindPropertyEvents();
}

function setActiveImage(index) {
  const { images, property } = propertyDetailState;

  if (!images.length || !property) {
    return;
  }

  const safeIndex = (index + images.length) % images.length;
  const mainImage = document.getElementById("galleryMainImage");

  propertyDetailState.activeImage = safeIndex;

  if (mainImage) {
    mainImage.src = images[safeIndex];
    mainImage.alt = imageAlt(property, safeIndex);
  }

  document.querySelectorAll(".property-thumbnail").forEach(button => {
    const isActive = Number(button.dataset.imageIndex) === safeIndex;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-current", String(isActive));
  });
}

function openLightbox() {
  const { images, property, activeImage } = propertyDetailState;
  const lightbox = document.getElementById("propertyLightbox");
  const image = document.getElementById("lightboxImage");

  if (!images.length || !property || !lightbox || !image) {
    return;
  }

  image.src = images[activeImage];
  image.alt = imageAlt(property, activeImage);
  lightbox.classList.add("is-open");
  lightbox.setAttribute("aria-hidden", "false");
  document.body.classList.add("lightbox-open");
  document.getElementById("lightboxClose").focus();
}

function closeLightbox() {
  const lightbox = document.getElementById("propertyLightbox");

  lightbox.classList.remove("is-open");
  lightbox.setAttribute("aria-hidden", "true");
  document.body.classList.remove("lightbox-open");
}

function moveLightbox(step) {
  setActiveImage(propertyDetailState.activeImage + step);

  const image = document.getElementById("lightboxImage");
  const { images, property, activeImage } = propertyDetailState;

  if (image && images.length && property) {
    image.src = images[activeImage];
    image.alt = imageAlt(property, activeImage);
  }
}

function bindPropertyEvents() {
  document.querySelectorAll(".property-thumbnail").forEach(button => {
    button.addEventListener("click", () => setActiveImage(Number(button.dataset.imageIndex)));
  });

  document.getElementById("galleryMainButton")?.addEventListener("click", openLightbox);
  document.getElementById("propertyWhatsAppButton")?.addEventListener("click", openWhatsAppForProperty);
}

async function loadProperty() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("codigo");
  const slug = params.get("slug");

  if (!code && !slug) {
    renderNotFound();
    return;
  }

  try {
    const file = SITE_CONFIG?.arquivos?.imoveis || "./data/imoveis.json";
    const response = await fetch(file, { cache: "no-store" });

    if (!response.ok) {
      throw new Error("Não foi possível carregar os imóveis.");
    }

    const properties = await response.json();
    const property = Array.isArray(properties)
      ? properties.find(item => item.ativo !== false && (item.codigo === code || item.slug === slug))
      : null;

    if (!property) {
      renderNotFound();
      return;
    }

    renderProperty(property);
  }
  catch (error) {
    console.error("Erro ao carregar imóvel:", error);
    renderNotFound();
  }
}

document.getElementById("headerWhatsAppButton")?.addEventListener("click", openGeneralWhatsApp);
document.getElementById("footerWhatsAppButton")?.addEventListener("click", openGeneralWhatsApp);
document.getElementById("mobileMenuButton")?.addEventListener("click", () => document.getElementById("mainNav")?.classList.toggle("is-open"));
document.getElementById("lightboxClose")?.addEventListener("click", closeLightbox);
document.getElementById("lightboxPrev")?.addEventListener("click", () => moveLightbox(-1));
document.getElementById("lightboxNext")?.addEventListener("click", () => moveLightbox(1));
document.getElementById("propertyLightbox")?.addEventListener("click", event => {
  if (event.target.id === "propertyLightbox") {
    closeLightbox();
  }
});
document.addEventListener("keydown", event => {
  const lightboxOpen = document.getElementById("propertyLightbox")?.classList.contains("is-open");

  if (!lightboxOpen) {
    return;
  }

  if (event.key === "Escape") closeLightbox();
  if (event.key === "ArrowLeft") moveLightbox(-1);
  if (event.key === "ArrowRight") moveLightbox(1);
});

document.getElementById("currentYear").textContent = new Date().getFullYear();
loadProperty();
