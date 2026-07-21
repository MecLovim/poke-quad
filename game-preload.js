// Preload aplicado às sessões dos quatro slots. Os switches do Chromium em
// main.js impedem o *navegador* de estrangular a página em segundo plano; este
// arquivo trata do outro lado do problema: a própria página pausando sozinha
// ao perceber que perdeu foco, e o requestAnimationFrame que para de ser
// chamado quando a janela é minimizada e o compositor não gera mais frames.

const { webFrame } = require('electron');

// Roda no mundo principal da página (webFrame.executeJavaScript atravessa o
// contextIsolation) e antes dos scripts do jogo, então nada é capturado por
// referência antes de estar remendado.
function manterJogoAtivo() {
  const FALLBACK_MS = 100;

  /* ---------- A página nunca fica oculta ---------- */

  const sempre = (valor) => ({ get: () => valor, configurable: true });
  try {
    Object.defineProperty(Document.prototype, 'hidden', sempre(false));
    Object.defineProperty(Document.prototype, 'visibilityState', sempre('visible'));
    Object.defineProperty(Document.prototype, 'webkitHidden', sempre(false));
    Object.defineProperty(Document.prototype, 'webkitVisibilityState', sempre('visible'));
    document.hasFocus = () => true;
  } catch {}

  /* ---------- Eventos de "perdi o foco" não chegam ao jogo ---------- */

  // Só os disparados na janela/documento: um blur de <input> precisa continuar
  // passando, senão quebra os campos de login e formulários do jogo.
  const ENGOLIR = ['visibilitychange', 'webkitvisibilitychange', 'blur', 'pagehide', 'freeze'];
  for (const tipo of ENGOLIR) {
    const bloqueia = (e) => {
      if (e.isTrusted && (e.target === window || e.target === document)) {
        e.stopImmediatePropagation();
      }
    };
    window.addEventListener(tipo, bloqueia, true);
    document.addEventListener(tipo, bloqueia, true);
  }

  /* ---------- requestAnimationFrame com rede de segurança ---------- */

  // Com a janela minimizada o Chromium para de produzir frames e o rAF nativo
  // simplesmente nunca chama de volta — nenhum switch resolve isso. Cada pedido
  // ganha um timer paralelo; quem chegar primeiro executa e cancela o outro.
  // Em primeiro plano o rAF (~16ms) sempre vence o timer (100ms) e a animação
  // segue no vsync normal; escondido, o loop continua girando a ~10fps.
  const rafNativo = window.requestAnimationFrame.bind(window);
  const cafNativo = window.cancelAnimationFrame.bind(window);
  const pendentes = new Map();
  let proximoId = 1;

  window.requestAnimationFrame = (callback) => {
    const id = proximoId++;
    const executa = (timestamp) => {
      const entrada = pendentes.get(id);
      if (!entrada) return;
      pendentes.delete(id);
      cafNativo(entrada.raf);
      clearTimeout(entrada.timer);
      callback(typeof timestamp === 'number' ? timestamp : performance.now());
    };
    pendentes.set(id, {
      raf: rafNativo(executa),
      timer: setTimeout(() => executa(performance.now()), FALLBACK_MS)
    });
    return id;
  };

  window.cancelAnimationFrame = (id) => {
    const entrada = pendentes.get(id);
    if (!entrada) return;
    pendentes.delete(id);
    cafNativo(entrada.raf);
    clearTimeout(entrada.timer);
  };
}

webFrame.executeJavaScript(`(${manterJogoAtivo.toString()})();`);
