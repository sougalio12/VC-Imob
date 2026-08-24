/* =========================================================
   CAPS — ASSISTENTE VIRTUAL
   Valdiney Capistrano Imóveis
   ========================================================= */

const CAPS_CONFIG = {

  nome: "Caps",

  titulo: "Converse com o Caps",

  subtitulo: "Assistente virtual",

  apresentacao:
    "Olá! 👋 Eu sou o Caps, assistente virtual da Valdiney Capistrano Imóveis. Como posso ajudar você hoje?",

  mensagemForaHorario:
    "Posso adiantar seu atendimento por aqui e, se precisar, encaminho você para falar diretamente com o Valdiney pelo WhatsApp.",

  opcoes: [

    {
      id: "comprar",
      titulo: "🏠 Quero comprar um imóvel",
      resposta:
        "Perfeito! Posso ajudar você a encontrar imóveis à venda em Lucas do Rio Verde.",
      mensagemWhatsapp:
        "Olá, Valdiney! Vim pelo site e estou procurando um imóvel para comprar em Lucas do Rio Verde."
    },

    {
      id: "disponiveis",
      titulo: "🔎 Ver imóveis disponíveis",
      resposta:
        "Vou mostrar os imóveis disponíveis para venda.",
      acao: "mostrar-imoveis"
    },

    {
      id: "casa",
      titulo: "🏡 Quero comprar uma casa",
      resposta:
        "Ótimo! Vamos procurar casas à venda em Lucas do Rio Verde.",
      mensagemWhatsapp:
        "Olá, Valdiney! Vim pelo site e tenho interesse em comprar uma casa em Lucas do Rio Verde."
    },

    {
      id: "apartamento",
      titulo: "🏢 Quero um apartamento",
      resposta:
        "Posso ajudar você a encontrar apartamentos à venda em Lucas do Rio Verde.",
      mensagemWhatsapp:
        "Olá, Valdiney! Vim pelo site e tenho interesse em comprar um apartamento em Lucas do Rio Verde."
    },

    {
      id: "terreno",
      titulo: "📐 Quero comprar um terreno",
      resposta:
        "Vamos procurar terrenos disponíveis em Lucas do Rio Verde.",
      mensagemWhatsapp:
        "Olá, Valdiney! Vim pelo site e gostaria de informações sobre terrenos à venda em Lucas do Rio Verde."
    },

    {
      id: "rural",
      titulo: "🌾 Chácaras e fazendas",
      resposta:
        "Também podemos ajudar na busca por imóveis rurais.",
      mensagemWhatsapp:
        "Olá, Valdiney! Vim pelo site e gostaria de informações sobre chácaras ou fazendas à venda."
    },

    {
      id: "comercial",
      titulo: "🏬 Imóvel comercial",
      resposta:
        "Posso encaminhar seu interesse em imóveis comerciais.",
      mensagemWhatsapp:
        "Olá, Valdiney! Vim pelo site e estou procurando um imóvel comercial em Lucas do Rio Verde."
    },

    {
      id: "anunciar",
      titulo: "📣 Quero anunciar meu imóvel",
      resposta:
        "Claro! Vou ajudar você a enviar as informações do seu imóvel para o Valdiney.",
      acao: "anunciar-imovel"
    },

    {
      id: "avaliacao",
      titulo: "💰 Quero avaliar meu imóvel",
      resposta:
        "O Valdiney poderá conversar com você sobre a avaliação do imóvel.",
      mensagemWhatsapp:
        "Olá, Valdiney! Vim pelo site e gostaria de conversar sobre a avaliação do meu imóvel."
    },

    {
      id: "financiamento",
      titulo: "🏦 Financiamento",
      resposta:
        "Posso encaminhar você para receber mais informações sobre financiamento imobiliário.",
      mensagemWhatsapp:
        "Olá, Valdiney! Vim pelo site e gostaria de informações sobre financiamento imobiliário."
    },

    {
      id: "valdiney",
      titulo: "📲 Falar com o Valdiney",
      resposta:
        "Claro! Vou abrir o WhatsApp para você falar diretamente com o Valdiney.",
      acao: "whatsapp"
    }

  ]

};


/* =========================================================
   WHATSAPP
   ========================================================= */

function capsAbrirWhatsApp(mensagem) {

  const numero = SITE_CONFIG.contato.whatsapp;

  const texto =
    mensagem ||
    SITE_CONFIG.contato.mensagemWhatsapp;

  const url =
    `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`;

  window.open(
    url,
    "_blank",
    "noopener,noreferrer"
  );

}


/* =========================================================
   PROCESSAR ESCOLHA DO CLIENTE
   ========================================================= */

function capsSelecionarOpcao(id) {

  const opcao =
    CAPS_CONFIG.opcoes.find(
      item => item.id === id
    );

  if (!opcao) {
    return;
  }


  /* VER IMÓVEIS */

  if (opcao.acao === "mostrar-imoveis") {

    const secaoImoveis =
      document.getElementById("imoveis");

    if (secaoImoveis) {

      secaoImoveis.scrollIntoView({
        behavior: "smooth"
      });

    }

    return;
  }


  /* ANUNCIAR IMÓVEL */

  if (opcao.acao === "anunciar-imovel") {

    const secaoAnunciar =
      document.getElementById("anunciar");

    if (secaoAnunciar) {

      secaoAnunciar.scrollIntoView({
        behavior: "smooth"
      });

    }

    return;
  }


  /* FALAR DIRETAMENTE COM VALDINEY */

  if (opcao.acao === "whatsapp") {

    capsAbrirWhatsApp(
      SITE_CONFIG.contato.mensagemWhatsapp
    );

    return;
  }


  /* MENSAGENS ESPECÍFICAS */

  if (opcao.mensagemWhatsapp) {

    capsAbrirWhatsApp(
      opcao.mensagemWhatsapp
    );

  }

}


/* =========================================================
   RENDERIZAR OPÇÕES DO CAPS
   ========================================================= */

function capsRenderizarOpcoes() {

  const container =
    document.getElementById("capsOpcoes");

  if (!container) {
    return;
  }

  container.innerHTML = "";

  CAPS_CONFIG.opcoes.forEach(opcao => {

    const botao =
      document.createElement("button");

    botao.type = "button";

    botao.className =
      "caps-option";

    botao.textContent =
      opcao.titulo;

    botao.addEventListener(
      "click",
      () => capsSelecionarOpcao(opcao.id)
    );

    container.appendChild(botao);

  });

}


/* =========================================================
   ABRIR E FECHAR CAPS
   ========================================================= */

function capsAbrir() {

  const janela =
    document.getElementById("capsChat");

  if (!janela) {
    return;
  }

  janela.classList.add("caps-open");

}


function capsFechar() {

  const janela =
    document.getElementById("capsChat");

  if (!janela) {
    return;
  }

  janela.classList.remove("caps-open");

}


function capsAlternar() {

  const janela =
    document.getElementById("capsChat");

  if (!janela) {
    return;
  }

  janela.classList.toggle("caps-open");

}


/* =========================================================
   INICIALIZAÇÃO
   ========================================================= */

document.addEventListener(
  "DOMContentLoaded",
  () => {

    capsRenderizarOpcoes();

  }
);
