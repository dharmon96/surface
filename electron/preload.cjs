const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("surface", { pickFolder: () => ipcRenderer.invoke("pick-folder"), isDesktop: true });
