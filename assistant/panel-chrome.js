// Painel flutuante injetado na página do jogo: janela arrastável/redimensionável
// com abas, minimização, atalho global Alt+P e suporte a "satélites" (pequenos
// painéis extras ancorados ao painel principal, usados por módulos futuros como o
// log de shinies). Outros módulos chamam window.__PQA.panelChrome.registerTab(...)
// para adicionar conteúdo — este arquivo não conhece nenhuma feature específica.

const { webFrame } = require('electron');

function iniciarChromeDoPainel() {
  if (!window.__PQA || !window.__PQA.core) {
    console.error('[PQA] core ausente antes de panel-chrome — abortando módulo');
    return;
  }
  if (window.__PQA.panelChrome) return; // já inicializado

  const core = window.__PQA.core;

  // document.head/document.body ainda não existem em document-start; todo o
  // resto deste módulo mexe em DOM, então espera o documento ficar pronto.
  core.onDomReady(montarChromeDoPainel);

  function montarChromeDoPainel() {
    const FEATURE = 'panel';
    const MIN_W = 300;
    const MIN_H = 260;
    const FADE_MS = 140;

    const STYLE = `
      #pqa-panel-root {
        position: fixed;
        z-index: 2147483647;
        display: flex;
        flex-direction: column;
        background: #1b2430;
        color: #e8edf3;
        border: 1px solid rgba(255,255,255,0.12);
        border-top: 2px solid #ffcb05;
        border-radius: 10px;
        box-shadow: 0 12px 32px rgba(0,0,0,0.5);
        font: 12.5px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif;
        overflow: hidden;
        opacity: 1;
        transform: scale(1);
        transition: opacity ${FADE_MS}ms ease, transform ${FADE_MS}ms ease;
      }
      #pqa-panel-root.pqa-hidden { opacity: 0; transform: scale(0.96); pointer-events: none; }
      #pqa-panel-root.pqa-minimized #pqa-panel-tabs,
      #pqa-panel-root.pqa-minimized #pqa-panel-body,
      #pqa-panel-root.pqa-minimized #pqa-resize-handle { display: none; }
      #pqa-panel-header {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 8px 10px;
        background: linear-gradient(180deg, #2a394d, #202c3b);
        border-bottom: 1px solid rgba(255,255,255,0.06);
        cursor: move;
        user-select: none;
        flex-shrink: 0;
      }
      #pqa-panel-title {
        font-weight: 700;
        color: #ffcb05;
        margin-right: auto;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        letter-spacing: 0.2px;
      }
      .pqa-hbtn {
        background: transparent;
        border: none;
        color: #8b9bad;
        width: 22px;
        height: 22px;
        border-radius: 5px;
        cursor: pointer;
        font-size: 13px;
        line-height: 1;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        transition: background 0.12s ease, color 0.12s ease;
      }
      .pqa-hbtn:hover { background: rgba(255,255,255,0.12); color: #e8edf3; }
      #pqa-btn-close:hover { background: #e3350d; color: #fff; }
      #pqa-panel-tabs {
        display: flex;
        flex-wrap: wrap;
        gap: 2px;
        padding: 6px 6px 0;
        background: #202c3b;
        flex-shrink: 0;
      }
      .pqa-tab-btn {
        background: transparent;
        border: none;
        color: #8b9bad;
        padding: 6px 10px;
        font-size: 11px;
        border-radius: 6px 6px 0 0;
        cursor: pointer;
        white-space: nowrap;
        transition: background 0.12s ease, color 0.12s ease;
      }
      .pqa-tab-btn:hover { color: #e8edf3; background: rgba(255,255,255,0.05); }
      .pqa-tab-btn.pqa-active {
        background: #1b2430;
        color: #ffcb05;
        box-shadow: inset 0 -2px 0 #ffcb05;
      }
      #pqa-panel-body {
        flex: 1;
        overflow: auto;
        padding: 12px;
        min-height: 0;
      }
      .pqa-tab-panel { display: none; animation: pqa-fade-in 0.12s ease; }
      .pqa-tab-panel.pqa-active { display: block; }
      @keyframes pqa-fade-in {
        from { opacity: 0; transform: translateY(2px); }
        to { opacity: 1; transform: translateY(0); }
      }
      #pqa-resize-handle {
        position: absolute;
        right: 0;
        bottom: 0;
        width: 16px;
        height: 16px;
        cursor: nwse-resize;
        background:
          linear-gradient(135deg, transparent 0 50%, rgba(255,255,255,0.3) 50% 60%, transparent 60% 70%, rgba(255,255,255,0.3) 70% 80%, transparent 80%);
      }
      .pqa-satellite {
        position: fixed;
        z-index: 2147483646;
        background: #1b2430;
        color: #e8edf3;
        border: 1px solid rgba(255,255,255,0.12);
        border-top: 2px solid #ffcb05;
        border-radius: 10px;
        box-shadow: 0 12px 32px rgba(0,0,0,0.5);
        font: 12.5px/1.45 system-ui, sans-serif;
        overflow: auto;
        opacity: 1;
        transition: opacity ${FADE_MS}ms ease;
      }
      .pqa-satellite.pqa-hidden { opacity: 0; pointer-events: none; }
      .pqa-empty-hint { color: #8b9bad; font-size: 11px; line-height: 1.6; }

      /* Scrollbars finas e discretas em qualquer área com overflow do painel */
      #pqa-panel-body::-webkit-scrollbar,
      #pqa-panel-tabs::-webkit-scrollbar,
      .pqa-satellite::-webkit-scrollbar {
        width: 7px;
        height: 7px;
      }
      #pqa-panel-body::-webkit-scrollbar-thumb,
      .pqa-satellite::-webkit-scrollbar-thumb {
        background: rgba(255,255,255,0.14);
        border-radius: 4px;
      }
      #pqa-panel-body::-webkit-scrollbar-thumb:hover,
      .pqa-satellite::-webkit-scrollbar-thumb:hover {
        background: rgba(255,255,255,0.24);
      }
      #pqa-panel-body::-webkit-scrollbar-track,
      .pqa-satellite::-webkit-scrollbar-track {
        background: transparent;
      }

      /* Aba Resumo */
      .pqa-summary-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
        gap: 8px;
        margin-bottom: 12px;
      }
      .pqa-summary-card {
        background: #232f3d;
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 8px;
        padding: 10px;
      }
      .pqa-summary-label { font-size: 10px; color: #8b9bad; margin-bottom: 4px; }
      .pqa-summary-value { font-size: 15px; font-weight: 700; color: #e8edf3; overflow-wrap: anywhere; }
      .pqa-summary-footer {
        display: flex;
        justify-content: space-between;
        align-items: center;
        flex-wrap: wrap;
        gap: 6px;
        padding-top: 10px;
        border-top: 1px solid rgba(255,255,255,0.08);
        font-size: 10.5px;
      }
      .pqa-status-ok { color: #61f6a4; }
      .pqa-status-warn { color: #f1c644; }

      /* Base compartilhada pra qualquer input/select das outras abas — cada módulo
         só define layout específico, o foco/transição fica padronizado aqui. */
      #pqa-panel-body input[type="text"],
      #pqa-panel-body input[type="number"],
      #pqa-panel-body input[type="file"],
      #pqa-panel-body select {
        font-family: inherit;
        transition: border-color 0.12s ease, background 0.12s ease;
      }
      #pqa-panel-body input[type="text"]:focus,
      #pqa-panel-body input[type="number"]:focus,
      #pqa-panel-body select:focus {
        outline: none;
        border-color: #ffcb05 !important;
      }
      #pqa-panel-body button { transition: border-color 0.12s ease, background 0.12s ease, color 0.12s ease; }
    `;

    const styleEl = document.createElement('style');
    styleEl.id = 'pqa-styles';
    styleEl.textContent = STYLE;
    document.head.appendChild(styleEl);

    /* ---------- Estado / persistência ---------- */

    function defaultState() {
      const width = 380;
      const height = 480;
      return {
        left: Math.max(16, window.innerWidth - width - 24),
        top: 72,
        width,
        height,
        minimized: false,
        activeTab: null
      };
    }

    const state = Object.assign(defaultState(), core.storage.get(FEATURE, 'state', {}));

    function persist() {
      core.storage.set(FEATURE, 'state', state);
    }

    /* ---------- DOM ---------- */

    const root = document.createElement('div');
    root.id = 'pqa-panel-root';
    root.className = 'pqa-hidden';
    root.style.display = 'none';
    root.innerHTML = `
      <div id="pqa-panel-header">
        <span id="pqa-panel-title">Poke Quad Assistant</span>
        <button class="pqa-hbtn" id="pqa-btn-min" title="Minimizar">&#8211;</button>
        <button class="pqa-hbtn" id="pqa-btn-close" title="Fechar (Alt+P)">&times;</button>
      </div>
      <div id="pqa-panel-tabs"></div>
      <div id="pqa-panel-body"></div>
      <div id="pqa-resize-handle"></div>
    `;
    document.body.appendChild(root);

    const header = root.querySelector('#pqa-panel-header');
    const tabsBar = root.querySelector('#pqa-panel-tabs');
    const body = root.querySelector('#pqa-panel-body');
    const resizeHandle = root.querySelector('#pqa-resize-handle');
    const btnMin = root.querySelector('#pqa-btn-min');
    const btnClose = root.querySelector('#pqa-btn-close');

    function tamanhoMaximo() {
      return {
        width: Math.max(MIN_W, window.innerWidth - 32),
        height: Math.max(MIN_H, window.innerHeight - 32)
      };
    }

    function applyGeometry() {
      root.style.left = `${state.left}px`;
      root.style.top = `${state.top}px`;
      root.style.width = `${state.width}px`;
      root.style.height = `${state.height}px`;
      root.classList.toggle('pqa-minimized', state.minimized);
    }
    applyGeometry();

    function clampToViewport() {
      const max = tamanhoMaximo();
      state.width = Math.min(state.width, max.width);
      state.height = Math.min(state.height, max.height);
      state.left = Math.min(Math.max(0, state.left), Math.max(0, window.innerWidth - 60));
      state.top = Math.min(Math.max(0, state.top), Math.max(0, window.innerHeight - 40));
      applyGeometry();
      repositionSatellites();
    }
    window.addEventListener('resize', clampToViewport);

    /* ---------- Arrastar ---------- */

    let dragState = null;
    header.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) return;
      dragState = { startX: e.clientX, startY: e.clientY, startLeft: state.left, startTop: state.top };
      document.addEventListener('mousemove', onDragMove);
      document.addEventListener('mouseup', onDragEnd);
      e.preventDefault();
    });
    function onDragMove(e) {
      if (!dragState) return;
      state.left = dragState.startLeft + (e.clientX - dragState.startX);
      state.top = dragState.startTop + (e.clientY - dragState.startY);
      applyGeometry();
      repositionSatellites();
    }
    function onDragEnd() {
      dragState = null;
      document.removeEventListener('mousemove', onDragMove);
      document.removeEventListener('mouseup', onDragEnd);
      clampToViewport();
      persist();
    }

    /* ---------- Redimensionar ---------- */

    let resizeState = null;
    resizeHandle.addEventListener('mousedown', (e) => {
      resizeState = { startX: e.clientX, startY: e.clientY, startW: state.width, startH: state.height };
      document.addEventListener('mousemove', onResizeMove);
      document.addEventListener('mouseup', onResizeEnd);
      e.preventDefault();
      e.stopPropagation();
    });
    function onResizeMove(e) {
      if (!resizeState) return;
      const max = tamanhoMaximo();
      state.width = Math.min(max.width, Math.max(MIN_W, resizeState.startW + (e.clientX - resizeState.startX)));
      state.height = Math.min(max.height, Math.max(MIN_H, resizeState.startH + (e.clientY - resizeState.startY)));
      applyGeometry();
      repositionSatellites();
    }
    function onResizeEnd() {
      resizeState = null;
      document.removeEventListener('mousemove', onResizeMove);
      document.removeEventListener('mouseup', onResizeEnd);
      persist();
    }

    /* ---------- Minimizar / fechar / atalho ---------- */

    btnMin.addEventListener('click', () => {
      state.minimized = !state.minimized;
      applyGeometry();
      persist();
    });

    btnClose.addEventListener('click', hide);

    document.addEventListener('keydown', (e) => {
      if (e.altKey && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault();
        toggle();
      }
    });

    let hideTimeoutId = null;

    function show() {
      clearTimeout(hideTimeoutId);
      root.style.display = 'flex';
      // Força o navegador a aplicar "display:flex" antes de tirar a classe hidden,
      // senão as duas mudanças caem no mesmo frame e a transição de fade não roda.
      void root.offsetWidth;
      root.classList.remove('pqa-hidden');
      repositionSatellites();
    }
    function hide() {
      clearTimeout(hideTimeoutId);
      root.classList.add('pqa-hidden');
      hideTimeoutId = setTimeout(() => { root.style.display = 'none'; }, FADE_MS);
      repositionSatellites();
    }
    function toggle() {
      if (root.classList.contains('pqa-hidden')) show();
      else hide();
    }
    function isVisible() {
      return !root.classList.contains('pqa-hidden');
    }

    /* ---------- Abas ---------- */

    const tabs = new Map(); // id -> { def, btn, panelEl, mounted }

    function activateTab(id) {
      if (!tabs.has(id)) return;
      for (const [tabId, entry] of tabs) {
        const active = tabId === id;
        entry.btn.classList.toggle('pqa-active', active);
        entry.panelEl.classList.toggle('pqa-active', active);
        if (active && !entry.mounted) {
          entry.mounted = true;
          try {
            entry.def.mount(entry.panelEl);
          } catch (err) {
            entry.panelEl.textContent = `Erro ao carregar aba: ${err.message}`;
          }
        }
        if (active && entry.def.onShow) entry.def.onShow();
        if (!active && entry.def.onHide) entry.def.onHide();
      }
      state.activeTab = id;
      persist();
    }

    function registerTab(def) {
      if (tabs.has(def.id)) return;
      const btn = document.createElement('button');
      btn.className = 'pqa-tab-btn';
      btn.textContent = def.label;
      btn.addEventListener('click', () => activateTab(def.id));
      tabsBar.appendChild(btn);

      const panelEl = document.createElement('div');
      panelEl.className = 'pqa-tab-panel';
      body.appendChild(panelEl);

      tabs.set(def.id, { def, btn, panelEl, mounted: false });

      const shouldActivate = state.activeTab ? state.activeTab === def.id : tabs.size === 1;
      if (shouldActivate) activateTab(def.id);
    }

    /* ---------- Satélites ---------- */

    const satellites = new Set();

    function repositionSatellites() {
      satellites.forEach((sat) => sat.reposition());
    }

    function createSatellite(id, opts) {
      opts = opts || {};
      const width = opts.width || 260;
      const height = opts.height || 320;
      const gap = opts.gap !== undefined ? opts.gap : 8;

      const el = document.createElement('div');
      el.id = `pqa-sat-${id}`;
      el.className = 'pqa-satellite pqa-hidden';
      el.style.width = `${width}px`;
      el.style.height = `${height}px`;
      document.body.appendChild(el);

      function reposition() {
        const rect = root.getBoundingClientRect();
        let left = rect.right + gap;
        let top = rect.top;
        if (left + width > window.innerWidth) left = Math.max(0, rect.left - width - gap);
        if (top + height > window.innerHeight) top = Math.max(0, window.innerHeight - height - gap);
        el.style.left = `${left}px`;
        el.style.top = `${top}px`;
      }

      const satellite = {
        el,
        reposition,
        show() { el.classList.remove('pqa-hidden'); reposition(); },
        hide() { el.classList.add('pqa-hidden'); },
        isVisible() { return !el.classList.contains('pqa-hidden'); },
        setContent(html) { el.innerHTML = html; }
      };
      satellites.add(satellite);
      return satellite;
    }

    /* ---------- Aba embutida "Resumo" ---------- */
    // Painel de partida com um resumo rápido do que as outras abas já apuraram —
    // lê a API pública de cada módulo (todos já carregados a essa altura, dado que
    // panel-chrome é o único que monta abas embutidas antes dos demais módulos
    // rodarem) em vez de repetir lógica de cálculo aqui.

    let intervaloResumo = null;
    let resumoContainerRef = null;

    function renderResumo() {
      if (!resumoContainerRef) return;
      const pqa = window.__PQA;
      const analise = pqa.reader && pqa.reader.getCurrentAnalysis ? pqa.reader.getCurrentAnalysis() : null;
      const pokemonAtual = analise && !analise.erro ? analise.pokemon.nome : null;

      const shinyCount = pqa.shiny ? pqa.shiny.getCounter() : null;

      let capturasResumo = null;
      if (pqa.catchAnalyzer) {
        const registros = pqa.catchAnalyzer.getRecords();
        const sucessos = registros.filter((r) => r.success).length;
        capturasResumo = {
          total: registros.length,
          taxa: registros.length ? (sucessos / registros.length) * 100 : 0
        };
      }

      const bootLog = core.getBootLog();
      const modulosEsperados = 9; // core, data-types, panel-chrome, reader, shiny, combat, catch-analyzer, pokepedia, misc
      const tudoOk = bootLog.length >= modulosEsperados;

      resumoContainerRef.innerHTML = `
        <div class="pqa-summary-grid">
          <div class="pqa-summary-card">
            <div class="pqa-summary-label">Pokémon em foco</div>
            <div class="pqa-summary-value">${pokemonAtual || '—'}</div>
          </div>
          <div class="pqa-summary-card">
            <div class="pqa-summary-label">Shinies encontrados</div>
            <div class="pqa-summary-value">${shinyCount === null ? '—' : `✨ ${shinyCount}`}</div>
          </div>
          <div class="pqa-summary-card">
            <div class="pqa-summary-label">Capturas registradas</div>
            <div class="pqa-summary-value">${capturasResumo ? `${capturasResumo.total} <span style="font-size:11px;color:#8b9bad;">(${capturasResumo.taxa.toFixed(0)}%)</span>` : '—'}</div>
          </div>
        </div>
        <div class="pqa-empty-hint">
          Passe o mouse em um Pokémon (aba Pokémon), deixe o jogo caçando e volte
          aqui pra ver o resumo atualizar.
        </div>
        <div class="pqa-summary-footer">
          <span class="${tudoOk ? 'pqa-status-ok' : 'pqa-status-warn'}">${tudoOk ? '● Tudo funcionando' : `● ${bootLog.length}/${modulosEsperados} módulos carregados`}</span>
          <span class="pqa-reader-sub">Poke Quad Assistant v${pqa.VERSION}</span>
        </div>
      `;
    }

    registerTab({
      id: 'summary',
      label: 'Resumo',
      mount(container) {
        resumoContainerRef = container;
        renderResumo();
        core.on('module-ready', renderResumo);
        intervaloResumo = setInterval(renderResumo, 5000);
      },
      onHide() {
        if (intervaloResumo) { clearInterval(intervaloResumo); intervaloResumo = null; }
      },
      onShow() {
        if (!intervaloResumo) intervaloResumo = setInterval(renderResumo, 5000);
      }
    });

    window.__PQA.panelChrome = {
      registerTab,
      activateTab,
      show,
      hide,
      toggle,
      isVisible,
      createSatellite
    };

    core.registerModule('panel-chrome');
  }
}

webFrame.executeJavaScript(`(${iniciarChromeDoPainel.toString()})();`);
