const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pokeQuad', {
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
  getAccepted: () => ipcRenderer.invoke('accepted:get'),
  setAccepted: () => ipcRenderer.invoke('accepted:set'),
  clearCache: (slot) => ipcRenderer.invoke('cache:clear', slot),
  saveCreds: (slot, user, pass) => ipcRenderer.invoke('creds:save', slot, user, pass),
  getCreds: (slot) => ipcRenderer.invoke('creds:get', slot),
  deleteCreds: (slot) => ipcRenderer.invoke('creds:delete', slot),
  onEsc: (callback) => ipcRenderer.on('esc-pressed', () => callback())
});
