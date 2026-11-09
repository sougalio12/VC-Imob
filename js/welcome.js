/* Session-only welcome presentation. No network requests or application state changes. */
(() => {
  "use strict";
  const SESSION_KEY = "vcimob-welcome";
  const MAX_DURATION = 3800;
  let splash;
  let timeout;
  const close = () => {
    clearTimeout(timeout);
    splash?.remove();
    document.removeEventListener("visibilitychange", onVisibility);
  };
  let startedAt = 0;
  function onVisibility() {
    if (!document.hidden && performance.now() - startedAt >= MAX_DURATION)
      close();
  }
  function textElement(tag, text, start, stagger, exitStart, exitStagger) {
    const element = document.createElement(tag);
    const accessible = document.createElement("span");
    accessible.className = "visually-hidden";
    accessible.textContent = text;
    const visual = document.createElement("span");
    visual.setAttribute("aria-hidden", "true");
    let index = 0;
    text.split(" ").forEach((word, wordIndex) => {
      if (wordIndex) visual.appendChild(document.createTextNode(" "));
      const group = document.createElement("span");
      group.className = "vc-welcome__word";
      for (const character of Array.from(word)) {
        const letter = document.createElement("span");
        letter.className = "vc-welcome__letter";
        letter.textContent = character;
        letter.style.setProperty(
          "--vc-in-delay",
          `${start + index * stagger}ms`,
        );
        letter.style.setProperty(
          "--vc-out-delay",
          `${exitStart + index * exitStagger}ms`,
        );
        group.appendChild(letter);
        index += 1;
      }
      visual.appendChild(group);
    });
    element.append(accessible, visual);
    return element;
  }
  try {
    if (sessionStorage.getItem(SESSION_KEY)) return;
    sessionStorage.setItem(SESSION_KEY, "1");
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    splash = document.createElement("div");
    splash.className = "vc-welcome";
    splash.setAttribute("role", "region");
    splash.setAttribute("aria-label", "Boas-vindas à VC Imob");
    const logo = document.createElement("img");
    logo.src = "./assets/images/4d6f85cd-fe07-4c5c-bbbf-be216a48a1b1.jpeg";
    logo.alt = "VC Imob";
    logo.width = 1600;
    logo.height = 865;
    logo.decoding = "async";
    splash.append(
      logo,
      textElement("h2", "Bem-vindo à VC Imob.", 250, 18, 2400, 8),
      textElement(
        "p",
        "Onde novos caminhos encontram seu endereço.",
        800,
        12,
        2450,
        8,
      ),
    );
    startedAt = performance.now();
    // This timer is independent of CSS and animationend, including failed animations.
    timeout = setTimeout(close, MAX_DURATION);
    splash.addEventListener("animationend", (event) => {
      if (
        event.target === splash &&
        event.animationName === "vc-welcome-dissolve"
      )
        close();
    });
    document.addEventListener("visibilitychange", onVisibility);
    document.body.appendChild(splash);
  } catch {
    // Storage restrictions or unsupported APIs leave the home immediately usable.
    close();
  }
})();
