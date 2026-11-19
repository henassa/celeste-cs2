// Pont entre l'interface et l'application de bureau : seulement ces fonctions, rien d'autre de Node.

const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (cb) => {
  const h = (_e, data) => cb(data);
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
};

contextBridge.exposeInMainWorld('scrimviewDesktop', {
  platform: process.platform,
  info: () => ipcRenderer.invoke('desktop:info'),
  listMaps: () => ipcRenderer.invoke('desktop:listMaps'),
  pickCs2: () => ipcRenderer.invoke('desktop:pickCs2'),
  pickWorkDir: () => ipcRenderer.invoke('desktop:pickWorkDir'),
  extractMaps: (specs, quality) => ipcRenderer.invoke('desktop:extractMaps', specs, quality),
  extractModels: () => ipcRenderer.invoke('desktop:extractModels'),
  cancel: () => ipcRenderer.invoke('desktop:cancel'),
  setupDone: (done) => ipcRenderer.invoke('desktop:setupDone', done),
  open: (which) => ipcRenderer.invoke('desktop:open', which),
  disk: () => ipcRenderer.invoke('desktop:disk'),
  cleanWork: () => ipcRenderer.invoke('desktop:cleanWork'),
  removeMap: (name) => ipcRenderer.invoke('desktop:removeMap', name),
  vodOpen: (url) => ipcRenderer.invoke('vod:open', url),
  vodCmd: (cmd) => ipcRenderer.invoke('vod:cmd', cmd),
  vodClose: () => ipcRenderer.invoke('vod:close'),
  onStart: on('job:start'),
  onLine: on('job:line'),
  onProgress: on('job:progress'),
  onEnd: on('job:end'),
});
