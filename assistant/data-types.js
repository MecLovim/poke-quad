// Tabela estática de efetividade de tipo (Gen 6+, 18 tipos incluindo Fada). Dado de
// design de jogo, não depende de nada do servidor — mesma tabela usada em qualquer
// jogo Pokémon dessa geração em diante. Só multiplicadores != 1 são listados; tudo
// que não aparece é neutro (×1).

const { webFrame } = require('electron');

function iniciarTabelaDeTipos() {
  if (!window.__PQA || !window.__PQA.core) {
    console.error('[PQA] core ausente antes de data-types — abortando módulo');
    return;
  }
  if (window.__PQA.types) return; // já inicializado

  const CHART = {
    normal: { rock: 0.5, ghost: 0, steel: 0.5 },
    fire: { fire: 0.5, water: 0.5, grass: 2, ice: 2, bug: 2, rock: 0.5, dragon: 0.5, steel: 2 },
    water: { fire: 2, water: 0.5, grass: 0.5, ground: 2, rock: 2, dragon: 0.5 },
    electric: { water: 2, electric: 0.5, grass: 0.5, ground: 0, flying: 2, dragon: 0.5 },
    grass: { fire: 0.5, water: 2, grass: 0.5, poison: 0.5, ground: 2, flying: 0.5, bug: 0.5, rock: 2, dragon: 0.5, steel: 0.5 },
    ice: { fire: 0.5, water: 0.5, grass: 2, ice: 0.5, ground: 2, flying: 2, dragon: 2, steel: 0.5 },
    fighting: { normal: 2, ice: 2, poison: 0.5, flying: 0.5, psychic: 0.5, bug: 0.5, rock: 2, ghost: 0, dark: 2, steel: 2, fairy: 0.5 },
    poison: { grass: 2, poison: 0.5, ground: 0.5, rock: 0.5, ghost: 0.5, steel: 0, fairy: 2 },
    ground: { fire: 2, electric: 2, grass: 0.5, poison: 2, flying: 0, bug: 0.5, rock: 2, steel: 2 },
    flying: { electric: 0.5, grass: 2, fighting: 2, bug: 2, rock: 0.5, steel: 0.5 },
    psychic: { fighting: 2, poison: 2, psychic: 0.5, dark: 0, steel: 0.5 },
    bug: { fire: 0.5, grass: 2, fighting: 0.5, poison: 0.5, flying: 0.5, psychic: 2, ghost: 0.5, dark: 2, steel: 0.5, fairy: 0.5 },
    rock: { fire: 2, ice: 2, fighting: 0.5, ground: 0.5, flying: 2, bug: 2, steel: 0.5 },
    ghost: { normal: 0, psychic: 2, ghost: 2, dark: 0.5 },
    dragon: { dragon: 2, steel: 0.5, fairy: 0 },
    dark: { fighting: 0.5, psychic: 2, ghost: 2, dark: 0.5, fairy: 0.5 },
    steel: { fire: 0.5, water: 0.5, electric: 0.5, ice: 2, rock: 2, steel: 0.5, fairy: 2 },
    fairy: { fire: 0.5, fighting: 2, poison: 0.5, dragon: 2, dark: 2, steel: 0.5 }
  };

  // Mesma paleta de cores por tipo usada em qualquer client Pokémon "padrão"; os 4
  // primeiros já coincidem com as CSS vars --fire/--water/--grass/--electric que o
  // index.html do Poke Quad já usa, mantendo consistência visual no app inteiro.
  const COLORS = {
    normal: '#a8a878', fire: '#f08030', water: '#6890f0', electric: '#f8d030',
    grass: '#78c850', ice: '#98d8d8', fighting: '#c03028', poison: '#a040a0',
    ground: '#e0c068', flying: '#a890f0', psychic: '#f85888', bug: '#a8b820',
    rock: '#b8a038', ghost: '#705898', dragon: '#7038f8', dark: '#705848',
    steel: '#b8b8d0', fairy: '#ee99ac'
  };

  // O jogo mostra os tipos em português (tooltip do inventário); mapeia rótulo
  // pt-BR -> chave interna usada em CHART/COLORS. Também serve de tabela geral de
  // apelidos: "neutral" é como /game/creatures.json rotula golpes tipo Normal
  // (confirmado ao vivo: Swords Dance, Growl etc. — todos Normal nos jogos oficiais,
  // só 8 de 3549 golpes usam esse rótulo) — sem isso, esses golpes apareciam sem
  // tradução nem cor na aba Combate.
  const PT_TO_KEY = {
    normal: 'normal', neutral: 'normal', fogo: 'fire', água: 'water', agua: 'water', elétrico: 'electric',
    eletrico: 'electric', grama: 'grass', planta: 'grass', gelo: 'ice', lutador: 'fighting',
    veneno: 'poison', terra: 'ground', voador: 'flying', psíquico: 'psychic',
    psiquico: 'psychic', inseto: 'bug', pedra: 'rock', rocha: 'rock', fantasma: 'ghost',
    dragão: 'dragon', dragao: 'dragon', sombrio: 'dark', noturno: 'dark', aço: 'steel',
    aco: 'steel', fada: 'fairy'
  };

  const KEY_TO_PT = {
    normal: 'Normal', fire: 'Fogo', water: 'Água', electric: 'Elétrico', grass: 'Grama',
    ice: 'Gelo', fighting: 'Lutador', poison: 'Veneno', ground: 'Terra', flying: 'Voador',
    psychic: 'Psíquico', bug: 'Inseto', rock: 'Pedra', ghost: 'Fantasma', dragon: 'Dragão',
    dark: 'Sombrio', steel: 'Aço', fairy: 'Fada'
  };

  function normalizeKey(type) {
    if (!type) return null;
    const raw = String(type).trim().toLowerCase();
    if (CHART[raw]) return raw;
    return PT_TO_KEY[raw] || null;
  }

  function getMultiplier(attackerType, defenderTypes) {
    const atk = normalizeKey(attackerType);
    if (!atk) return 1;
    const defenders = Array.isArray(defenderTypes) ? defenderTypes : [defenderTypes];
    let mult = 1;
    for (const def of defenders) {
      const defKey = normalizeKey(def);
      if (!defKey) continue;
      const table = CHART[atk];
      mult *= table && table[defKey] !== undefined ? table[defKey] : 1;
    }
    return mult;
  }

  // Para um Pokémon com 1-2 tipos: o que ele causa em 2x/4x (ofensivo, tipos únicos
  // multiplicando entre si não se aplica aqui, é por golpe) e o que recebe em
  // 4x/2x/imune (defensivo, produto dos dois tipos dele).
  function getEffectivenessSummary(pokemonTypes) {
    const types = (Array.isArray(pokemonTypes) ? pokemonTypes : [pokemonTypes])
      .map(normalizeKey)
      .filter(Boolean);

    const allTypes = Object.keys(CHART);
    const strongAgainst = { x4: [], x2: [] };
    const weakTo = { x4: [], x2: [], immune: [] };

    for (const own of types) {
      for (const other of allTypes) {
        const mult = getMultiplier(own, [other]);
        if (mult === 4) strongAgainst.x4.push(other);
        else if (mult === 2) strongAgainst.x2.push(other);
      }
    }

    for (const other of allTypes) {
      const mult = getMultiplier(other, types);
      if (mult === 0) weakTo.immune.push(other);
      else if (mult === 4) weakTo.x4.push(other);
      else if (mult === 2) weakTo.x2.push(other);
    }

    return { strongAgainst, weakTo };
  }

  window.__PQA.types = {
    CHART,
    COLORS,
    PT_TO_KEY,
    KEY_TO_PT,
    normalizeKey,
    getMultiplier,
    getEffectivenessSummary
  };

  window.__PQA.core.registerModule('data-types');
}

webFrame.executeJavaScript(`(${iniciarTabelaDeTipos.toString()})();`);
