const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gate88Lan', {
  ensureHelper: () => ipcRenderer.invoke('gate88:ensure-lan-helper'),
});
