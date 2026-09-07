const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("surface", {
  isDesktop: true,
  pickFolder: () => ipcRenderer.invoke("pick-folder"),
  readSheet: () => ipcRenderer.invoke("read-sheet"),
  hubSignIn: () => ipcRenderer.invoke("hub-signin"),
  hubSignOut: () => ipcRenderer.invoke("hub-signout"),
  openHub: () => ipcRenderer.invoke("open-hub"),
});
