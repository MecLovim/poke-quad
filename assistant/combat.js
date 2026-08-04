// Rastreador de combate: varre frames de WebSocket por objetos com nome de golpe +
// dano numérico (heurística — o protocolo não tem um formato fixo confirmado para
// "evento de dano", então casa qualquer coisa com essa forma). Cruza com a lista de
// golpes do Pokémon em foco (assistant/reader.js) via /game/creatures.json: quem
// bate com o golpe conhecido é "golpe usado por nós", quem não bate vira "dano
// recebido" por exclusão.

const { webFrame } = require('electron');

function iniciarRastreadorDeCombate() {
  if (!window.__PQA || !window.__PQA.core) {
    console.error('[PQA] core ausente antes de combat — abortando módulo');
    return;
  }
  if (window.__PQA.combat) return; // já inicializado

  const core = window.__PQA.core;
  const FEATURE = 'combat';
  const PROFUNDIDADE_MAXIMA = 6;

  /* ---------- Extração de "evento de dano" em qualquer frame WS ---------- */

  function primeiroFinito(...valores) {
    for (const v of valores) if (Number.isFinite(v)) return v;
    return NaN;
  }

  function resolverNomeGolpe(obj) {
    for (const campo of ['moveName', 'attackName', 'spellName']) {
      if (typeof obj[campo] === 'string' && obj[campo]) return obj[campo];
    }
    for (const campo of ['move', 'attack', 'skill']) {
      const v = obj[campo];
      if (typeof v === 'string' && v) return v;
      if (v && typeof v === 'object' && typeof v.name === 'string' && v.name) return v.name;
    }
    return null;
  }

  function extrairDanos(obj, profundidade, resultado) {
    if (!obj || typeof obj !== 'object' || profundidade > PROFUNDIDADE_MAXIMA) return resultado;
    if (Array.isArray(obj)) {
      for (const item of obj) extrairDanos(item, profundidade + 1, resultado);
      return resultado;
    }
    const nomeGolpe = resolverNomeGolpe(obj);
    const dano = primeiroFinito(obj.damage, obj.dmg, obj.dano, obj.amount);
    if (nomeGolpe && Number.isFinite(dano)) {
      resultado.push({
        nome: nomeGolpe,
        dano,
        tipo: obj.type || obj.moveType || null,
        eff: primeiroFinito(obj.eff, obj.multiplier, obj.effectiveness)
      });
    }
    for (const chave of Object.keys(obj)) {
      const valor = obj[chave];
      if (valor && typeof valor === 'object') extrairDanos(valor, profundidade + 1, resultado);
    }
    return resultado;
  }

  /* ---------- Lista de golpes do Pokémon em foco (/game/creatures.json) ---------- */

  let creaturesLista = null;
  async function carregarCreatures() {
    if (creaturesLista) return creaturesLista;
    try {
      const res = await fetch('/game/creatures.json');
      const payload = await res.json();
      creaturesLista = Array.isArray(payload) ? payload : (payload.creatures || []);
    } catch (e) {
      creaturesLista = [];
    }
    return creaturesLista;
  }

  function normalizarNome(nome) {
    return String(nome || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  }

  async function obterMovesDoPokemon(nomePokemon) {
    const lista = await carregarCreatures();
    const alvo = normalizarNome(nomePokemon);
    const creature = lista.find((c) => normalizarNome(c.name) === alvo);
    if (!creature) return [];
    for (const campo of ['moves', 'attacks', 'skills', 'spells']) {
      const bruto = creature[campo];
      if (Array.isArray(bruto) && bruto.length) {
        return bruto
          .map((m) => ({
            nome: typeof m === 'string' ? m : (m.name || m.nome || ''),
            poder: typeof m === 'object' ? (m.power ?? m.poder ?? null) : null,
            tipo: typeof m === 'object' ? (m.type ?? m.tipo ?? null) : null
          }))
          .filter((m) => m.nome);
      }
    }
    return [];
  }

  /* ---------- Estado da sessão de caça atual ---------- */

  const danoPorGolpe = new Map(); // nomeLower -> {nome, ultimoDano, total, contagem, tipo, eff}
  let ultimoGolpeUsadoLower = null;
  let movimentosConhecidos = [];
  let pokemonAtualNome = null;
  let combatContainerRef = null;

  function limparSessao() {
    danoPorGolpe.clear();
    ultimoGolpeUsadoLower = null;
  }

  function registrarDano(golpe) {
    const chave = golpe.nome.toLowerCase();
    const existente = danoPorGolpe.get(chave);
    if (existente) {
      existente.ultimoDano = golpe.dano;
      existente.total += golpe.dano;
      existente.contagem += 1;
      if (golpe.tipo) existente.tipo = golpe.tipo;
      if (Number.isFinite(golpe.eff)) existente.eff = golpe.eff;
    } else {
      danoPorGolpe.set(chave, {
        nome: golpe.nome,
        ultimoDano: golpe.dano,
        total: golpe.dano,
        contagem: 1,
        tipo: golpe.tipo,
        eff: Number.isFinite(golpe.eff) ? golpe.eff : null
      });
    }
    ultimoGolpeUsadoLower = chave;
    atualizarAba();
  }

  async function onPokemonChanged(evento) {
    limparSessao();
    const analise = evento.detail;
    if (!analise || analise.erro || analise.manual) {
      pokemonAtualNome = null;
      movimentosConhecidos = [];
      atualizarAba();
      return;
    }
    pokemonAtualNome = analise.pokemon.nome;
    movimentosConhecidos = await obterMovesDoPokemon(pokemonAtualNome);
    atualizarAba();
  }

  function onWsFrame(evento) {
    const golpes = extrairDanos(evento.detail, 0, []);
    for (const g of golpes) registrarDano(g);
  }

  /* ---------- Renderização ---------- */

  function atualizarAba() {
    if (combatContainerRef) renderCombateTab(combatContainerRef);
  }

  function traduzirTipo(tipo) {
    if (!tipo || !window.__PQA.types) return tipo;
    const chave = window.__PQA.types.normalizeKey(tipo);
    return chave ? window.__PQA.types.KEY_TO_PT[chave] || tipo : tipo;
  }

  function linhaMove(m, registro, ativo) {
    const dano = registro
      ? `${registro.ultimoDano} (tot. ${registro.total}, ${registro.contagem}x)${Number.isFinite(registro.eff) && registro.eff !== 1 ? ` · ${registro.eff}x` : ''}`
      : '—';
    return `
      <div class="pqa-move-row ${ativo ? 'pqa-move-ativo' : ''}">
        <span class="pqa-move-nome">${m.nome}</span>
        <span class="pqa-move-tipo">${traduzirTipo(m.tipo) || ''}</span>
        <span class="pqa-move-poder">${m.poder ?? '—'}</span>
        <span class="pqa-move-dano">${dano}</span>
      </div>
    `;
  }

  function renderCombateTab(container) {
    const nomesConhecidosLower = new Set(movimentosConhecidos.map((m) => m.nome.toLowerCase()));

    const conhecidosHtml = movimentosConhecidos.length
      ? movimentosConhecidos.map((m) => {
          const chave = m.nome.toLowerCase();
          return linhaMove(m, danoPorGolpe.get(chave), chave === ultimoGolpeUsadoLower);
        }).join('')
      : '<div class="pqa-empty-hint">Sem golpes cadastrados para este Pokémon.</div>';

    const recebidos = [...danoPorGolpe.entries()].filter(([chave]) => !nomesConhecidosLower.has(chave));
    const recebidosHtml = recebidos.length
      ? recebidos.map(([, r]) => linhaMove({ nome: r.nome, poder: null, tipo: r.tipo }, r, false)).join('')
      : '<div class="pqa-empty-hint">Nenhum dano recebido registrado.</div>';

    container.innerHTML = `
      <div class="pqa-combat-header">${pokemonAtualNome ? `Caçando: <strong>${pokemonAtualNome}</strong>` : 'Nenhum Pokémon em foco — analise um na aba Pokémon.'}</div>
      <div class="pqa-section-title">⚔️ Golpes conhecidos</div>
      <div class="pqa-move-list">${conhecidosHtml}</div>
      <div class="pqa-section-title">🛡️ Golpes recebidos</div>
      <div class="pqa-move-list">${recebidosHtml}</div>
    `;
  }

  /* ---------- Registro ---------- */

  const STYLE = `
    .pqa-combat-header { font-size: 11px; color: #8b9bad; margin-bottom: 8px; }
    .pqa-section-title { font-size: 11px; font-weight: 600; color: #ffcb05; margin: 10px 0 4px; }
    .pqa-move-list { display: flex; flex-direction: column; gap: 3px; }
    .pqa-move-row { display: grid; grid-template-columns: 1fr auto auto auto; gap: 8px; align-items: center; font-size: 10px; padding: 3px 4px; border-radius: 4px; }
    .pqa-move-row.pqa-move-ativo { background: rgba(255,203,5,0.12); }
    .pqa-move-tipo { color: #8b9bad; }
    .pqa-move-poder { color: #8b9bad; text-align: right; }
    .pqa-move-dano { color: #69b7ff; text-align: right; min-width: 90px; }
  `;

  core.onPanelReady(() => {
    const styleEl = document.createElement('style');
    styleEl.id = 'pqa-combat-styles';
    styleEl.textContent = STYLE;
    document.head.appendChild(styleEl);

    window.__PQA.panelChrome.registerTab({
      id: 'combat',
      label: 'Combate',
      mount(container) {
        combatContainerRef = container;
        renderCombateTab(container);
      }
    });

    core.on('pokemon-changed', onPokemonChanged);
    core.on('ws-frame', onWsFrame);

    window.__PQA.combat = {
      getDamageLog: () => [...danoPorGolpe.values()],
      getKnownMoves: () => movimentosConhecidos.slice()
    };

    core.registerModule('combat');
  });
}

webFrame.executeJavaScript(`(${iniciarRastreadorDeCombate.toString()})();`);
