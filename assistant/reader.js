// Leitor de Pokémon + calculadora de IV/Power/Potencial. Lê o tooltip do inventário
// do jogo (texto em pt-BR) sempre que ele aparece na tela, cruza com os stats base
// da PokeAPI e estima os 6 IVs individuais. Reimplementação própria das fórmulas
// documentadas (não é o mesmo código do JustPokedex): a fórmula de stat do jogo é
// invertida algebricamente para chegar no IV, e o total mostrado pelo próprio jogo
// (quando existe) sempre tem prioridade sobre a soma estimada.

const { webFrame } = require('electron');

function iniciarLeitor() {
  if (!window.__PQA || !window.__PQA.core) {
    console.error('[PQA] core ausente antes de reader — abortando módulo');
    return;
  }
  if (window.__PQA.reader) return; // já inicializado

  const core = window.__PQA.core;

  const FEATURE = 'reader';
  const TOOLTIP_SELECTOR = '.inv-tip';
  const STAT_EXPONENTS = { hp: 0.95, atk: 0.80, def: 0.80, spa: 0.80, spd: 0.80, vel: 0.95 };
  const MAX_IV_INDIVIDUAL = 32;
  const MAX_IV_TOTAL = 192; // 6 stats * 32

  const SLUG_MAP = {
    'nidoran-f': 'nidoran-f', 'nidoran-m': 'nidoran-m',
    'mr-mime': 'mr-mime', 'mime-jr': 'mime-jr', 'ho-oh': 'ho-oh', 'porygon-z': 'porygon-z',
    'type-null': 'type-null', 'jangmo-o': 'jangmo-o', 'hakamo-o': 'hakamo-o', 'kommo-o': 'kommo-o',
    'tapu-koko': 'tapu-koko', 'tapu-lele': 'tapu-lele', 'tapu-bulu': 'tapu-bulu', 'tapu-fini': 'tapu-fini'
  };

  const RARITY_TIERS = [
    { max: 1.0, label: 'Fraca', color: '#9e9e9e' },
    { max: 1.1, label: 'Comum', color: '#a8a8a8' },
    { max: 1.3, label: 'Incomum', color: '#5ed7b9' },
    { max: 1.5, label: 'Rara', color: '#69b7ff' },
    { max: 1.7, label: 'Épica', color: '#d985ff' },
    { max: 2.0, label: 'Lendária', color: '#f1c644' },
    { max: 3.0, label: 'Mítica', color: '#ff6680' },
    { max: 4.0, label: 'Anciã', color: '#ff9800' }
  ];

  /* ---------- Números / texto pt-BR ---------- */

  function numero(str) {
    if (str === undefined || str === null) return NaN;
    const limpo = String(str).trim().replace(/\./g, '').replace(',', '.');
    const n = parseFloat(limpo);
    return Number.isFinite(n) ? n : NaN;
  }

  /* ---------- Parser do tooltip do jogo ---------- */

  function parsePokemon(texto) {
    if (!texto) return null;
    const linhas = texto.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!linhas.length) return null;

    const nome = linhas[0];
    const inicioStats = /^(Ativo|Nv\s|Qualidade|IV\s|HP\s|Atk\s|Def\s|SpA\s|SpD\s|Vel\s|.*Poder)/i;
    let idx = 1;
    const tipos = [];
    while (idx < linhas.length && !inicioStats.test(linhas[idx])) {
      tipos.push(linhas[idx]);
      idx++;
    }

    const resto = linhas.slice(idx).join('\n');
    const campo = (label) => resto.match(new RegExp(`${label}\\s+([\\d.,]+)`, 'i'));

    const nivelMatch = resto.match(/Nv\s*(\d+)/i);
    const qualidadeMatch = resto.match(/Qualidade\s+([^\n]+)/i);
    const ivMatch = resto.match(/IV\s*(\d+)\s*\/\s*(\d+)/i);
    const poderMatch = resto.match(/Poder\s+([\d.,]+)/i);

    let qualidade = 1;
    if (qualidadeMatch) {
      const mult = qualidadeMatch[1].match(/(?:×|x)\s*([\d.,]+)/i);
      if (mult) {
        // O multiplicador ("×1.72") usa ponto como separador decimal, diferente dos
        // outros números do tooltip (ex.: "10.861" de Poder, onde o ponto é milhar) —
        // não pode passar por numero(), que assumiria milhar e leria "172".
        const valor = parseFloat(mult[1].replace(',', '.'));
        if (Number.isFinite(valor) && valor > 0) qualidade = valor;
      }
    }

    const hp = campo('HP');
    const atk = campo('Atk');
    const def = campo('Def');
    const spa = campo('SpA');
    const spd = campo('SpD');
    const vel = campo('Vel');

    return {
      nome,
      tipos,
      nivel: nivelMatch ? parseInt(nivelMatch[1], 10) : null,
      qualidadeTexto: qualidadeMatch ? qualidadeMatch[1].trim() : null,
      qualidade,
      ivAtual: ivMatch ? parseInt(ivMatch[1], 10) : null,
      ivMaximo: ivMatch ? parseInt(ivMatch[2], 10) : null,
      poder: poderMatch ? numero(poderMatch[1]) : null,
      stats: {
        hp: hp ? numero(hp[1]) : null,
        atk: atk ? numero(atk[1]) : null,
        def: def ? numero(def[1]) : null,
        spa: spa ? numero(spa[1]) : null,
        spd: spd ? numero(spd[1]) : null,
        vel: vel ? numero(vel[1]) : null
      }
    };
  }

  /* ---------- Nome -> slug PokeAPI ---------- */

  function normalizarNomePokemon(nomeOriginal) {
    if (!nomeOriginal) return '';
    let n = nomeOriginal.normalize('NFD').replace(/[̀-ͯ]/g, '');
    n = n.replace(/shiny/gi, '').trim();
    n = n.replace(/♀/g, '-f').replace(/♂/g, '-m');
    n = n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return SLUG_MAP[n] || n;
  }

  async function buscarAtributosBase(nomeOriginal) {
    const slug = normalizarNomePokemon(nomeOriginal);
    if (!slug) return null;

    const cache = core.storage.get(FEATURE, 'pokeapi-cache', {});
    if (cache[slug]) return cache[slug];

    const tentativas = [slug];
    if (slug.includes('-')) tentativas.push(slug.split('-')[0]);

    for (const tentativa of tentativas) {
      try {
        const res = await fetch(`https://pokeapi.co/api/v2/pokemon/${tentativa}`);
        if (!res.ok) continue;
        const data = await res.json();
        const statMap = {};
        for (const s of data.stats) statMap[s.stat.name] = s.base_stat;
        const resultado = {
          base: {
            hp: statMap.hp, atk: statMap.attack, def: statMap.defense,
            spa: statMap['special-attack'], spd: statMap['special-defense'], vel: statMap.speed
          },
          tipos: data.types.map((t) => t.type.name),
          spriteId: data.id
        };
        cache[slug] = resultado;
        core.storage.set(FEATURE, 'pokeapi-cache', cache);
        return resultado;
      } catch (e) {
        // tenta a próxima variação de slug (ex.: "tapu-koko" -> "tapu")
      }
    }
    return null;
  }

  let listaEspecies = null;
  async function buscarListaEspecies() {
    if (listaEspecies) return listaEspecies;
    try {
      const res = await fetch('https://pokeapi.co/api/v2/pokemon?limit=1302&offset=0');
      const data = await res.json();
      listaEspecies = data.results.map((r) => r.name);
    } catch (e) {
      listaEspecies = [];
    }
    return listaEspecies;
  }

  /* ---------- Fórmulas de IV / Power / Potencial ---------- */
  // stat = round((base + 2*iv) * (nivel/100) * qualidade^expoente) — invertida
  // algebricamente para estimar iv a partir do stat mostrado no jogo.

  function calcularStat(base, iv, nivel, qualidade, expoente) {
    return Math.round((base + 2 * iv) * (nivel / 100) * Math.pow(qualidade, expoente));
  }

  function estimarIVIndividual(statAtual, base, nivel, qualidade, expoente) {
    if (!Number.isFinite(statAtual) || !Number.isFinite(base) || !nivel || nivel <= 0 || !qualidade || qualidade <= 0) return 0;
    const fator = (nivel / 100) * Math.pow(qualidade, expoente);
    if (!Number.isFinite(fator) || fator <= 0) return 0;
    const ivFloat = ((statAtual / fator) - base) / 2;
    // A própria wiki do jogo documenta growth (IV) como 1..32 por stat, não 0..32
    // (poke.idleworld.online/pokepedia/systems/quality) — o piso do clamp é 1.
    return Math.min(MAX_IV_INDIVIDUAL, Math.max(1, ivFloat));
  }

  function calcularIVsIndividuais(stats, base, nivel, qualidade) {
    const resultado = {};
    for (const chave of Object.keys(STAT_EXPONENTS)) {
      resultado[chave] = estimarIVIndividual(stats[chave], base[chave], nivel, qualidade, STAT_EXPONENTS[chave]);
    }
    return resultado;
  }

  function calcularPoderEstimado(base, ivs, nivel, qualidade) {
    let soma = 0;
    for (const chave of Object.keys(STAT_EXPONENTS)) {
      soma += calcularStat(base[chave], ivs[chave], nivel, qualidade, STAT_EXPONENTS[chave]);
    }
    return Math.round(qualidade * soma);
  }

  function calcularIVTotal(ivsIndividuais, ivAtualJogo) {
    if (ivAtualJogo && ivAtualJogo > 0) return ivAtualJogo;
    const soma = Object.values(ivsIndividuais).reduce((a, b) => a + b, 0);
    return Math.ceil(soma);
  }

  // A qualidade NÃO entra nessa conta de propósito: potencial reflete só a
  // perfeição dos IVs de crescimento, independente do multiplicador de captura.
  function calcularPotencial(ivsIndividuais, ivTotalFornecido) {
    if (ivTotalFornecido && ivTotalFornecido > 0) {
      return Math.min(100, Math.max(0, (ivTotalFornecido / MAX_IV_TOTAL) * 100));
    }
    const soma = Object.values(ivsIndividuais).reduce((a, b) => a + b, 0);
    return Math.min(100, Math.max(0, (soma / MAX_IV_TOTAL) * 100));
  }

  function classificarPotencial(pct) {
    if (pct >= 95) return { label: 'Excepcional', color: '#61f6a4' };
    if (pct >= 85) return { label: 'Excelente', color: '#54e7d2' };
    if (pct >= 72) return { label: 'Muito bom', color: '#5ed7b9' };
    if (pct >= 58) return { label: 'Bom', color: '#69b7ff' };
    if (pct >= 42) return { label: 'Mediano', color: '#f1c644' };
    if (pct >= 25) return { label: 'Abaixo da média', color: '#f39a4b' };
    return { label: 'Fraco', color: '#f05a62' };
  }

  function classificarIVIndividual(iv) {
    if (iv >= 31.5) return { label: 'Perfeito', color: '#61f6a4' };
    if (iv >= 27) return { label: 'Ótimo', color: '#54e7d2' };
    if (iv >= 21) return { label: 'Bom', color: '#69b7ff' };
    if (iv >= 14) return { label: 'Médio', color: '#f1c644' };
    return { label: 'Baixo', color: '#f05a62' };
  }

  function classificarQualidade(qualidade) {
    for (const tier of RARITY_TIERS) {
      if (qualidade < tier.max) return tier;
    }
    return { label: 'Divina', color: '#00bcd4' };
  }

  // IV (genética) e Qualidade (raridade da captura) são rolagens independentes
  // no jogo — dá pra ter os dois extremos ao mesmo tempo. O "Potencial de IV"
  // continua medindo só a genética (por design, ver calcularPotencial), mas
  // sozinho isso engana: um IV excepcional com Qualidade fraca não é um Pokémon
  // "muito bom" de verdade. A Avaliação Geral existe pra responder essa pergunta,
  // combinando os dois — sem substituir o Potencial de IV, que continua útil por
  // si só (ex.: pra saber se vale criar/passar os IVs adiante).
  const ORDEM_QUALIDADE = ['Fraca', 'Comum', 'Incomum', 'Rara', 'Épica', 'Lendária', 'Mítica', 'Anciã', 'Divina'];

  function calcularScoreQualidade(qualidade) {
    const tier = classificarQualidade(qualidade);
    const posicao = ORDEM_QUALIDADE.indexOf(tier.label);
    const indice = posicao >= 0 ? posicao : 0;
    return ((indice + 1) / ORDEM_QUALIDADE.length) * 100;
  }

  // A wiki oficial do jogo (poke.idleworld.online/pokepedia/systems/power) diz
  // literalmente: "a Qualidade pesa quase o dobro do IV" no resultado final, e
  // avisa contra multiplicar "tier × IV" (o "mito do Tier × IV"). Por isso a
  // combinação aqui é uma média ponderada 1/3 IV : 2/3 Qualidade — não 50/50 —
  // pra bater com o que o próprio jogo diz que pesa mais.
  function calcularAvaliacaoGeral(potencialIV, qualidade) {
    const scoreQualidade = calcularScoreQualidade(qualidade);
    const combinado = (potencialIV * (1 / 3)) + (scoreQualidade * (2 / 3));
    return Math.min(100, Math.max(0, combinado));
  }

  function construirLinkPIW(pokemon) {
    const s = pokemon.stats;
    const params = new URLSearchParams({
      pokemon: pokemon.nome || '',
      level: String(pokemon.nivel || ''),
      hp: String(s.hp ?? ''),
      atk: String(s.atk ?? ''),
      def: String(s.def ?? ''),
      spatk: String(s.spa ?? ''),
      spdef: String(s.spd ?? ''),
      speed: String(s.vel ?? ''),
      tab: 'route',
      routeTarget: '300'
    });
    return `https://piwtools.pages.dev/hunt?${params.toString()}`;
  }

  async function analisarPokemon(pokemon) {
    const base = await buscarAtributosBase(pokemon.nome);
    if (!base || !base.base || Object.values(base.base).some((v) => v === undefined)) {
      return { pokemon, erro: 'Não foi possível obter os stats base (PokeAPI).' };
    }

    const nivel = pokemon.nivel || 1;
    const qualidade = pokemon.qualidade || 1;
    const temStatsCompletos = Object.values(pokemon.stats).every((v) => Number.isFinite(v));

    const ivsIndividuais = temStatsCompletos
      ? calcularIVsIndividuais(pokemon.stats, base.base, nivel, qualidade)
      : { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, vel: 0 };

    const potencial = calcularPotencial(ivsIndividuais, pokemon.ivAtual);

    return {
      pokemon,
      base: base.base,
      spriteId: base.spriteId,
      ivsIndividuais,
      ivTotal: calcularIVTotal(ivsIndividuais, pokemon.ivAtual),
      potencial,
      avaliacaoGeral: calcularAvaliacaoGeral(potencial, qualidade),
      poderEstimado: temStatsCompletos ? calcularPoderEstimado(base.base, ivsIndividuais, nivel, qualidade) : null
    };
  }

  /* ---------- Histórico (últimos 10, dedupe por nome+nível+poder) ---------- */

  function salvarHistorico(analise) {
    if (!analise || analise.erro || analise.manual) return;
    const historico = core.storage.get(FEATURE, 'history', []);
    const chave = (a) => `${a.pokemon.nome}|${a.pokemon.nivel}|${a.pokemon.poder}`;
    const filtrado = historico.filter((a) => chave(a) !== chave(analise));
    filtrado.unshift(analise);
    const truncado = filtrado.slice(0, 10);
    core.storage.set(FEATURE, 'history', truncado);
  }

  /* ---------- Estado do módulo ---------- */

  let ultimaAnalise = null;
  let readerContainerRef = null;
  let compareContainerRef = null;

  function setAnaliseAtual(analise) {
    const nomeAnterior = ultimaAnalise && !ultimaAnalise.erro ? ultimaAnalise.pokemon.nome : null;
    const nomeNovo = analise && !analise.erro ? analise.pokemon.nome : null;
    ultimaAnalise = analise;
    if (readerContainerRef) {
      renderReaderContent(readerContainerRef);
      renderHistoryStrip(readerContainerRef);
    }
    if (compareContainerRef) renderCompareContent(compareContainerRef);
    // Sinal para outros módulos (ex.: combat.js) saberem quando o Pokémon em foco
    // mudou, para limpar contadores por sessão de caça.
    if (nomeNovo !== nomeAnterior) core.emit('pokemon-changed', analise);
  }

  function onFixar() {
    if (!ultimaAnalise || ultimaAnalise.erro) return;
    core.storage.set(FEATURE, 'fixed', ultimaAnalise);
    if (compareContainerRef) renderCompareContent(compareContainerRef);
  }

  function onDesfixar() {
    core.storage.remove(FEATURE, 'fixed');
    if (compareContainerRef) renderCompareContent(compareContainerRef);
  }

  async function onTooltipTexto(texto) {
    const pokemon = parsePokemon(texto);
    if (!pokemon || !pokemon.nome) return;
    const analise = await analisarPokemon(pokemon);
    setAnaliseAtual(analise);
    salvarHistorico(analise);
    if (readerContainerRef) renderHistoryStrip(readerContainerRef);
  }

  function iniciarObservadorTooltip() {
    let ultimoTexto = '';
    function processar(el) {
      const texto = el.innerText || '';
      if (!texto.includes('Poder') || !/Nv\s*\d+/i.test(texto)) return;
      if (texto === ultimoTexto) return;
      ultimoTexto = texto;
      onTooltipTexto(texto);
    }

    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (!(node instanceof Element)) continue;
          if (node.matches && node.matches(TOOLTIP_SELECTOR)) processar(node);
          const achado = node.querySelector ? node.querySelector(TOOLTIP_SELECTOR) : null;
          if (achado) processar(achado);
        }
        if (m.type === 'characterData') {
          const alvo = m.target.parentElement;
          const tip = alvo && alvo.closest ? alvo.closest(TOOLTIP_SELECTOR) : null;
          if (tip) processar(tip);
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  /* ---------- Renderização ---------- */

  function spriteUrl(speciesId, shiny) {
    if (!speciesId) return '';
    return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${shiny ? 'shiny/' : ''}${speciesId}.png`;
  }

  function tiposBadgesHtml(tipos) {
    if (!tipos || !tipos.length) return '';
    const types = window.__PQA.types;
    return `<div class="pqa-type-badges">${tipos.map((t) => {
      const chave = types ? types.normalizeKey(t) : null;
      const cor = chave && types.COLORS[chave] ? types.COLORS[chave] : '#8b9bad';
      return `<span class="pqa-type-badge" style="background:${cor}">${t}</span>`;
    }).join('')}</div>`;
  }

  function statBarHtml(label, valorAtual, ivEstimado) {
    const tier = classificarIVIndividual(ivEstimado);
    const pct = Math.round((ivEstimado / MAX_IV_INDIVIDUAL) * 100);
    return `
      <div class="pqa-stat-row">
        <span class="pqa-stat-label">${label}</span>
        <span class="pqa-stat-value">${valorAtual ?? '—'}</span>
        <div class="pqa-stat-bar"><div class="pqa-stat-bar-fill" style="width:${pct}%;background:${tier.color}"></div></div>
        <span class="pqa-stat-iv" style="color:${tier.color}">${ivEstimado.toFixed(1)}</span>
      </div>
    `;
  }

  function renderReaderContent(container) {
    const alvo = container.querySelector('#pqa-reader-content');
    if (!alvo) return;
    const analise = ultimaAnalise;

    if (!analise) {
      alvo.innerHTML = '<div class="pqa-empty-hint">Passe o mouse em um Pokémon no jogo para analisar.</div>';
      return;
    }
    if (analise.erro) {
      alvo.innerHTML = `<div class="pqa-empty-hint">${analise.pokemon.nome}: ${analise.erro}</div>`;
      return;
    }

    const { pokemon, ivsIndividuais, ivTotal, potencial, avaliacaoGeral, poderEstimado, spriteId } = analise;
    const isShiny = /shiny/i.test(pokemon.nome);
    const sprite = spriteUrl(spriteId, isShiny);
    const tierQualidade = classificarQualidade(pokemon.qualidade);

    if (analise.manual) {
      const b = analise.base || {};
      alvo.innerHTML = `
        <div class="pqa-reader-header">
          ${sprite ? `<img class="pqa-sprite" src="${sprite}" alt="">` : ''}
          <div>
            <div class="pqa-reader-name">${pokemon.nome}</div>
            <div class="pqa-reader-sub">Busca manual (PokeAPI)</div>
            ${tiposBadgesHtml(pokemon.tipos)}
          </div>
        </div>
        <div class="pqa-empty-hint">Só mostra os stats base. Para estimar IV, passe o mouse nesse Pokémon dentro do jogo.</div>
        <div class="pqa-base-stats">
          HP ${b.hp ?? '—'} · Atk ${b.atk ?? '—'} · Def ${b.def ?? '—'} · SpA ${b.spa ?? '—'} · SpD ${b.spd ?? '—'} · Vel ${b.vel ?? '—'}
        </div>
      `;
      return;
    }

    const tierPotencial = classificarPotencial(potencial);
    const tierAvaliacao = classificarPotencial(avaliacaoGeral);

    alvo.innerHTML = `
      <div class="pqa-reader-header">
        ${sprite ? `<img class="pqa-sprite" src="${sprite}" alt="">` : ''}
        <div>
          <div class="pqa-reader-name">${pokemon.nome}</div>
          <div class="pqa-reader-sub">Nv. ${pokemon.nivel ?? '?'} · <span style="color:${tierQualidade.color}">${tierQualidade.label}</span> (×${pokemon.qualidade.toFixed(2)})</div>
          ${tiposBadgesHtml(pokemon.tipos)}
        </div>
      </div>
      <div class="pqa-badges-row">
        <div class="pqa-potential-badge" style="border-color:${tierAvaliacao.color};color:${tierAvaliacao.color}">
          Avaliação Geral: ${avaliacaoGeral.toFixed(1)}% — ${tierAvaliacao.label}
        </div>
        <div class="pqa-potential-badge pqa-badge-secundario" style="border-color:${tierPotencial.color};color:${tierPotencial.color}">
          Potencial de IV: ${potencial.toFixed(1)}% — ${tierPotencial.label} · IV total ${ivTotal}/${MAX_IV_TOTAL}
        </div>
      </div>
      <div class="pqa-empty-hint">
        Avaliação Geral pesa Qualidade quase o dobro do IV (como o próprio jogo
        documenta em Pokepédia → Sistemas → Power) — um IV excelente com Qualidade
        fraca não é um Pokémon muito bom de verdade. Potencial de IV é só a
        genética, útil pra saber se vale criar/evoluir mesmo com Qualidade baixa.
      </div>
      <div class="pqa-power-row">
        Poder: ${pokemon.poder ?? '—'}${poderEstimado ? ` <span class="pqa-power-est">(estimado: ${poderEstimado})</span>` : ''}
      </div>
      <div class="pqa-stats">
        ${statBarHtml('HP', pokemon.stats.hp, ivsIndividuais.hp)}
        ${statBarHtml('Atk', pokemon.stats.atk, ivsIndividuais.atk)}
        ${statBarHtml('Def', pokemon.stats.def, ivsIndividuais.def)}
        ${statBarHtml('SpA', pokemon.stats.spa, ivsIndividuais.spa)}
        ${statBarHtml('SpD', pokemon.stats.spd, ivsIndividuais.spd)}
        ${statBarHtml('Vel', pokemon.stats.vel, ivsIndividuais.vel)}
      </div>
      <div class="pqa-reader-actions">
        <button id="pqa-btn-fixar" class="pqa-action-btn">📌 Fixar p/ comparar</button>
        <button id="pqa-btn-piw" class="pqa-action-btn">🔗 Simular no PIW Tools</button>
      </div>
    `;

    const btnFixar = alvo.querySelector('#pqa-btn-fixar');
    if (btnFixar) btnFixar.addEventListener('click', onFixar);
    const btnPiw = alvo.querySelector('#pqa-btn-piw');
    if (btnPiw) btnPiw.addEventListener('click', () => window.open(construirLinkPIW(pokemon), '_blank'));
  }

  function renderHistoryStrip(container) {
    const el = container.querySelector('#pqa-reader-history');
    if (!el) return;
    const hist = core.storage.get(FEATURE, 'history', []);
    el.innerHTML = hist.length
      ? hist.map((a, i) => `<button class="pqa-hist-item" data-idx="${i}">${a.pokemon.nome}</button>`).join('')
      : '<span class="pqa-empty-hint">Sem histórico ainda.</span>';
    el.querySelectorAll('.pqa-hist-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        const entry = hist[Number(btn.dataset.idx)];
        if (entry) setAnaliseAtual(entry);
      });
    });
  }

  function renderCompareContent(container) {
    const fixado = core.storage.get(FEATURE, 'fixed', null);
    if (!fixado || fixado.erro) {
      container.innerHTML = '<div class="pqa-empty-hint">Nenhum Pokémon fixado. Na aba Pokémon, analise um e clique em "Fixar".</div>';
      return;
    }
    if (!ultimaAnalise || ultimaAnalise.erro || ultimaAnalise.manual) {
      container.innerHTML = `
        <div class="pqa-empty-hint">Fixado: ${fixado.pokemon.nome} (Nv. ${fixado.pokemon.nivel ?? '?'}). Passe o mouse em outro Pokémon para comparar.</div>
        <button id="pqa-btn-desfixar" class="pqa-action-btn">Remover fixado</button>
      `;
      container.querySelector('#pqa-btn-desfixar').addEventListener('click', onDesfixar);
      return;
    }

    function linha(label, a, b) {
      const seta = b > a ? '▲' : b < a ? '▼' : '=';
      const cor = b > a ? '#61f6a4' : b < a ? '#f05a62' : '#8b9bad';
      return `<div class="pqa-compare-row"><span>${label}</span><span>${a.toFixed(1)}</span><span style="color:${cor}">${seta}</span><span>${b.toFixed(1)}</span></div>`;
    }

    const a = fixado;
    const b = ultimaAnalise;
    container.innerHTML = `
      <div class="pqa-compare-header">
        <span>${a.pokemon.nome} (fixado)</span>
        <span>${b.pokemon.nome} (atual)</span>
      </div>
      ${linha('HP', a.ivsIndividuais.hp, b.ivsIndividuais.hp)}
      ${linha('Atk', a.ivsIndividuais.atk, b.ivsIndividuais.atk)}
      ${linha('Def', a.ivsIndividuais.def, b.ivsIndividuais.def)}
      ${linha('SpA', a.ivsIndividuais.spa, b.ivsIndividuais.spa)}
      ${linha('SpD', a.ivsIndividuais.spd, b.ivsIndividuais.spd)}
      ${linha('Vel', a.ivsIndividuais.vel, b.ivsIndividuais.vel)}
      ${linha('IV total', a.ivTotal, b.ivTotal)}
      ${linha('Potencial %', a.potencial, b.potencial)}
      ${linha('Avaliação Geral', a.avaliacaoGeral, b.avaliacaoGeral)}
      <div class="pqa-reader-actions">
        <button id="pqa-btn-desfixar" class="pqa-action-btn">Remover fixado</button>
        <button id="pqa-btn-refixar" class="pqa-action-btn">📌 Fixar o atual</button>
      </div>
    `;
    container.querySelector('#pqa-btn-desfixar').addEventListener('click', onDesfixar);
    container.querySelector('#pqa-btn-refixar').addEventListener('click', onFixar);
  }

  function wireSearch(container) {
    const input = container.querySelector('#pqa-reader-search-input');
    const results = container.querySelector('#pqa-reader-search-results');
    if (!input || !results) return;

    let timer = null;
    input.addEventListener('input', () => {
      clearTimeout(timer);
      const termo = input.value.trim().toLowerCase();
      if (termo.length < 2) {
        results.innerHTML = '';
        return;
      }
      timer = setTimeout(async () => {
        const lista = await buscarListaEspecies();
        const encontrados = lista.filter((n) => n.includes(termo)).slice(0, 8);
        results.innerHTML = encontrados.map((n) => `<button class="pqa-hist-item" data-nome="${n}">${n}</button>`).join('');
        results.querySelectorAll('button').forEach((btn) => {
          btn.addEventListener('click', async () => {
            const nome = btn.dataset.nome;
            const base = await buscarAtributosBase(nome);
            setAnaliseAtual({
              manual: true,
              pokemon: {
                nome,
                tipos: base ? base.tipos : [],
                nivel: null,
                qualidadeTexto: null,
                qualidade: 1,
                ivAtual: null,
                ivMaximo: null,
                poder: null,
                stats: { hp: null, atk: null, def: null, spa: null, spd: null, vel: null }
              },
              base: base ? base.base : null,
              spriteId: base ? base.spriteId : null,
              ivsIndividuais: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, vel: 0 },
              ivTotal: 0,
              potencial: 0,
              avaliacaoGeral: 0,
              poderEstimado: null
            });
          });
        });
      }, 250);
    });
  }

  /* ---------- Registro das abas ---------- */

  const STYLE = `
    #pqa-reader-search { margin-bottom: 8px; }
    #pqa-reader-search-input {
      width: 100%;
      background: #232f3d;
      border: 1px solid rgba(255,255,255,0.15);
      border-radius: 6px;
      color: #e8edf3;
      padding: 6px 9px;
      font-size: 11px;
      transition: border-color 0.12s ease, background 0.12s ease;
    }
    #pqa-reader-search-input:focus {
      outline: none;
      border-color: #ffcb05;
      background: #1b2430;
    }
    #pqa-reader-search-results, #pqa-reader-history {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-top: 6px;
    }
    .pqa-hist-item {
      background: #232f3d;
      border: 1px solid rgba(255,255,255,0.12);
      color: #8b9bad;
      border-radius: 5px;
      padding: 4px 8px;
      font-size: 10px;
      cursor: pointer;
      transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease;
    }
    .pqa-hist-item:hover { color: #e8edf3; border-color: #ffcb05; background: #1b2430; }
    .pqa-reader-header { display: flex; align-items: center; gap: 10px; margin: 6px 0 8px; }
    .pqa-sprite { width: 48px; height: 48px; image-rendering: pixelated; }
    .pqa-reader-name { font-weight: 600; font-size: 13px; }
    .pqa-reader-sub { color: #8b9bad; font-size: 11px; }
    .pqa-type-badges { display: flex; gap: 4px; margin-top: 4px; }
    .pqa-type-badge {
      display: inline-block;
      color: #1b2430;
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.3px;
      padding: 2px 7px;
      border-radius: 4px;
    }
    .pqa-badges-row { display: flex; flex-direction: column; gap: 5px; margin-bottom: 6px; }
    .pqa-potential-badge {
      display: inline-block;
      border: 1px solid;
      border-radius: 5px;
      padding: 3px 8px;
      font-size: 11px;
      font-weight: 600;
    }
    .pqa-badge-secundario { font-weight: 400; opacity: 0.85; }
    .pqa-power-row { font-size: 11px; margin: 8px 0; }
    .pqa-power-est { color: #8b9bad; }
    .pqa-stats { display: flex; flex-direction: column; gap: 5px; margin-bottom: 10px; }
    .pqa-stat-row { display: grid; grid-template-columns: 30px minmax(28px, auto) 1fr 34px; align-items: center; gap: 6px; font-size: 10px; }
    .pqa-stat-label { color: #8b9bad; }
    .pqa-stat-value { text-align: right; font-variant-numeric: tabular-nums; }
    .pqa-stat-bar { height: 6px; background: rgba(255,255,255,0.08); border-radius: 3px; overflow: hidden; }
    .pqa-stat-bar-fill { height: 100%; transition: width 0.25s ease; }
    .pqa-stat-iv { text-align: right; font-variant-numeric: tabular-nums; }
    .pqa-reader-actions { display: flex; gap: 6px; flex-wrap: wrap; }
    .pqa-action-btn {
      background: #232f3d;
      border: 1px solid rgba(255,255,255,0.15);
      color: #e8edf3;
      border-radius: 6px;
      padding: 6px 10px;
      font-size: 10px;
      cursor: pointer;
      transition: border-color 0.12s ease, background 0.12s ease;
    }
    .pqa-action-btn:hover { border-color: #ffcb05; background: #1b2430; }
    .pqa-base-stats { font-size: 11px; color: #8b9bad; margin-top: 4px; }
    .pqa-compare-header { display: flex; justify-content: space-between; font-size: 11px; font-weight: 600; margin-bottom: 6px; }
    .pqa-compare-row { display: grid; grid-template-columns: 60px 1fr 24px 1fr; gap: 6px; font-size: 10px; padding: 2px 0; }
  `;

  function registrarAbas() {
    const styleEl = document.createElement('style');
    styleEl.id = 'pqa-reader-styles';
    styleEl.textContent = STYLE;
    document.head.appendChild(styleEl);

    window.__PQA.panelChrome.registerTab({
      id: 'reader',
      label: 'Pokémon',
      mount(container) {
        container.innerHTML = `
          <div id="pqa-reader-search">
            <input type="text" id="pqa-reader-search-input" placeholder="Buscar espécie na PokeAPI..." autocomplete="off">
            <div id="pqa-reader-search-results"></div>
          </div>
          <div id="pqa-reader-content"></div>
          <div id="pqa-reader-history"></div>
        `;
        readerContainerRef = container;
        wireSearch(container);
        renderReaderContent(container);
        renderHistoryStrip(container);
      }
    });

    window.__PQA.panelChrome.registerTab({
      id: 'compare',
      label: 'Comparar',
      mount(container) {
        compareContainerRef = container;
        renderCompareContent(container);
      }
    });
  }

  window.__PQA.reader = {
    parsePokemon,
    analisarPokemon,
    calcularStat,
    estimarIVIndividual,
    calcularPotencial,
    calcularScoreQualidade,
    calcularAvaliacaoGeral,
    classificarPotencial,
    classificarIVIndividual,
    classificarQualidade,
    construirLinkPIW,
    getCurrentAnalysis: () => ultimaAnalise
  };

  core.onPanelReady(() => {
    registrarAbas();
    iniciarObservadorTooltip();
    core.registerModule('reader');
  });
}

webFrame.executeJavaScript(`(${iniciarLeitor.toString()})();`);
