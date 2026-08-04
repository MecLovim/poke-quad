// Poképédia: banco de itens pesquisável com as fontes de drop de cada um, montado a
// partir dos dados públicos do próprio jogo (/game/items.json + /game/creatures.json).
// Puramente leitura, sem dependência de WebSocket — é referência estática, atualiza
// sozinha se o jogo mudar o conteúdo desses arquivos.

const { webFrame } = require('electron');

function iniciarPokepedia() {
  if (!window.__PQA || !window.__PQA.core) {
    console.error('[PQA] core ausente antes de pokepedia — abortando módulo');
    return;
  }
  if (window.__PQA.pokepedia) return; // já inicializado

  const core = window.__PQA.core;

  const CATEGORIA_LABEL = {
    stone: 'PEDRA', heal: 'CURA', revive: 'REVIVER', loot: 'LOOT', ball: 'BALL',
    misc: 'DIVERSOS', item: 'ITEM', vitamin: 'VITAMINA', energy: 'ENERGIA',
    card: 'SHINY CARD', clan: 'CLAN', tm: 'TM'
  };
  function labelCategoria(cat) {
    return CATEGORIA_LABEL[cat] || String(cat || '').toUpperCase();
  }

  let itemsPorNome = null;
  let dropsMap = null;
  let carregamentoEmAndamento = null;

  // /game/items.json e /game/creatures.json vêm como { items: [...] } / { creatures:
  // [...] } (confirmado ao vivo — não são arrays soltos como a documentação de
  // referência sugeria). loot.chance é sobre 100000 (confirmado: o maior valor visto
  // no dataset real é exatamente 100000), então percentual = chance / 1000.
  async function carregarDados() {
    if (dropsMap) return { itemsPorNome, dropsMap };
    if (carregamentoEmAndamento) return carregamentoEmAndamento;

    carregamentoEmAndamento = (async () => {
      try {
        const [itemsRes, creaturesRes] = await Promise.all([
          fetch('/game/items.json'),
          fetch('/game/creatures.json')
        ]);
        const itemsPayload = await itemsRes.json();
        const creaturesPayload = await creaturesRes.json();
        const items = Array.isArray(itemsPayload) ? itemsPayload : (itemsPayload.items || []);
        const creatures = Array.isArray(creaturesPayload) ? creaturesPayload : (creaturesPayload.creatures || []);

        itemsPorNome = new Map();
        for (const item of items) {
          if (item.name) itemsPorNome.set(item.name.toLowerCase(), item);
        }

        dropsMap = new Map();
        for (const creature of creatures) {
          if (!Array.isArray(creature.loot)) continue;
          for (const loot of creature.loot) {
            if (!loot.name) continue;
            const chave = loot.name.toLowerCase();
            if (!dropsMap.has(chave)) dropsMap.set(chave, []);
            dropsMap.get(chave).push({
              pokemon: creature.name,
              chancePercent: (loot.chance || 0) / 1000,
              quantidade: loot.minCount === loot.maxCount ? `×${loot.minCount}` : `×${loot.minCount}–${loot.maxCount}`
            });
          }
        }
        for (const lista of dropsMap.values()) lista.sort((a, b) => b.chancePercent - a.chancePercent);

        return { itemsPorNome, dropsMap };
      } catch (e) {
        // Sem isso, uma falha de rede deixava carregamentoEmAndamento travado numa
        // promise rejeitada pra sempre — nenhuma tentativa futura de abrir a aba
        // conseguiria tentar de novo, e a rejeição nem era tratada em lugar nenhum.
        dropsMap = null;
        carregamentoEmAndamento = null;
        throw e;
      }
    })();

    return carregamentoEmAndamento;
  }

  function formatarChance(pct) {
    if (pct <= 0) return '—';
    if (pct < 0.01) return '<0,01%';
    return `${pct.toFixed(pct < 1 ? 2 : 1).replace('.', ',')}%`;
  }

  /* ---------- UI ---------- */

  let pokepediaContainerRef = null;
  let itemSelecionado = null;
  let filtroCategoria = null;

  async function renderPokepediaTab(container) {
    container.innerHTML = '<div class="pqa-empty-hint">Carregando itens...</div>';
    let dados;
    try {
      dados = await carregarDados();
    } catch (e) {
      if (container === pokepediaContainerRef) {
        container.innerHTML = `
          <div class="pqa-empty-hint">Não foi possível carregar os itens do jogo (falha de rede). </div>
          <button id="pqa-poke-retry" class="pqa-action-btn">Tentar de novo</button>
        `;
        container.querySelector('#pqa-poke-retry').addEventListener('click', () => renderPokepediaTab(container));
      }
      return;
    }
    if (container !== pokepediaContainerRef) return; // usuário trocou de aba antes do fetch terminar
    montarShell(container, dados);
  }

  function montarShell(container, { itemsPorNome: itens, dropsMap: drops }) {
    const listaItens = [...itens.values()];
    const categorias = [...new Set(listaItens.map((i) => i.category))].sort();

    function renderConteudo() {
      const termoAtual = container.querySelector('#pqa-poke-search')?.value || '';
      container.innerHTML = `
        <div id="pqa-poke-search-row">
          <input type="text" id="pqa-poke-search" placeholder="Buscar item..." autocomplete="off" value="${termoAtual}">
        </div>
        <div id="pqa-poke-categorias">
          <button class="pqa-cat-pill ${!filtroCategoria ? 'pqa-active' : ''}" data-cat="">Todos</button>
          ${categorias.map((c) => `<button class="pqa-cat-pill ${filtroCategoria === c ? 'pqa-active' : ''}" data-cat="${c}">${labelCategoria(c)}</button>`).join('')}
        </div>
        <div id="pqa-poke-body"></div>
      `;

      container.querySelector('#pqa-poke-search').addEventListener('input', renderLista);
      container.querySelectorAll('.pqa-cat-pill').forEach((btn) => {
        btn.addEventListener('click', () => {
          filtroCategoria = btn.dataset.cat || null;
          renderConteudo();
        });
      });

      if (itemSelecionado) renderDetalhe();
      else renderLista();
    }

    function renderLista() {
      const termo = (container.querySelector('#pqa-poke-search')?.value || '').trim().toLowerCase();
      let filtrados = listaItens;
      if (filtroCategoria) filtrados = filtrados.filter((i) => i.category === filtroCategoria);
      if (termo) filtrados = filtrados.filter((i) => i.name.toLowerCase().includes(termo));
      filtrados = filtrados.slice(0, 60);

      const corpo = container.querySelector('#pqa-poke-body');
      corpo.innerHTML = filtrados.length
        ? filtrados.map((i) => `
            <button class="pqa-poke-item-row" data-nome="${i.name}">
              <span>${i.name}</span>
              <span class="pqa-reader-sub">${labelCategoria(i.category)}</span>
            </button>
          `).join('')
        : '<div class="pqa-empty-hint">Nenhum item encontrado.</div>';

      corpo.querySelectorAll('.pqa-poke-item-row').forEach((btn) => {
        btn.addEventListener('click', () => {
          itemSelecionado = btn.dataset.nome;
          renderDetalhe();
        });
      });
    }

    function renderDetalhe() {
      const item = itens.get(itemSelecionado.toLowerCase());
      const dropsDoItem = drops.get(itemSelecionado.toLowerCase()) || [];
      const corpo = container.querySelector('#pqa-poke-body');
      corpo.innerHTML = `
        <button id="pqa-poke-voltar" class="pqa-action-btn">← Voltar</button>
        <div class="pqa-reader-header">
          <div>
            <div class="pqa-reader-name">${itemSelecionado}</div>
            <div class="pqa-reader-sub">${item ? labelCategoria(item.category) : ''}${item && item.npcPrice ? ` · $${item.npcPrice}` : ''}</div>
          </div>
        </div>
        <div class="pqa-section-title">Quem dropa</div>
        <div class="pqa-move-list">
          ${dropsDoItem.length
            ? dropsDoItem.map((d) => `
                <div class="pqa-move-row">
                  <span class="pqa-move-nome">${d.pokemon}</span>
                  <span class="pqa-move-dano">${formatarChance(d.chancePercent)} ${d.quantidade}</span>
                </div>
              `).join('')
            : '<div class="pqa-empty-hint">Nenhuma fonte de drop conhecida.</div>'}
        </div>
      `;
      corpo.querySelector('#pqa-poke-voltar').addEventListener('click', () => {
        itemSelecionado = null;
        renderLista();
      });
    }

    renderConteudo();
  }

  /* ---------- Registro ---------- */

  const STYLE = `
    #pqa-poke-search-row { margin-bottom: 8px; }
    #pqa-poke-search-row input {
      width: 100%;
      background: #232f3d;
      border: 1px solid rgba(255,255,255,0.15);
      border-radius: 5px;
      color: #e8edf3;
      padding: 5px 8px;
      font-size: 11px;
    }
    #pqa-poke-categorias { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; }
    .pqa-cat-pill {
      background: #232f3d;
      border: 1px solid rgba(255,255,255,0.12);
      color: #8b9bad;
      border-radius: 10px;
      padding: 3px 9px;
      font-size: 10px;
      cursor: pointer;
    }
    .pqa-cat-pill.pqa-active { background: rgba(255,203,5,0.15); color: #ffcb05; border-color: #ffcb05; }
    #pqa-poke-body { display: flex; flex-direction: column; gap: 2px; max-height: 280px; overflow: auto; }
    .pqa-poke-item-row {
      display: flex;
      justify-content: space-between;
      background: transparent;
      border: none;
      color: #e8edf3;
      padding: 5px 6px;
      font-size: 11px;
      text-align: left;
      cursor: pointer;
      border-radius: 4px;
    }
    .pqa-poke-item-row:hover { background: #232f3d; }
  `;

  core.onPanelReady(() => {
    const styleEl = document.createElement('style');
    styleEl.id = 'pqa-pokepedia-styles';
    styleEl.textContent = STYLE;
    document.head.appendChild(styleEl);

    window.__PQA.panelChrome.registerTab({
      id: 'pokepedia',
      label: 'Poképédia',
      mount(container) {
        pokepediaContainerRef = container;
        renderPokepediaTab(container);
      }
    });

    window.__PQA.pokepedia = { carregarDados };

    core.registerModule('pokepedia');
  });
}

webFrame.executeJavaScript(`(${iniciarPokepedia.toString()})();`);
