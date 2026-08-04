// Detecção de shiny: único módulo cujo dado de origem é um booleano confirmado do
// servidor (mob.shiny === true), não heurística de texto/DOM. Varre recursivamente
// todo frame de WebSocket em busca de objetos com cara de "mob" (têm shiny/isShiny,
// ou row+col+hp), toca um alerta e guarda histórico — tudo isolado por conta, já
// que cada webview tem sua própria sessão/localStorage.

const { webFrame } = require('electron');

function iniciarDeteccaoDeShiny() {
  if (!window.__PQA || !window.__PQA.core) {
    console.error('[PQA] core ausente antes de shiny — abortando módulo');
    return;
  }
  if (window.__PQA.shiny) return; // já inicializado

  const core = window.__PQA.core;
  const FEATURE = 'shiny';
  const PROFUNDIDADE_MAXIMA = 5;
  const JANELA_DEDUPE_HISTORICO_MS = 2 * 60 * 1000;
  const COOLDOWN_CONTADOR_MS = 1000;
  const COOLDOWN_SOM_MS = 3000;
  const SILENCIO_APOS_DISPENSAR_MS = 60 * 1000;
  const STALE_MS = 5000;

  /* ---------- Dados estáticos do jogo (para resolver nome a partir de speciesId) ---------- */

  let creatures = { porId: new Map(), porNome: new Map() };
  (async () => {
    try {
      const res = await fetch('/game/creatures.json');
      const payload = await res.json();
      const data = Array.isArray(payload) ? payload : (payload.creatures || []);
      const porId = new Map();
      const porNome = new Map();
      for (const c of data) {
        if (c.pokeId !== undefined) porId.set(c.pokeId, c);
        if (c.name) porNome.set(String(c.name).toLowerCase(), c);
      }
      creatures = { porId, porNome };
    } catch (e) {
      // segue sem resolução de nome por id; mob.name direto ainda funciona
    }
  })();

  function resolverNome(mob) {
    const direto = mob.name || mob.speciesName || mob.pokemonName;
    if (direto) return direto;
    const speciesId = mob.speciesId ?? mob.species;
    if (speciesId !== undefined) {
      const c = creatures.porId.get(speciesId);
      if (c) return c.name;
      return `#${speciesId}`;
    }
    return 'Desconhecido';
  }

  /* ---------- Extração recursiva de mobs em qualquer frame WS ---------- */

  function extrairMobs(obj, profundidade, resultado) {
    if (!obj || typeof obj !== 'object' || profundidade > PROFUNDIDADE_MAXIMA) return resultado;
    if (Array.isArray(obj)) {
      for (const item of obj) extrairMobs(item, profundidade + 1, resultado);
      return resultado;
    }
    const pareceMob = obj.shiny !== undefined || obj.isShiny !== undefined || obj.shiny_state !== undefined
      || (obj.row !== undefined && obj.col !== undefined && obj.hp !== undefined);
    if (pareceMob) resultado.push(obj);
    for (const chave of Object.keys(obj)) {
      const valor = obj[chave];
      if (valor && typeof valor === 'object') extrairMobs(valor, profundidade + 1, resultado);
    }
    return resultado;
  }

  function ehShiny(mob) {
    return mob.shiny === true || mob.isShiny === true || mob.shiny_state === true;
  }

  function chaveDoMob(mob) {
    if (mob.id !== undefined) return `id_${mob.id}`;
    const especie = mob.speciesId ?? mob.species;
    if (mob.slot !== undefined && especie !== undefined) return `slot_${mob.slot}_sp_${especie}`;
    if (mob.row !== undefined && mob.col !== undefined) return `pos_${mob.row}_${mob.col}_sp_${especie ?? ''}`;
    return null;
  }

  /* ---------- Ciclo de vida dos shinies visíveis no mapa ---------- */

  const shiniesAtivos = new Map(); // mobKey -> {firstSeen, lastSeen, nome, speciesId, slot}
  const jaAnunciados = new Set(); // mobKeys já contados/anunciados nesta "aparição"
  let ultimoPacoteShinyEm = 0;

  function processarMob(mob) {
    const chave = chaveDoMob(mob);
    if (!chave) return;
    const morto = mob.dead === true || mob.respawning === true || mob.hp === 0;

    if (ehShiny(mob) && !morto) {
      ultimoPacoteShinyEm = Date.now();
      const existente = shiniesAtivos.get(chave);
      const info = {
        firstSeen: existente ? existente.firstSeen : Date.now(),
        lastSeen: Date.now(),
        speciesId: mob.speciesId ?? mob.species ?? null,
        nome: resolverNome(mob),
        slot: mob.slot ?? null
      };
      shiniesAtivos.set(chave, info);
      if (!jaAnunciados.has(chave)) {
        jaAnunciados.add(chave);
        anunciarShiny(info);
      }
    } else if (shiniesAtivos.has(chave)) {
      shiniesAtivos.delete(chave);
      jaAnunciados.delete(chave);
    }
  }

  // Sem evento explícito de "shiny saiu do mapa" no protocolo — se nenhum pacote de
  // shiny chegar por STALE_MS, assume que sumiu e esconde o banner (heurística,
  // igual ao script de referência).
  setInterval(() => {
    if (ultimoPacoteShinyEm && Date.now() - ultimoPacoteShinyEm > STALE_MS) {
      esconderBanner();
    }
  }, 2000);

  /* ---------- Contador / som / histórico ---------- */

  let ultimaNotificacaoEm = 0;
  let ultimoSomEm = 0;

  function anunciarShiny(info) {
    const agora = Date.now();
    if (agora - ultimaNotificacaoEm >= COOLDOWN_CONTADOR_MS) {
      ultimaNotificacaoEm = agora;
      const atual = core.storage.get(FEATURE, 'counter', 0);
      core.storage.set(FEATURE, 'counter', atual + 1);
    }
    if (agora - ultimoSomEm >= COOLDOWN_SOM_MS) {
      ultimoSomEm = agora;
      tocarSom();
    }
    registrarNoHistorico(info);
    mostrarBanner(info);
    atualizarAbaShiny();
  }

  let audioCtx = null;
  function tocarSom() {
    if (core.storage.get(FEATURE, 'sound-enabled', true) === false) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      // Sem nenhum gesto do usuário ainda na página, o navegador cria o contexto
      // "suspended" e nenhum som toca até resumir — o próprio jogo já foi clicado
      // bem antes de um shiny aparecer, mas resolve aqui de qualquer forma.
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const inicio = audioCtx.currentTime;
      // Arpejo curto de 3 notas ascendentes como alerta — sintetizado, sem depender
      // de um arquivo de áudio externo.
      [880, 1108.73, 1318.51].forEach((freq, i) => {
        const t = inicio + i * 0.12;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.85, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(t);
        osc.stop(t + 0.32);
      });
    } catch (e) {}
  }

  function registrarNoHistorico(info) {
    const historico = core.storage.get(FEATURE, 'history', []);
    const agora = Date.now();
    const existente = historico.find((h) =>
      h.speciesId === info.speciesId && h.slot === info.slot && (agora - h.timestamp) < JANELA_DEDUPE_HISTORICO_MS);
    if (existente) {
      existente.timestamp = agora;
      existente.count = (existente.count || 1) + 1;
    } else {
      historico.unshift({
        id: `${agora}_${Math.random().toString(36).slice(2, 8)}`,
        timestamp: agora,
        speciesId: info.speciesId,
        nome: info.nome,
        slot: info.slot,
        count: 1
      });
    }
    core.storage.set(FEATURE, 'history', historico.slice(0, 200));
  }

  /* ---------- Banner (independe do painel estar aberto) ---------- */

  let bannerEl = null;
  let silenciadoAte = 0;

  function criarBanner() {
    bannerEl = document.createElement('div');
    bannerEl.id = 'pqa-shiny-banner';
    bannerEl.className = 'pqa-hidden';
    bannerEl.innerHTML = '<span id="pqa-shiny-banner-text"></span><button id="pqa-shiny-banner-close" title="Dispensar por 60s">&times;</button>';
    document.body.appendChild(bannerEl);
    bannerEl.querySelector('#pqa-shiny-banner-close').addEventListener('click', () => {
      silenciadoAte = Date.now() + SILENCIO_APOS_DISPENSAR_MS;
      esconderBanner();
    });
  }

  function mostrarBanner(info) {
    if (!bannerEl || Date.now() < silenciadoAte) return;
    bannerEl.querySelector('#pqa-shiny-banner-text').textContent =
      `✨ Shiny detectado: ${info.nome}${info.slot !== null ? ` (slot ${info.slot})` : ''}`;
    bannerEl.classList.remove('pqa-hidden');
  }

  function esconderBanner() {
    if (bannerEl) bannerEl.classList.add('pqa-hidden');
  }

  /* ---------- Aba "Shiny" no painel ---------- */

  let shinyContainerRef = null;

  function atualizarAbaShiny() {
    if (shinyContainerRef) renderShinyTab(shinyContainerRef);
  }

  function renderShinyTab(container) {
    const termoAnterior = container.querySelector('#pqa-shiny-search')?.value || '';
    const contador = core.storage.get(FEATURE, 'counter', 0);
    const somLigado = core.storage.get(FEATURE, 'sound-enabled', true) !== false;

    container.innerHTML = `
      <div class="pqa-shiny-summary">
        <span>✨ ${contador} encontrado${contador === 1 ? '' : 's'}</span>
        <label class="pqa-toggle"><input type="checkbox" id="pqa-shiny-sound-toggle" ${somLigado ? 'checked' : ''}> Som</label>
      </div>
      <input type="text" id="pqa-shiny-search" placeholder="Buscar no histórico..." autocomplete="off" value="${termoAnterior}">
      <div id="pqa-shiny-list"></div>
      <button id="pqa-shiny-clear" class="pqa-action-btn">Limpar histórico</button>
    `;

    container.querySelector('#pqa-shiny-sound-toggle').addEventListener('change', (e) => {
      core.storage.set(FEATURE, 'sound-enabled', e.target.checked);
    });

    const busca = container.querySelector('#pqa-shiny-search');
    const renderLista = () => {
      const termo = busca.value.trim().toLowerCase();
      const historico = core.storage.get(FEATURE, 'history', []);
      const filtrado = termo
        ? historico.filter((h) => h.nome.toLowerCase().includes(termo) || String(h.speciesId).includes(termo))
        : historico;
      const listaEl = container.querySelector('#pqa-shiny-list');
      listaEl.innerHTML = filtrado.length
        ? filtrado.map((h) => `
            <div class="pqa-shiny-row">
              <span>${h.nome}${h.count > 1 ? ` ×${h.count}` : ''}</span>
              <span class="pqa-reader-sub">${new Date(h.timestamp).toLocaleString('pt-BR')}</span>
            </div>
          `).join('')
        : '<div class="pqa-empty-hint">Nenhum shiny registrado ainda.</div>';
    };
    busca.addEventListener('input', renderLista);
    renderLista();

    container.querySelector('#pqa-shiny-clear').addEventListener('click', () => {
      if (!confirm('Limpar todo o histórico de shinies desta conta?')) return;
      core.storage.set(FEATURE, 'history', []);
      renderLista();
    });
  }

  /* ---------- Registro ---------- */

  const STYLE = `
    #pqa-shiny-banner {
      position: fixed;
      top: 12px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 2147483647;
      background: linear-gradient(90deg, #f1c644, #ff9800);
      color: #1b2430;
      font-weight: 700;
      font-size: 12px;
      padding: 8px 14px;
      border-radius: 20px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.4);
      display: flex;
      align-items: center;
      gap: 10px;
      animation: pqa-shiny-pulse 1.2s ease-in-out infinite;
    }
    #pqa-shiny-banner.pqa-hidden { display: none; }
    #pqa-shiny-banner button {
      background: rgba(0,0,0,0.15);
      border: none;
      color: inherit;
      width: 18px;
      height: 18px;
      border-radius: 50%;
      cursor: pointer;
      line-height: 1;
    }
    @keyframes pqa-shiny-pulse {
      0%, 100% { transform: translateX(-50%) scale(1); box-shadow: 0 4px 16px rgba(0,0,0,0.4); }
      50% { transform: translateX(-50%) scale(1.04); box-shadow: 0 4px 24px rgba(241,198,68,0.6); }
    }
    .pqa-shiny-summary { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; font-size: 12px; }
    .pqa-toggle { display: flex; align-items: center; gap: 4px; font-size: 10px; color: #8b9bad; cursor: pointer; }
    #pqa-shiny-search {
      width: 100%;
      background: #232f3d;
      border: 1px solid rgba(255,255,255,0.15);
      border-radius: 5px;
      color: #e8edf3;
      padding: 5px 8px;
      font-size: 11px;
      margin-bottom: 8px;
    }
    #pqa-shiny-list { max-height: 220px; overflow: auto; margin-bottom: 8px; }
    .pqa-shiny-row { display: flex; justify-content: space-between; font-size: 11px; padding: 3px 0; border-bottom: 1px solid rgba(255,255,255,0.06); }
  `;

  core.onPanelReady(() => {
    const styleEl = document.createElement('style');
    styleEl.id = 'pqa-shiny-styles';
    styleEl.textContent = STYLE;
    document.head.appendChild(styleEl);

    criarBanner();

    window.__PQA.panelChrome.registerTab({
      id: 'shiny',
      label: 'Shiny',
      mount(container) {
        shinyContainerRef = container;
        renderShinyTab(container);
      }
    });

    core.on('ws-frame', (e) => {
      const mobs = extrairMobs(e.detail, 0, []);
      for (const mob of mobs) processarMob(mob);
    });

    window.__PQA.shiny = {
      getCounter: () => core.storage.get(FEATURE, 'counter', 0),
      getHistory: () => core.storage.get(FEATURE, 'history', [])
    };

    core.registerModule('shiny');
  });
}

webFrame.executeJavaScript(`(${iniciarDeteccaoDeShiny.toString()})();`);
