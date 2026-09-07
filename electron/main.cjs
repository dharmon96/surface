/**
 * Surface desktop shell. Starts the Node server in-process (same runtime, no second install), then opens the UI.
 *   dev : `npm run app:dev`  → Vite dev server for the UI (hot reload), server started here on :8090
 *   prod: `npm run app`      → serves dist/ from the server itself
 * Show file and config are picked from the user data dir (%APPDATA%/Surface) with sensible first-run defaults.
 */
const { app, BrowserWindow, dialog, Menu, shell, ipcMain } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { spawn } = require("node:child_process");

const DEV = process.env.SURFACE_DEV === "1";
const PORT = Number(process.env.SURFACE_PORT || 8090);
const userDir = () => app.getPath("userData");
let serverProc = null;

function ensureDefaults() {
  const d = userDir(); fs.mkdirSync(d, { recursive: true });
  const show = path.join(d, "show.json"); const cfg = path.join(d, "surface.config.json");
  if (!fs.existsSync(show)) fs.copyFileSync(path.join(__dirname, "..", "fixtures", "2026-06-13-glendale.bout.json"), show);
  if (!fs.existsSync(cfg)) fs.writeFileSync(cfg, JSON.stringify({ port: PORT, adapters: [{ type: "mock" }] }, null, 2));
  return { show, cfg };
}

function startServer(show, cfg) {
  // tsx is a dev dependency; in a packaged build the server is prebuilt to dist-server/index.js
  const built = path.join(__dirname, "..", "dist-server", "index.js");
  const args = fs.existsSync(built) ? [built, show, "--config", cfg, "--port", String(PORT)] : ["--import", "tsx", path.join(__dirname, "..", "server", "index.ts"), show, "--config", cfg, "--port", String(PORT)];
  serverProc = spawn(process.execPath, args, { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", SURFACE_STATIC: DEV ? "" : path.join(__dirname, "..", "dist") }, stdio: ["ignore", "pipe", "pipe"] });
  serverProc.stdout.on("data", (d) => process.stdout.write(`[server] ${d}`)); serverProc.stderr.on("data", (d) => process.stderr.write(`[server] ${d}`));
  return new Promise((resolve) => { const t = setInterval(async () => { try { const r = await fetch(`http://127.0.0.1:${PORT}/api/health`); if (r.ok) { clearInterval(t); resolve(true); } } catch {} }, 250); setTimeout(() => { clearInterval(t); resolve(false); }, 15000); });
}

async function createWindow() {
  const { show, cfg } = ensureDefaults();
  const ok = await startServer(show, cfg);
  const win = new BrowserWindow({ width: 1500, height: 940, backgroundColor: "#0c0e12", title: "Surface", webPreferences: { contextIsolation: true, preload: path.join(__dirname, "preload.cjs") } });
  if (!ok) dialog.showErrorBox("Surface", `The show server did not start on port ${PORT}. Check the console output.`);
  await win.loadURL(DEV ? "http://localhost:3009/" : `http://127.0.0.1:${PORT}/`);
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" }; });
  const menu = Menu.buildFromTemplate([
    { label: "Show", submenu: [
      { label: "Open show.json…", click: async () => { const r = await dialog.showOpenDialog(win, { filters: [{ name: "Surface show", extensions: ["json"] }], properties: ["openFile"] }); if (!r.canceled) { fs.copyFileSync(r.filePaths[0], show); serverProc?.kill(); await startServer(show, cfg); win.reload(); } } },
      { label: "Open config folder", click: () => shell.openPath(userDir()) },
      { type: "separator" }, { role: "quit" }] },
    { label: "View", submenu: [{ role: "reload" }, { role: "toggleDevTools" }, { type: "separator" }, { role: "togglefullscreen" }] },
  ]);
  Menu.setApplicationMenu(menu);
}
ipcMain.handle("pick-folder", async () => { const r = await dialog.showOpenDialog({ properties: ["openDirectory"] }); return r.canceled ? null : r.filePaths[0]; });
app.whenReady().then(createWindow);
app.on("window-all-closed", () => { serverProc?.kill(); app.quit(); });
app.on("before-quit", () => serverProc?.kill());
