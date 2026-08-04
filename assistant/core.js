// Fundação do assistente Poke Quad, injetada na página do próprio jogo (dentro do
// webview de cada conta). Não depende de nenhum outro módulo assistant/*; todos os
// outros dependem deste rodar primeiro (ver ordem em ASSISTANT_MODULES, main.js).
//
// Expõe window.__PQA.core com: interceptação de WebSocket do jogo, requisições REST
// autenticadas, envio/espera de mensagens WS, storage isolado por conta (a própria
// partição da sessão já isola localStorage por conta, isto só evita colisão de
// chaves entre módulos) e um log de boot usado pela aba "Status" do painel.

const { webFrame } = require('electron');

function iniciarNucleoAssistente() {
  if (window.__PQA && window.__PQA.core) return; // já inicializado (ex.: renavegação)

  const PQA_VERSION = '0.1.0';
  const STORAGE_PREFIX = 'pq-assistant';

  /* ---------- Storage namespaced por feature ---------- */

  function storageKey(feature, key) {
    return `${STORAGE_PREFIX}:${feature}:${key}`;
  }

  function storageGet(feature, key, fallback) {
    try {
      const raw = localStorage.getItem(storageKey(feature, key));
      if (raw === null) return fallback;
      return JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }

  function storageSet(feature, key, value) {
    try {
      localStorage.setItem(storageKey(feature, key), JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  }

  function storageRemove(feature, key) {
    try {
      localStorage.removeItem(storageKey(feature, key));
      return true;
    } catch (e) {
      return false;
    }
  }

  /* ---------- Barramento de eventos internos (window CustomEvent, prefixo pqa:) ---------- */

  function on(name, handler) {
    const type = `pqa:${name}`;
    window.addEventListener(type, handler);
    return () => window.removeEventListener(type, handler);
  }

  function emit(name, detail) {
    window.dispatchEvent(new CustomEvent(`pqa:${name}`, { detail }));
  }

  // Os módulos rodam em document-start: document.head/document.body ainda não
  // existem nesse momento (só documentElement, às vezes nem isso). Qualquer módulo
  // que precise montar DOM deve adiar seu trabalho com isto em vez de assumir que
  // document.body já existe.
  function onDomReady(callback) {
    if (document.body) {
      callback();
      return;
    }
    let done = false;
    function attempt() {
      if (done || !document.body) return;
      done = true;
      if (poll) clearInterval(poll);
      document.removeEventListener('DOMContentLoaded', attempt);
      callback();
    }
    document.addEventListener('DOMContentLoaded', attempt);
    const poll = setInterval(attempt, 20);
  }

  // Toda feature futura registra uma aba em panelChrome, mas panel-chrome.js
  // também adia sua montagem para depois do DOM ficar pronto — então window.__PQA
  // .panelChrome pode não existir ainda mesmo depois de onDomReady dependendo da
  // ordem exata de resolução dos dois. Espera os dois ficarem prontos.
  function onPanelReady(callback) {
    onDomReady(() => {
      if (window.__PQA.panelChrome) {
        callback();
        return;
      }
      const poll = setInterval(() => {
        if (window.__PQA.panelChrome) {
          clearInterval(poll);
          callback();
        }
      }, 20);
    });
  }

  /* ---------- Log de boot (alimenta a aba "Status" do painel) ---------- */

  const bootLog = [];

  function registerModule(name) {
    const entry = { name, order: bootLog.length + 1, at: Date.now() };
    bootLog.push(entry);
    console.log(`[PQA] módulo carregado (#${entry.order}): ${name}`);
    emit('module-ready', entry);
    return entry;
  }

  function getBootLog() {
    return bootLog.slice();
  }

  /* ---------- Interceptação do WebSocket do jogo ---------- */

  const NativeWebSocket = window.WebSocket;
  let gameSocket = null;
  const frameWaiters = new Map(); // type de resposta -> [resolvers]

  function dispatchFrame(text) {
    let msg;
    try {
      msg = JSON.parse(text);
    } catch (e) {
      return;
    }
    if (!msg || typeof msg !== 'object') return;

    emit('ws-frame', msg);

    const type = msg.type;
    if (type && frameWaiters.has(type)) {
      const resolvers = frameWaiters.get(type);
      frameWaiters.delete(type);
      resolvers.forEach((resolve) => resolve(msg));
    }
  }

  function handleRawMessage(raw) {
    if (typeof raw === 'string') {
      dispatchFrame(raw);
    } else if (raw instanceof Blob) {
      raw.text().then(dispatchFrame).catch(() => {});
    } else if (raw instanceof ArrayBuffer) {
      try {
        dispatchFrame(new TextDecoder().decode(raw));
      } catch (e) {}
    }
  }

  function PQAWebSocket(url, protocols) {
    const socket = protocols === undefined
      ? new NativeWebSocket(url)
      : new NativeWebSocket(url, protocols);

    // O jogo pode abrir outros sockets além do principal; qualquer um com "ws"/token
    // na URL é candidato. O último que receber mensagens vira o socket "ativo" para
    // envio (gameSocket), o que é suficiente porque o jogo mantém só um por vez.
    if (/wss?:|token=/i.test(String(url))) {
      gameSocket = socket;
      socket.addEventListener('message', (ev) => handleRawMessage(ev.data));
      socket.addEventListener('close', () => {
        if (gameSocket === socket) gameSocket = null;
      });
    }
    return socket;
  }

  if (NativeWebSocket) {
    PQAWebSocket.prototype = NativeWebSocket.prototype;
    Object.setPrototypeOf(PQAWebSocket, NativeWebSocket);
    window.WebSocket = PQAWebSocket;
  }

  function sendGameMessage(payload) {
    if (!gameSocket || gameSocket.readyState !== NativeWebSocket.OPEN) return false;
    try {
      gameSocket.send(JSON.stringify(payload));
      return true;
    } catch (e) {
      return false;
    }
  }

  // Envia requestType via WS e resolve com o primeiro frame de tipo responseType,
  // ou com cachedValue (se houver) quando o tempo esgota sem resposta.
  function requestGameEvent(responseType, requestType, cachedValue, timeoutMs) {
    timeoutMs = timeoutMs || 4000;
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      const list = frameWaiters.get(responseType) || [];
      list.push(finish);
      frameWaiters.set(responseType, list);
      sendGameMessage({ type: requestType });
      setTimeout(() => finish(cachedValue !== undefined ? cachedValue : null), timeoutMs);
    });
  }

  /* ---------- Autenticação / REST ---------- */

  function getGameTokens() {
    try {
      return JSON.parse(sessionStorage.getItem('pokeweb:tokens') || 'null');
    } catch (e) {
      return null;
    }
  }

  async function refreshAccessToken() {
    const tokens = getGameTokens();
    if (!tokens || !tokens.refreshToken) return null;
    try {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: tokens.refreshToken })
      });
      if (!res.ok) return null;
      const refreshed = await res.json();
      if (!refreshed || !refreshed.accessToken) return null;
      sessionStorage.setItem('pokeweb:tokens', JSON.stringify(refreshed));
      emit('token-updated', refreshed);
      return refreshed.accessToken;
    } catch (e) {
      return null;
    }
  }

  // Ponto único de chamadas REST ao jogo: injeta Authorization, tenta refresh do
  // token uma vez em caso de 401, e lança erro com a mensagem do corpo da resposta
  // (ou "HTTP <status>") em qualquer resposta não-OK.
  async function gameApiRequest(endpoint, options) {
    options = options || {};
    const attempt = (token) => fetch(endpoint, {
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {})
      }
    });

    let res = await attempt((getGameTokens() || {}).accessToken);
    if (res.status === 401) {
      const refreshed = await refreshAccessToken();
      if (refreshed) res = await attempt(refreshed);
    }

    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.message || body.error || `HTTP ${res.status}`);
    return body;
  }

  /* ---------- Namespace público ---------- */

  window.__PQA = window.__PQA || {};
  window.__PQA.VERSION = PQA_VERSION;
  window.__PQA.ready = true;
  window.__PQA.core = {
    on,
    emit,
    onDomReady,
    onPanelReady,
    registerModule,
    getBootLog,
    storage: { get: storageGet, set: storageSet, remove: storageRemove },
    send: sendGameMessage,
    request: requestGameEvent,
    api: gameApiRequest,
    getGameTokens
  };

  registerModule('core');
}

webFrame.executeJavaScript(`(${iniciarNucleoAssistente.toString()})();`);
