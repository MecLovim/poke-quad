const { app, BrowserWindow, ipcMain, session, dialog, safeStorage, powerSaveBlocker } = require('electron');
const path = require('path');
const fs = require('fs');

const PARTITIONS = ['persist:slot1', 'persist:slot2', 'persist:slot3', 'persist:slot4'];

// O Chromium congela timers, requestAnimationFrame e prioridade de processo
// quando a janela perde o foco ou fica coberta por outra (alt+tab, minimizar).
// Num jogo idle isso trava o progresso e dessincroniza o servidor, então todas
// as formas de throttling em segundo plano ficam desligadas.
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

let win = null;
let powerBlockerId = null;

function acceptedFile() {
  return path.join(app.getPath('userData'), 'accepted.json');
}

function createWindow() {
  win = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    backgroundColor: '#1b2430',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      webviewTag: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });

  win.webContents.setBackgroundThrottling(false);
  win.loadFile('index.html');
  win.on('closed', () => {
    win = null;
  });
}

app.setAppUserModelId('com.pokequad.app');

// Encaminha Esc digitado dentro de qualquer webview para a página principal,
// que sem isso nunca receberia a tecla enquanto o jogo estiver focado.
app.on('web-contents-created', (event, contents) => {
  if (contents.getType() === 'webview') {
    // Reforça o desligamento do throttling: o atributo no <webview> vale para a
    // criação, isto garante o mesmo para qualquer conteúdo criado depois.
    contents.setBackgroundThrottling(false);

    contents.on('before-input-event', (e, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape' && win && !win.isDestroyed()) {
        win.webContents.send('esc-pressed');
      }
    });
  }
});

app.whenReady().then(() => {
  const gamePreload = path.join(__dirname, 'game-preload.js');
  for (const name of PARTITIONS) {
    const s = session.fromPartition(name);
    // registerPreloadScript chegou no Electron 35; setPreloads é o equivalente
    // nas versões anteriores. Mantém os dois para o app não quebrar no upgrade.
    if (typeof s.registerPreloadScript === 'function') {
      s.registerPreloadScript({ id: 'poke-quad-keepalive', type: 'frame', filePath: gamePreload });
    } else {
      s.setPreloads([gamePreload]);
    }
  }

  // Impede que o sistema suspenda enquanto o app está aberto (a tela ainda pode
  // desligar normalmente).
  powerBlockerId = powerSaveBlocker.start('prevent-app-suspension');

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  if (powerBlockerId !== null && powerSaveBlocker.isStarted(powerBlockerId)) {
    powerSaveBlocker.stop(powerBlockerId);
  }
});

ipcMain.on('window:minimize', () => {
  if (win) win.minimize();
});

ipcMain.on('window:maximize', () => {
  if (!win) return;
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
});

ipcMain.on('window:close', () => {
  if (win) win.close();
});

ipcMain.handle('accepted:get', () => {
  try {
    return JSON.parse(fs.readFileSync(acceptedFile(), 'utf8')).accepted === true;
  } catch {
    return false;
  }
});

ipcMain.handle('accepted:set', () => {
  try {
    fs.writeFileSync(acceptedFile(), JSON.stringify({ accepted: true, date: new Date().toISOString() }));
    return true;
  } catch {
    return false;
  }
});

/* ---------- Limpeza de dados (por slot ou geral) ---------- */

ipcMain.handle('cache:clear', async (event, slot) => {
  const alvo = slot === 'all' ? 'das quatro contas' : `da conta ${slot}`;
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['Cancelar', 'Limpar'],
    defaultId: 0,
    cancelId: 0,
    title: 'Limpar dados',
    message: `Limpar os dados ${alvo}?`,
    detail: 'Cookies, cache e armazenamento local serão apagados e a sessão será deslogada. Os dados de login salvos no app não são apagados.'
  });
  if (response !== 1) return false;
  const slots = slot === 'all' ? [1, 2, 3, 4] : [slot];
  for (const n of slots) {
    const s = session.fromPartition(`persist:slot${n}`);
    await s.clearStorageData();
    await s.clearCache();
  }
  return true;
});

/* ---------- Credenciais por slot (criptografadas via safeStorage) ---------- */

function credsFile() {
  return path.join(app.getPath('userData'), 'credentials.json');
}

function readCreds() {
  try {
    return JSON.parse(fs.readFileSync(credsFile(), 'utf8'));
  } catch {
    return {};
  }
}

function writeCreds(all) {
  fs.writeFileSync(credsFile(), JSON.stringify(all));
}

ipcMain.handle('creds:save', (event, slot, user, pass) => {
  const all = readCreds();
  const payload = JSON.stringify({ user, pass });
  if (safeStorage.isEncryptionAvailable()) {
    all[`slot${slot}`] = { enc: true, data: safeStorage.encryptString(payload).toString('base64') };
  } else {
    all[`slot${slot}`] = { enc: false, data: Buffer.from(payload, 'utf8').toString('base64') };
  }
  writeCreds(all);
  return true;
});

ipcMain.handle('creds:get', (event, slot) => {
  const item = readCreds()[`slot${slot}`];
  if (!item) return null;
  try {
    const raw = item.enc
      ? safeStorage.decryptString(Buffer.from(item.data, 'base64'))
      : Buffer.from(item.data, 'base64').toString('utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
});

ipcMain.handle('creds:delete', (event, slot) => {
  const all = readCreds();
  delete all[`slot${slot}`];
  writeCreds(all);
  return true;
});
