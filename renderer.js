const LOGIN_URL = 'https://poke.idleworld.online/login';
const ZOOM_MIN = 0.3;
const ZOOM_MAX = 1.5;
const ZOOM_STEP = 0.1;
const ZOOM_INICIAL = 0.7;

let started = false;

/* ---------- Painéis ---------- */

const panels = Array.from(document.querySelectorAll('.panel')).map((el, i) => {
  const panel = {
    el,
    slot: i + 1,
    webview: el.querySelector('webview'),
    zoomLabel: el.querySelector('.zoom-label'),
    zoom: ZOOM_INICIAL
  };

  // Reaplica o zoom a cada navegação (o fator não acompanha a página sozinho).
  panel.webview.addEventListener('dom-ready', () => {
    applyZoom(panel, panel.zoom);
  });

  // Preenche o login automaticamente quando a tela de login abrir e houver
  // credenciais salvas para este slot.
  const autoFill = async () => {
    let url = '';
    try {
      url = panel.webview.getURL();
    } catch {
      return;
    }
    if (!url.includes('/login')) return;
    const saved = await window.pokeQuad.getCreds(panel.slot);
    if (saved && (saved.user || saved.pass)) fillLogin(panel, saved);
  };
  panel.webview.addEventListener('did-finish-load', autoFill);
  panel.webview.addEventListener('did-navigate-in-page', autoFill);

  el.querySelector('[data-action="back"]').addEventListener('click', () => {
    try {
      if (panel.webview.canGoBack()) panel.webview.goBack();
    } catch {}
  });

  el.querySelector('[data-action="reload"]').addEventListener('click', () => {
    try {
      panel.webview.reload();
    } catch {}
  });

  el.querySelector('[data-action="login"]').addEventListener('click', () => {
    try {
      panel.webview.loadURL(LOGIN_URL);
    } catch {
      panel.webview.src = LOGIN_URL;
    }
  });

  el.querySelector('[data-action="zoom-out"]').addEventListener('click', () => {
    applyZoom(panel, panel.zoom - ZOOM_STEP);
  });

  el.querySelector('[data-action="zoom-in"]').addEventListener('click', () => {
    applyZoom(panel, panel.zoom + ZOOM_STEP);
  });

  el.querySelector('[data-action="expand"]').addEventListener('click', () => {
    toggleExpand(panel);
  });

  el.querySelector('[data-action="creds"]').addEventListener('click', () => {
    openCreds(panel);
  });

  el.querySelector('[data-action="clear"]').addEventListener('click', async () => {
    const ok = await window.pokeQuad.clearCache(panel.slot);
    if (ok) goLogin(panel);
  });

  return panel;
});

function goLogin(panel) {
  try {
    panel.webview.loadURL(LOGIN_URL);
  } catch {
    panel.webview.setAttribute('src', LOGIN_URL);
  }
}

// Escreve usuário/senha nos campos da página de login do jogo. Usa o setter
// nativo de value + evento input para o framework da página enxergar o valor.
function fillLogin(panel, creds) {
  const script = `(() => {
    const setVal = (el, v) => {
      if (!el || !v) return;
      const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
      desc.set.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const pass = document.querySelector('input[type="password"]');
    const user = document.querySelector('input[type="email"]')
      || Array.from(document.querySelectorAll('input[type="text"], input:not([type])'))
           .find((i) => i !== pass);
    setVal(user, ${JSON.stringify(creds.user || '')});
    setVal(pass, ${JSON.stringify(creds.pass || '')});
    return Boolean(user || pass);
  })()`;
  try {
    panel.webview.executeJavaScript(script);
  } catch {}
}

function applyZoom(panel, zoom) {
  panel.zoom = Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom)) * 10) / 10;
  try {
    panel.webview.setZoomFactor(panel.zoom);
  } catch {}
  panel.zoomLabel.textContent = `${Math.round(panel.zoom * 100)}%`;
}

function toggleExpand(panel) {
  const wasExpanded = panel.el.classList.contains('expanded');
  collapseAll();
  if (!wasExpanded) panel.el.classList.add('expanded');
}

function collapseAll() {
  panels.forEach((p) => p.el.classList.remove('expanded'));
}

