(async function () {
  "use strict";
  const root = document.getElementById("selectionRoot"), token = new URLSearchParams(location.search).get("token") || "";
  const api = async (name, body) => {
    const response = await fetch(`${CRM_CONFIG.supabaseUrl}/rest/v1/rpc/${name}`, { method: "POST", headers: { apikey: CRM_CONFIG.supabasePublishableKey, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!response.ok) throw new Error("Não foi possível abrir esta seleção.");
    return response.json();
  };
  const element = (tag, options = {}) => { const node = document.createElement(tag); if (options.className) node.className = options.className; if (options.text != null) node.textContent = options.text; for (const [key, value] of Object.entries(options.attrs || {})) node.setAttribute(key, value); return node; };
  const money = value => value == null ? "Preço sob consulta" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: Number(value) % 1 ? 2 : 0 }).format(value);
  const fail = message => { const state = element("section", { className: "selection-state" }); state.append(element("h1", { text: "Link indisponível" }), element("p", { text: message })); root.replaceChildren(state); };
  if (!/^[a-f0-9]{64}$/i.test(token)) { fail("Confira se o endereço recebido está completo."); return; }
  try {
    const selection = await api("get_client_selection", { selection_token: token });
    if (!selection?.properties?.length) throw new Error("Este link expirou, foi revogado ou não possui imóveis publicados.");
    const intro = element("section", { className: "selection-intro" }); intro.append(element("span", { className: "selection-code", text: "Seleção preparada para você" }), element("h1", { text: selection.title }), element("p", { text: selection.note || "Conheça os imóveis selecionados de acordo com o seu interesse." }));
    const grid = element("section", { className: "selection-grid" });
    selection.properties.forEach(property => {
      const card = element("article", { className: "selection-card" }), image = element("img", { attrs: { src: property.imagens?.[0] || "", alt: property.imagensAlt?.[0] || property.titulo || "Imóvel", loading: "lazy", decoding: "async" } }), body = element("div", { className: "selection-body" });
      body.append(element("span", { className: "selection-code", text: property.codigo }), element("h2", { text: property.titulo }), element("p", { text: [property.bairro, property.cidade].filter(Boolean).join(" · ") }), element("strong", { className: "selection-price", text: money(property.preco) }));
      const actions = element("div", { className: "selection-actions" }), open = element("a", { text: "Ver imóvel", attrs: { href: `./imovel.html?codigo=${encodeURIComponent(property.codigo)}`, target: "_blank", rel: "noopener" } }), favorite = element("button", { text: "☆ Favoritar", attrs: { type: "button", "aria-pressed": "false" } }), comment = element("textarea", { className: "selection-comment", attrs: { maxlength: "1000", placeholder: "Comentário opcional", "aria-label": `Comentário sobre ${property.codigo}` } }), status = element("p", { className: "selection-feedback-status", attrs: { role: "status" } }); actions.append(open, favorite);
      favorite.addEventListener("click", async () => { const active = favorite.getAttribute("aria-pressed") !== "true"; favorite.disabled = true; try { await api("set_client_favorite", { selection_token: token, target_property: property.selection_property_id, target_favorite: active }); favorite.setAttribute("aria-pressed", String(active)); favorite.textContent = active ? "★ Favorito" : "☆ Favoritar"; status.textContent = active ? "Imóvel adicionado aos favoritos." : "Imóvel removido dos favoritos."; } catch { status.textContent = "Não foi possível atualizar o favorito agora."; } finally { favorite.disabled = false; } });
      [["Gostei", "liked"], ["Talvez", "maybe"], ["Não gostei", "disliked"], ["Quero visitar", "visit_requested"]].forEach(([label, reaction]) => { const button = element("button", { text: label, className: reaction === "visit_requested" ? "is-primary" : "", attrs: { type: "button" } }); button.addEventListener("click", async () => { button.disabled = true; status.textContent = "Salvando…"; try { await api("submit_client_feedback", { selection_token: token, target_property: property.selection_property_id, target_reaction: reaction, target_comment: comment.value }); status.textContent = "Resposta registrada. Seu corretor poderá acompanhar."; } catch { status.textContent = "Não foi possível registrar agora. Tente novamente."; } finally { button.disabled = false; } }); actions.append(button); });
      body.append(actions, comment, status); card.append(image, body); grid.append(card);
    }); root.replaceChildren(intro, grid);
  } catch (error) { fail(error.message); }
})();
