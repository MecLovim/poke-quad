// Analisador de capturas: registra passivamente toda tentativa de captura que passa
// pela conexão do jogo e calcula estatísticas de sucesso por espécie/bola, com
// intervalo de confiança (Wilson) em vez de taxa bruta — evita achar que uma bola
// é "boa" com base em poucas tentativas. Não manda nenhum comando pro jogo, só lê.
//
// Não há um formato de mensagem confirmado para "resultado de captura" — a
// classificação abaixo é heurística (mesma abordagem documentada no script de
// referência): qualquer mensagem com campos típicos de captura conta como uma.

const { webFrame } = require('electron');

function iniciarAnalisadorDeCapturas() {
  if (!window.__PQA || !window.__PQA.core) {
    console.error('[PQA] core ausente antes de catch-analyzer — abortando módulo');
    return;
  }
  if (window.__PQA.catchAnalyzer) return; // já inicializado

  const core = window.__PQA.core;
  const FEATURE = 'catch';
  const CAP_REGISTROS = 20000;
  const JANELA_ENRIQUECIMENTO_MS = 30000;
  const MIN_TENTATIVAS_CONFIAVEL = 100;

  const MAPA_BALL_ID_NOME = {
    1: 'Poké Ball', 2: 'Great Ball', 3: 'Super Ball', 4: 'Ultra Ball', 5: 'Safari Ball', 6: 'Master Ball'
  };

  /* ---------- Persistência (localStorage — volume esperado não justifica IndexedDB) ---------- */

  function carregarRegistros() {
    return core.storage.get(FEATURE, 'records', []);
  }

  function salvarRegistros(lista) {
    const cortada = lista.length > CAP_REGISTROS ? lista.slice(lista.length - CAP_REGISTROS) : lista;
    core.storage.set(FEATURE, 'records', cortada);
  }

  /* ---------- Cache de mobs vistos em campo (para enriquecer catch-result sem speciesId/shiny) ---------- */

  const mobsCampoMap = new Map(); // "row::col" -> {speciesId, shiny, timestamp}

  function processarPacoteField(msg) {
    const mobs = Array.isArray(msg.mobs) ? msg.mobs : [];
    const agora = Date.now();
    for (const mob of mobs) {
      if (mob.row === undefined || mob.col === undefined) continue;
      mobsCampoMap.set(`${mob.row}::${mob.col}`, {
        speciesId: mob.speciesId ?? null,
        shiny: mob.shiny === true,
        timestamp: agora
      });
    }
    for (const [chave, info] of mobsCampoMap) {
      if (agora - info.timestamp > JANELA_ENRIQUECIMENTO_MS) mobsCampoMap.delete(chave);
    }
  }

  /* ---------- Classificação / extração de evento de captura ---------- */

  // Só pelos campos, sem olhar o "type" — usado pra achar o objeto de verdade
  // dentro de um envelope aninhado (ver encontrarObjetoDeCatch), não pra decidir
  // se uma mensagem qualquer é ou não um evento de captura.
  function pareceEventoDeCatchPorCampos(msg) {
    return msg.success !== undefined || msg.caught !== undefined || msg.ballName !== undefined
      || msg.ballId !== undefined || msg.ball !== undefined || msg.pokeball !== undefined;
  }

  // Uma mensagem tipo {type:'catch-result', data:{...campos de verdade...}} não
  // pode ser registrada a partir do envelope externo (que não tem esses campos) só
  // porque o "type" bate com "catch" — isso geraria um registro com espécie
  // "Desconhecida" e sucesso sempre falso, mesmo quando os dados reais dizem outra
  // coisa. Procura primeiro (na própria mensagem e em .detail/.data/.payload
  // aninhados) por um objeto que realmente tenha os campos; só usa o "type" como
  // decisor de último recurso, quando nenhum objeto com campos foi encontrado.
  function encontrarObjetoDeCatch(msg, profundidade) {
    if (!msg || typeof msg !== 'object' || profundidade > 4) return null;
    if (pareceEventoDeCatchPorCampos(msg)) return msg;
    for (const chave of ['detail', 'data', 'payload']) {
      const encontrado = encontrarObjetoDeCatch(msg[chave], profundidade + 1);
      if (encontrado) return encontrado;
    }
    return null;
  }

  function extrairEventoDeCatch(msg) {
    const timestamp = msg.timestamp || msg.time || msg.ts || Date.now();
    const speciesName = msg.speciesName || msg.pokemonName || msg.pokemon || msg.species || msg.name || 'Desconhecido';
    const ballId = msg.ballId ?? msg.ball_id ?? 0;
    const ballName = msg.ballName || msg.ball || msg.pokeball || msg.ball_name || MAPA_BALL_ID_NOME[ballId] || 'Poké Ball';
    const row = msg.row ?? msg.r ?? msg.y;
    const col = msg.col ?? msg.c ?? msg.x;
    const success = msg.success !== undefined ? Boolean(msg.success)
      : msg.caught !== undefined ? Boolean(msg.caught)
      : (msg.result === 'success' || msg.status === 'success' || msg.status === 'caught');
    const auto = Boolean(msg.auto || msg.isAuto || msg.is_auto);

    let speciesId = msg.speciesId ?? null;
    let shiny = msg.shiny !== undefined ? Boolean(msg.shiny) : null;
    if ((speciesId === null || shiny === null) && row !== undefined && col !== undefined) {
      const info = mobsCampoMap.get(`${row}::${col}`);
      if (info && Date.now() - info.timestamp < JANELA_ENRIQUECIMENTO_MS) {
        if (speciesId === null) speciesId = info.speciesId;
        if (shiny === null) shiny = info.shiny;
      }
    }

    return { timestamp, speciesName, ballId, ballName, row, col, success, auto, speciesId, shiny };
  }

  // Usada só na importação, pra não duplicar um registro que já existe (ver
  // importarJson). Não usamos isso pra filtrar capturas ao vivo: diferente do
  // script de referência (que tinha 3 hooks de WS redundantes entregando a mesma
  // mensagem mais de uma vez, e por isso precisava de um dedupe por janela de
  // tempo), o core.js daqui só tem UM hook — cada frame chega uma vez só. Um
  // dedupe por "mesmos campos" aqui derrubaria tentativas de captura reais e
  // consecutivas (ex.: 3 falhas seguidas com a mesma bola na mesma espécie),
  // que são completamente normais e não duplicatas.
  function chaveDedupe(r) {
    return `${r.speciesName}|${r.ballId}|${r.row}|${r.col}|${r.success}|${r.auto}`;
  }

  function registrarCatch(msg) {
    const evento = extrairEventoDeCatch(msg);
    const registros = carregarRegistros();
    registros.push({ id: `${evento.timestamp}_${Math.random().toString(36).slice(2, 8)}`, ...evento });
    salvarRegistros(registros);
    atualizarAba();
  }

  function processarMensagem(msg) {
    if (!msg || typeof msg !== 'object') return;
    const tipo = String(msg.type || msg.action || msg.event || msg.op || msg.kind || '').toLowerCase();
    if (tipo === 'field') {
      processarPacoteField(msg);
      return;
    }

    const objetoComCampos = encontrarObjetoDeCatch(msg, 0);
    if (objetoComCampos) {
      registrarCatch(objetoComCampos);
      return;
    }
    // Nenhum objeto (raiz ou aninhado) tem campos de captura, mas o "type" da
    // mensagem ainda assim indica que é uma — registra mesmo assim como melhor
    // esforço (fica com "Desconhecida"/insucesso nos campos que faltarem).
    if (tipo.includes('catch')) registrarCatch(msg);
  }

  /* ---------- Estatísticas ---------- */

  function intervaloWilson(sucessos, tentativas) {
    if (!tentativas) return { baixo: 0, alto: 0 };
    const z = 1.96;
    const p = sucessos / tentativas;
    const denom = 1 + (z * z) / tentativas;
    const centro = p + (z * z) / (2 * tentativas);
    const margem = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * tentativas)) / tentativas);
    return {
      baixo: Math.max(0, (centro - margem) / denom) * 100,
      alto: Math.min(1, (centro + margem) / denom) * 100
    };
  }

  function calcularStreaks(registrosOrdenados) {
    let maiorFalha = 0;
    let falhaAtual = 0;
    let streakAtual = 0; // positivo = sequência de sucessos, negativo = de falhas
    for (const r of registrosOrdenados) {
      if (r.success) {
        falhaAtual = 0;
        streakAtual = streakAtual >= 0 ? streakAtual + 1 : 1;
      } else {
        falhaAtual += 1;
        maiorFalha = Math.max(maiorFalha, falhaAtual);
        streakAtual = streakAtual <= 0 ? streakAtual - 1 : -1;
      }
    }
    return { maiorSequenciaFalhas: maiorFalha, streakAtual };
  }

  function classificarAmostra(tentativas) {
    if (tentativas < 30) return 'Muito pequena';
    if (tentativas < 100) return 'Pequena';
    if (tentativas < 500) return 'Média';
    if (tentativas < 1000) return 'Boa';
    return 'Confiável';
  }

  function agrupar(registros, modo) {
    const grupos = new Map();
    for (const r of registros) {
      const chave = modo === 'especie' ? r.speciesName
        : modo === 'bola' ? r.ballName
        : `${r.speciesName} · ${r.ballName}`;
      if (!grupos.has(chave)) grupos.set(chave, []);
      grupos.get(chave).push(r);
    }
    const resultado = [];
    for (const [chave, lista] of grupos) {
      const ordenada = [...lista].sort((a, b) => a.timestamp - b.timestamp);
      const sucessos = ordenada.filter((r) => r.success).length;
      const tentativas = ordenada.length;
      const wilson = intervaloWilson(sucessos, tentativas);
      const streaks = calcularStreaks(ordenada);
      resultado.push({
        chave,
        tentativas,
        sucessos,
        falhas: tentativas - sucessos,
        taxa: tentativas ? (sucessos / tentativas) * 100 : 0,
        wilsonBaixo: wilson.baixo,
        wilsonAlto: wilson.alto,
        maiorSequenciaFalhas: streaks.maiorSequenciaFalhas,
        qualidadeAmostra: classificarAmostra(tentativas),
        ultimoTimestamp: ordenada.length ? ordenada[ordenada.length - 1].timestamp : 0
      });
    }
    return resultado;
  }

  function ordenar(grupos, criterio) {
    const copiados = [...grupos];
    if (criterio === 'tentativas') return copiados.sort((a, b) => b.tentativas - a.tentativas);
    if (criterio === 'alfabetica') return copiados.sort((a, b) => a.chave.localeCompare(b.chave));
    if (criterio === 'recente') return copiados.sort((a, b) => b.ultimoTimestamp - a.ultimoTimestamp);
    if (criterio === 'sequencia') return copiados.sort((a, b) => b.maiorSequenciaFalhas - a.maiorSequenciaFalhas);
    // 'taxa' (padrão): grupos com amostra confiável (>=100) vêm primeiro, senão
    // 1 acerto em 1 tentativa apareceria como "100%" no topo.
    return copiados.sort((a, b) => {
      const aConfiavel = a.tentativas >= MIN_TENTATIVAS_CONFIAVEL;
      const bConfiavel = b.tentativas >= MIN_TENTATIVAS_CONFIAVEL;
      if (aConfiavel !== bConfiavel) return aConfiavel ? -1 : 1;
      return b.taxa - a.taxa;
    });
  }

  function resumoGlobal(registros) {
    const porBola = agrupar(registros, 'bola').filter((g) => g.tentativas >= MIN_TENTATIVAS_CONFIAVEL);
    const porEspecie = agrupar(registros, 'especie');
    const melhorBola = porBola.length ? [...porBola].sort((a, b) => b.taxa - a.taxa)[0] : null;
    const maisTentada = porEspecie.length ? [...porEspecie].sort((a, b) => b.tentativas - a.tentativas)[0] : null;
    return { melhorBola, maisTentada };
  }

  /* ---------- Export / import ---------- */

  function baixarArquivo(nome, conteudo, mime) {
    const blob = new Blob([conteudo], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nome;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportarJson() {
    const payload = { schemaVersion: 1, exportedAt: new Date().toISOString(), records: carregarRegistros() };
    baixarArquivo(`poke-quad-capturas-${Date.now()}.json`, JSON.stringify(payload, null, 2), 'application/json');
  }

  function exportarCsv() {
    const cabecalho = 'timestamp,date,speciesName,ballName,ballId,success,auto,row,col,speciesId,shiny';
    const linhas = carregarRegistros().map((r) => [
      r.timestamp, new Date(r.timestamp).toISOString(), r.speciesName, r.ballName, r.ballId,
      r.success, r.auto, r.row ?? '', r.col ?? '', r.speciesId ?? '', r.shiny === null ? '' : r.shiny
    ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','));
    const conteudo = `﻿${[cabecalho, ...linhas].join('\n')}`;
    baixarArquivo(`poke-quad-capturas-${Date.now()}.csv`, conteudo, 'text/csv');
  }

  function importarJson(texto) {
    try {
      const payload = JSON.parse(texto);
      const entrada = Array.isArray(payload) ? payload : (payload.records || []);
      const existentes = carregarRegistros();
      const idsExistentes = new Set(existentes.map((r) => r.id));
      let adicionados = 0;
      for (const r of entrada) {
        const id = r.id || `${r.timestamp}_${chaveDedupe(r)}`;
        if (idsExistentes.has(id)) continue;
        existentes.push({ ...r, id });
        idsExistentes.add(id);
        adicionados++;
      }
      salvarRegistros(existentes);
      atualizarAba();
      return adicionados;
    } catch (e) {
      return -1;
    }
  }

  /* ---------- Renderização ---------- */

  let analyzerContainerRef = null;
  let modoAgrupamento = 'especie';
  let criterioOrdenacao = 'taxa';

  function atualizarAba() {
    if (analyzerContainerRef) renderAnalyzerTab(analyzerContainerRef);
  }

  function linhaGrupo(g) {
    const confiavel = g.tentativas >= MIN_TENTATIVAS_CONFIAVEL;
    return `
      <div class="pqa-analyzer-row">
        <div class="pqa-analyzer-row-head">
          <span>${g.chave}</span>
          <span class="pqa-reader-sub">${g.qualidadeAmostra}</span>
        </div>
        <div class="pqa-analyzer-row-stats">
          <span>${g.sucessos}/${g.tentativas} (${g.taxa.toFixed(1)}%)</span>
          <span class="pqa-reader-sub">IC95: ${g.wilsonBaixo.toFixed(0)}–${g.wilsonAlto.toFixed(0)}%${!confiavel ? ' · amostra pequena' : ''}</span>
          <span class="pqa-reader-sub">maior sequência de erros: ${g.maiorSequenciaFalhas}</span>
        </div>
      </div>
    `;
  }

  function renderAnalyzerTab(container) {
    const registros = carregarRegistros();
    const grupos = ordenar(agrupar(registros, modoAgrupamento), criterioOrdenacao);
    const resumo = resumoGlobal(registros);

    container.innerHTML = `
      <div class="pqa-analyzer-summary">
        <div>Total: ${registros.length} tentativas</div>
        ${resumo.melhorBola ? `<div>Melhor bola: <strong>${resumo.melhorBola.chave}</strong> (${resumo.melhorBola.taxa.toFixed(1)}%)</div>` : ''}
        ${resumo.maisTentada ? `<div>Mais caçada: <strong>${resumo.maisTentada.chave}</strong> (${resumo.maisTentada.tentativas}x)</div>` : ''}
      </div>
      <div class="pqa-analyzer-controls">
        <select id="pqa-analyzer-agrupar">
          <option value="especie">Por espécie</option>
          <option value="bola">Por bola</option>
          <option value="combo">Espécie + bola</option>
        </select>
        <select id="pqa-analyzer-ordenar">
          <option value="taxa">Taxa de sucesso</option>
          <option value="tentativas">Tentativas</option>
          <option value="sequencia">Maior sequência de erros</option>
          <option value="recente">Mais recente</option>
          <option value="alfabetica">A-Z</option>
        </select>
      </div>
      <div id="pqa-analyzer-list">${grupos.length ? grupos.map(linhaGrupo).join('') : '<div class="pqa-empty-hint">Nenhuma captura registrada ainda.</div>'}</div>
      <div class="pqa-reader-actions">
        <button id="pqa-analyzer-export-json" class="pqa-action-btn">Exportar JSON</button>
        <button id="pqa-analyzer-export-csv" class="pqa-action-btn">Exportar CSV</button>
        <label class="pqa-action-btn pqa-import-label">Importar<input type="file" id="pqa-analyzer-import" accept=".json" class="pqa-hidden-input"></label>
        <button id="pqa-analyzer-clear" class="pqa-action-btn">Limpar tudo</button>
      </div>
    `;

    const selAgrupar = container.querySelector('#pqa-analyzer-agrupar');
    selAgrupar.value = modoAgrupamento;
    selAgrupar.addEventListener('change', (e) => { modoAgrupamento = e.target.value; renderAnalyzerTab(container); });

    const selOrdenar = container.querySelector('#pqa-analyzer-ordenar');
    selOrdenar.value = criterioOrdenacao;
    selOrdenar.addEventListener('change', (e) => { criterioOrdenacao = e.target.value; renderAnalyzerTab(container); });

    container.querySelector('#pqa-analyzer-export-json').addEventListener('click', exportarJson);
    container.querySelector('#pqa-analyzer-export-csv').addEventListener('click', exportarCsv);
    container.querySelector('#pqa-analyzer-import').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const texto = await file.text();
      const n = importarJson(texto);
      alert(n >= 0 ? `${n} registro(s) importado(s).` : 'Arquivo inválido.');
      e.target.value = '';
    });
    container.querySelector('#pqa-analyzer-clear').addEventListener('click', () => {
      if (!confirm('Apagar todo o histórico de capturas desta conta?')) return;
      salvarRegistros([]);
      renderAnalyzerTab(container);
    });
  }

  /* ---------- Registro ---------- */

  const STYLE = `
    .pqa-analyzer-summary { font-size: 11px; margin-bottom: 8px; display: flex; flex-direction: column; gap: 2px; }
    .pqa-analyzer-controls { display: flex; gap: 6px; margin-bottom: 8px; }
    .pqa-analyzer-controls select {
      flex: 1;
      background: #232f3d;
      border: 1px solid rgba(255,255,255,0.15);
      border-radius: 5px;
      color: #e8edf3;
      padding: 4px 6px;
      font-size: 10px;
    }
    #pqa-analyzer-list { display: flex; flex-direction: column; gap: 6px; max-height: 260px; overflow: auto; margin-bottom: 8px; }
    .pqa-analyzer-row { background: #232f3d; border-radius: 5px; padding: 6px 8px; font-size: 10px; }
    .pqa-analyzer-row-head { display: flex; justify-content: space-between; font-weight: 600; margin-bottom: 3px; }
    .pqa-analyzer-row-stats { display: flex; flex-direction: column; gap: 1px; color: #69b7ff; }
    .pqa-import-label { display: inline-flex; align-items: center; }
    .pqa-hidden-input { display: none; }
  `;

  core.onPanelReady(() => {
    const styleEl = document.createElement('style');
    styleEl.id = 'pqa-catch-styles';
    styleEl.textContent = STYLE;
    document.head.appendChild(styleEl);

    window.__PQA.panelChrome.registerTab({
      id: 'catch',
      label: 'Capturas',
      mount(container) {
        analyzerContainerRef = container;
        renderAnalyzerTab(container);
      }
    });

    core.on('ws-frame', (e) => processarMensagem(e.detail));

    window.__PQA.catchAnalyzer = {
      getRecords: carregarRegistros,
      getGroupedStats: (modo) => agrupar(carregarRegistros(), modo || 'especie')
    };

    core.registerModule('catch-analyzer');
  });
}

webFrame.executeJavaScript(`(${iniciarAnalisadorDeCapturas.toString()})();`);