function startWebviews() {
  if (started) return;
  started = true;
  panels.forEach((p) => {
    // setAttribute, e não a propriedade .src: na abertura do app isto roda
    // antes do custom element <webview> ser registrado, e uma propriedade
    // atribuída nesse momento sombrearia o setter e perderia a navegação.
    p.webview.setAttribute('src', LOGIN_URL);
  });
}

/* ---------- Barra de título ---------- */

document.getElementById('min-btn').addEventListener('click', () => window.pokeQuad.minimize());
document.getElementById('max-btn').addEventListener('click', () => window.pokeQuad.maximize());
document.getElementById('close-btn').addEventListener('click', () => window.pokeQuad.close());
document.getElementById('about-btn').addEventListener('click', () => openOverlay('about'));

document.getElementById('clear-all-btn').addEventListener('click', async () => {
  const ok = await window.pokeQuad.clearCache('all');
  if (ok) panels.forEach(goLogin);
});

/* ---------- Dados da conta (por slot) ---------- */

const credsOverlay = document.getElementById('creds-overlay');
const credsTitle = document.getElementById('creds-title');
const credsUser = document.getElementById('creds-user');
const credsPass = document.getElementById('creds-pass');

let credsPanel = null;

async function openCreds(panel) {
  credsPanel = panel;
  credsTitle.textContent = `DADOS DA CONTA ${panel.slot}`;
  const saved = await window.pokeQuad.getCreds(panel.slot);
  credsUser.value = saved ? saved.user || '' : '';
  credsPass.value = saved ? saved.pass || '' : '';
  credsOverlay.classList.remove('hidden');
  credsUser.focus();
}

function closeCreds() {
  credsPanel = null;
  credsOverlay.classList.add('hidden');
}

document.getElementById('creds-close').addEventListener('click', closeCreds);

document.getElementById('creds-save').addEventListener('click', async () => {
  if (!credsPanel) return;
  if (!credsUser.value && !credsPass.value) {
    await window.pokeQuad.deleteCreds(credsPanel.slot);
  } else {
    await window.pokeQuad.saveCreds(credsPanel.slot, credsUser.value, credsPass.value);
  }
  closeCreds();
});

document.getElementById('creds-fill').addEventListener('click', () => {
  if (!credsPanel) return;
  fillLogin(credsPanel, { user: credsUser.value, pass: credsPass.value });
  closeCreds();
});

document.getElementById('creds-delete').addEventListener('click', async () => {
  if (!credsPanel) return;
  await window.pokeQuad.deleteCreds(credsPanel.slot);
  credsUser.value = '';
  credsPass.value = '';
});

/* ---------- Aviso / Sobre ---------- */

const overlay = document.getElementById('overlay');
const checkRow = document.getElementById('check-row');
const agreeCheck = document.getElementById('agree-check');
const agreeBtn = document.getElementById('agree-btn');
const aboutCloseBtn = document.getElementById('about-close-btn');

let overlayMode = null;

function openOverlay(mode) {
  overlayMode = mode;
  const firstRun = mode === 'first-run';
  checkRow.classList.toggle('hidden', !firstRun);
  agreeBtn.classList.toggle('hidden', !firstRun);
  aboutCloseBtn.classList.toggle('hidden', firstRun);
  if (firstRun) {
    agreeCheck.checked = false;
    agreeBtn.disabled = true;
  }
  overlay.classList.remove('hidden');
}

function hideOverlay() {
  overlayMode = null;
  overlay.classList.add('hidden');
}

agreeCheck.addEventListener('change', () => {
  agreeBtn.disabled = !agreeCheck.checked;
});

agreeBtn.addEventListener('click', async () => {
  await window.pokeQuad.setAccepted();
  hideOverlay();
  startWebviews();
});

aboutCloseBtn.addEventListener('click', hideOverlay);

/* ---------- Esc: sai do painel ampliado / fecha o "Sobre" ---------- */

function onEscape() {
  if (!credsOverlay.classList.contains('hidden')) closeCreds();
  else if (overlayMode === 'about') hideOverlay();
  else collapseAll();
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') onEscape();
});

window.pokeQuad.onEsc(onEscape);

/* ---------- Primeira execução ---------- */

(async () => {
  const accepted = await window.pokeQuad.getAccepted();
  if (accepted) startWebviews();
  else openOverlay('first-run');
})();
