const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sign99Lan', {
  ensureHelper: () => ipcRenderer.invoke('sign99:ensure-lan-helper'),
});
