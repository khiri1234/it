// The app is a self-contained web app that talks to Firebase directly over
// the network, so this stays minimal — its only job is relaying the Dock
// "press and hold" quick-jump menu (built in main.js) into the page.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  onDockNavigate: (callback) => ipcRenderer.on('dock-navigate', (_event, section) => callback(section))
});
