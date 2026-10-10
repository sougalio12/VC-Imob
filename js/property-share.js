(function () {
  "use strict";

  const PUBLIC_SITE_ORIGIN = "https://valdineycapistranoimoveis.com.br";

  function publicPropertyUrl(property) {
    const code = String(property?.codigo || property?.code || "").trim().toUpperCase();
    if (!/^VCI\d{6}$/.test(code)) return "";
    const url = new URL("/imovel.html", PUBLIC_SITE_ORIGIN);
    url.searchParams.set("codigo", code);
    return url.href;
  }

  function propertyShareContent(property) {
    const code = String(property?.codigo || property?.code || "").trim().toUpperCase();
    const title = String(property?.titulo || property?.title || "Imóvel").trim();
    const rawPrice = property?.preco ?? property?.price;
    const price = Number(rawPrice);
    const formattedPrice = Number.isFinite(price) && price > 0
      ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(price)
      : "";
    return {
      title: [code, title].filter(Boolean).join(" — "),
      text: [[code, title].filter(Boolean).join(" — "), formattedPrice, "Veja este imóvel:"].filter(Boolean).join("\n"),
      url: publicPropertyUrl(property)
    };
  }

  function isMobileShareAvailable() {
    const coarsePointer = window.matchMedia?.("(pointer: coarse)")?.matches;
    return typeof navigator.share === "function" && (coarsePointer || window.innerWidth <= 820);
  }

  async function copyText(value) {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return;
    }
    const input = document.createElement("textarea");
    input.value = value;
    input.setAttribute("readonly", "");
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.append(input);
    input.select();
    const copied = document.execCommand("copy");
    input.remove();
    if (!copied) throw new Error("COPY_FAILED");
  }

  async function shareProperty(property) {
    const content = propertyShareContent(property);
    if (!content.url) return { status: "unavailable" };
    if (isMobileShareAvailable()) {
      try {
        await navigator.share(content);
        return { status: "shared", url: content.url };
      } catch (error) {
        if (error?.name === "AbortError") return { status: "cancelled", url: content.url };
      }
    }
    await copyText(content.url);
    return { status: "copied", url: content.url };
  }

  window.VCPropertyShare = { publicPropertyUrl, propertyShareContent, shareProperty };
})();
