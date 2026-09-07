const { contextBridge, ipcRenderer, webUtils } = require("electron");
contextBridge.exposeInMainWorld("surface", {
  isDesktop: true,
  pickFolder: () => ipcRenderer.invoke("pick-folder"),
  readSheet: () => ipcRenderer.invoke("read-sheet"),
  readSheetPath: (p) => ipcRenderer.invoke("read-sheet", p),
  /** absolute path of a File dropped on the window (Electron 32+ no longer sets File.path) */
  getPath: (file) => { try { return webUtils.getPathForFile(file); } catch { return null; } },
  hubSignIn: () => ipcRenderer.invoke("hub-signin"),
  hubSignOut: () => ipcRenderer.invoke("hub-signout"),
  openHub: () => ipcRenderer.invoke("open-hub"),
  listDisplays: () => ipcRenderer.invoke("list-displays"),
  openOutput: (o) => ipcRenderer.invoke("open-output", o),
  closeOutput: (id) => ipcRenderer.invoke("close-output", id),
  openOutputs: () => ipcRenderer.invoke("open-outputs"),
  openClock: () => ipcRenderer.invoke("open-clock"),
  onDisplaysChanged: (fn) => { const h = (_e, d) => fn(d); ipcRenderer.on("displays-changed", h); return () => ipcRenderer.removeListener("displays-changed", h); },
});
