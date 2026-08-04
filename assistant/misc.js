// Dois observadores pequenos do próprio jogo:
//
// 1) Lembrete de presente diário — não sabemos o nome exato do botão de resgate
//    dentro do modal nessa versão do jogo (não deu pra abrir o modal de verdade
//    pra confirmar, só o botão do dock via title="Daily Gift"), então em vez de um
//    seletor CSS fixo procura por TEXTO ("Resgatar"/"Claim"/"Coletar", contagem
//    regressiva em HH:MM:SS ou "Xh Ym") — mais frágil a texto mudar de idioma, mas
//    não depende de uma classe interna que eu não consegui verificar.
// 2) Filtro do log de captura nativo — mesma lógica: acha linhas pela presença de
//    uma palavra de raridade conhecida, não por uma classe específica.
//
// Nenhum dos dois manda comando pro jogo: um só lê o texto do próprio botão do
// jogo, o outro só esconde/mostra linhas que o jogo já desenhou (display:none).

const { webFrame } = require('electron');

function iniciarAvisos() {
  if (!window.__PQA || !window.__PQA.core) {
    console.error('[PQA] core ausente antes de misc — abortando módulo');
    return;
  }
  if (window.__PQA.misc) return; // já inicializado

  const core = window.__PQA.core;
  const FEATURE = 'misc';

  /* ---------- Lembrete de presente diário ---------- */

  function extrairTempoMsDeTexto(texto) {
    if (!texto) return null;
    let m = texto.match(/(\d{1,2}):(\d{2}):(\d{2})/);
    if (m) return ((+m[1]) * 3600 + (+m[2]) * 60 + (+m[3])) * 1000;
    m = texto.match(/(\d+)\s*h\s*(\d+)\s*m/i);
    if (m) return ((+m[1]) * 60 + (+m[2])) * 60000;
    m = texto.match(/(\d+)\s*m\s*(\d+)\s*s/i);
    if (m) return ((+m[1]) * 60 + (+m[2])) * 1000;
    return null;
  }

  function formatarDuracao(ms) {
    const totalSeg = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(totalSeg / 3600);
    const m = Math.floor((totalSeg % 3600) / 60);
    const s = totalSeg % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function encontrarJanelaPorTexto(padroes) {
    const janelas = document.querySelectorAll('.win-window, [class*="win-"], [role="dialog"]');
    for (const win of janelas) {
      const inicio = (win.textContent || '').slice(0, 300);
      if (padroes.some((p) => p.test(inicio))) return win;
    }
    return null;
  }

  function processarJanelaDailyGift(win) {
    const botao = [...win.querySelectorAll('button')].find((b) => /resgatar|claim|coletar/i.test(b.textContent || ''));
    if (botao && !botao.disabled) {
      core.storage.remove(FEATURE, 'available-at');
      atualizarAbaAvisos();
      return;
    }
    const restanteMs = extrairTempoMsDeTexto(win.textContent);
    if (restanteMs !== null) {
      core.storage.set(FEATURE, 'available-at', Date.now() + restanteMs);
      atualizarAbaAvisos();
    }
  }

  setInterval(() => {
    const win = encontrarJanelaPorTexto([/daily gift/i, /presente di[aá]rio/i]);
    if (win) processarJanelaDailyGift(win);
  }, 2000);

  /* ---------- Filtro do log de captura nativo ---------- */

  const RARIDADES = ['fraca', 'comum', 'incomum', 'rara', 'épica', 'lendária', 'mítica', 'anciã', 'divina'];

  function acharLinhaAncestral(el) {
    let atual = el;
    for (let i = 0; i < 6 && atual; i++) {
      const rect = atual.getBoundingClientRect ? atual.getBoundingClientRect() : null;
      if (atual.children && atual.children.length && rect && rect.height > 20 && rect.height < 200) return atual;
      atual = atual.parentElement;
    }
    return el.parentElement || el;
  }

  function coletarLinhasDoLog(win) {
    const folhas = [...win.querySelectorAll('*')].filter((el) => {
      if (el.children.length !== 0) return false;
      const texto = (el.textContent || '').toLowerCase();
      return RARIDADES.some((r) => texto.includes(r));
    });
    return [...new Set(folhas.map(acharLinhaAncestral))];
  }

  function aplicarFiltroLog(win, raridadesEscolhidas, ivMinimo) {
    for (const linha of coletarLinhasDoLog(win)) {
      const texto = (linha.textContent || '').toLowerCase();
      const raridade = RARIDADES.find((r) => texto.includes(r));
      let mostrar = true;
      if (raridadesEscolhidas.length && (!raridade || !raridadesEscolhidas.includes(raridade))) mostrar = false;
      if (mostrar && ivMinimo > 0) {
        const ivMatch = texto.match(/iv\D{0,3}(\d+)/);
        if (ivMatch && Number(ivMatch[1]) < ivMinimo) mostrar = false;
      }
      if (mostrar) linha.style.removeProperty('display');
      else linha.style.setProperty('display', 'none', 'important');
    }
  }

  function garantirFiltroInjetado(win) {
    if (win.querySelector('#pqa-clog-filter-bar')) return;
    const barra = document.createElement('div');
    barra.id = 'pqa-clog-filter-bar';
    barra.className = 'pqa-clog-filter-bar';
    barra.innerHTML = `
      <span class="pqa-clog-filter-label">Filtro Poke Quad</span>
      ${RARIDADES.map((r) => `<label class="pqa-clog-chip"><input type="checkbox" value="${r}"> ${r}</label>`).join('')}
      <input type="number" min="0" max="192" placeholder="IV mín." id="pqa-clog-iv-min" class="pqa-clog-iv-input">
    `;
    win.prepend(barra);
    const aplicarAgora = () => {
      const escolhidas = [...barra.querySelectorAll('input[type="checkbox"]:checked')].map((i) => i.value);
      const ivMinimo = Number(barra.querySelector('#pqa-clog-iv-min').value) || 0;
      aplicarFiltroLog(win, escolhidas, ivMinimo);
    };
    barra.querySelectorAll('input').forEach((input) => input.addEventListener('input', aplicarAgora));
  }

  setInterval(() => {
    const win = encontrarJanelaPorTexto([/gerenciamento de captura/i, /capture log/i, /log de captura/i]);
    if (win) garantirFiltroInjetado(win);
  }, 1500);

  /* ---------- Aba "Avisos" ---------- */

  let avisosContainerRef = null;
  let intervaloAtualizacao = null;

  function atualizarAbaAvisos() {
    if (avisosContainerRef) renderAvisosTab(avisosContainerRef);
  }

  function renderAvisosTab(container) {
    const disponivelEm = core.storage.get(FEATURE, 'available-at', null);
    const agora = Date.now();
    const pronto = !disponivelEm || agora >= disponivelEm;

    container.innerHTML = `
      <div class="pqa-section-title">🎁 Presente diário</div>
      ${pronto
        ? '<div class="pqa-gift-ready">Deve estar disponível — abra pelo menu do jogo.</div>'
        : `<div class="pqa-gift-wait">Próximo em ${formatarDuracao(disponivelEm - agora)}</div>`}
      <div class="pqa-empty-hint">
        Abra o presente diário pelo dock do jogo pelo menos uma vez para eu conseguir
        ler a contagem regressiva certinho — sem isso não tenho como saber quando
        libera.
      </div>
      <div class="pqa-section-title">🔍 Filtro do log de captura</div>
      <div class="pqa-empty-hint">
        Abra o "Gerenciamento de Captura" do jogo — um filtro por raridade/IV
        aparece no topo da própria janela dele.
      </div>
    `;
  }

  /* ---------- Registro ---------- */

  const STYLE = `
    .pqa-gift-ready { color: #61f6a4; font-size: 11px; margin-bottom: 6px; }
    .pqa-gift-wait { color: #f1c644; font-size: 11px; margin-bottom: 6px; font-variant-numeric: tabular-nums; }
    .pqa-clog-filter-bar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      padding: 6px 10px;
      background: rgba(255,203,5,0.1);
      border-bottom: 1px solid rgba(255,203,5,0.3);
      font: 11px system-ui, sans-serif;
      color: #e8edf3;
    }
    .pqa-clog-filter-label { font-weight: 600; color: #ffcb05; }
    .pqa-clog-chip { display: flex; align-items: center; gap: 3px; cursor: pointer; }
    .pqa-clog-iv-input { width: 60px; padding: 2px 4px; }
  `;

  core.onPanelReady(() => {
    const styleEl = document.createElement('style');
    styleEl.id = 'pqa-misc-styles';
    styleEl.textContent = STYLE;
    document.head.appendChild(styleEl);

    window.__PQA.panelChrome.registerTab({
      id: 'misc',
      label: 'Avisos',
      mount(container) {
        avisosContainerRef = container;
        renderAvisosTab(container);
        intervaloAtualizacao = setInterval(() => renderAvisosTab(container), 30000);
      },
      onHide() {
        if (intervaloAtualizacao) {
          clearInterval(intervaloAtualizacao);
          intervaloAtualizacao = null;
        }
      },
      onShow() {
        if (!intervaloAtualizacao) intervaloAtualizacao = setInterval(() => renderAvisosTab(avisosContainerRef), 30000);
      }
    });

    window.__PQA.misc = {
      getDailyGiftAvailableAt: () => core.storage.get(FEATURE, 'available-at', null)
    };

    core.registerModule('misc');
  });
}

webFrame.executeJavaScript(`(${iniciarAvisos.toString()})();`);
