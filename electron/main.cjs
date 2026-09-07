/**
 * Surface desktop shell. Starts the Node server in-process (same runtime, no second install), then opens the UI.
 *   dev : `npm run app:dev`  → Vite dev server for the UI (hot reload), server started here on :8090
 *   prod: `npm run app`      → serves dist/ from the server itself
 * Show file and config are picked from the user data dir (%APPDATA%/Surface) with sensible first-run defaults.
 */
const { app, BrowserWindow, dialog, Menu, shell, ipcMain, session, screen } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { spawn, execFileSync } = require("node:child_process");
const HUB = process.env.SURFACE_HUB || "https://mantaglow.com";

const DEV = process.env.SURFACE_DEV === "1";
const PORT = Number(process.env.SURFACE_PORT || 8090);
const userDir = () => app.getPath("userData");
let serverProc = null;
// outputs are pixel-exact: no DPI scaling on any display, no frame-rate throttling when an output window is hidden behind another
app.commandLine.appendSwitch("force-device-scale-factor", "1");
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-background-timer-throttling");

function ensureDefaults() {
  const d = userDir(); fs.mkdirSync(d, { recursive: true });
  const show = path.join(d, "show.json"); const cfg = path.join(d, "surface.config.json");
  // no sample is forced on first run: the app opens on an empty card with "Load the sample card" one click away
  if (!fs.existsSync(cfg)) fs.writeFileSync(cfg, JSON.stringify({ port: PORT, adapters: [{ type: "mock" }] }, null, 2));
  return { show, cfg };
}

function startServer(show, cfg) {
  // tsx is a dev dependency; in a packaged build the server is prebuilt to dist-server/index.js
  const built = path.join(__dirname, "..", "dist-server", "server", "index.js");
  const common = [show, "--config", cfg, "--port", String(PORT), "--data", userDir(), "--hub", HUB];
  const args = fs.existsSync(built) ? [built, ...common] : ["--import", "tsx", path.join(__dirname, "..", "server", "index.ts"), ...common];
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
      { label: "Import show.json as a project…", click: async () => { const r = await dialog.showOpenDialog(win, { filters: [{ name: "Surface show", extensions: ["json"] }], properties: ["openFile"] }); if (!r.canceled) { const doc = JSON.parse(fs.readFileSync(r.filePaths[0], "utf8")); const res = await fetch(`http://127.0.0.1:${PORT}/api/projects`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ doc }) }); if (!res.ok) dialog.showErrorBox("Surface", `Could not import: ${await res.text()}`); win.reload(); } } },
      { label: "Open config folder", click: () => shell.openPath(userDir()) },
      { type: "separator" }, { role: "quit" }] },
    { label: "View", submenu: [{ role: "reload" }, { role: "toggleDevTools" }, { type: "separator" }, { role: "togglefullscreen" }] },
  ]);
  Menu.setApplicationMenu(menu);
}
ipcMain.handle("pick-folder", async () => { const r = await dialog.showOpenDialog({ properties: ["openDirectory"] }); return r.canceled ? null : r.filePaths[0]; });

// ── sheet import: pick a PDF/txt; PDFs go through pdftotext -layout (poppler) so the same parsers run as the CLI
ipcMain.handle("read-sheet", async (_ev, given) => {
  let file = given;
  if (!file) { const r = await dialog.showOpenDialog({ filters: [{ name: "Bout / timing sheet", extensions: ["pdf", "txt"] }], properties: ["openFile"] }); if (r.canceled) return null; file = r.filePaths[0]; }
  if (/\.pdf$/i.test(file)) { try { return { file: path.basename(file), text: execFileSync("pdftotext", ["-layout", file, "-"], { encoding: "utf8", maxBuffer: 64 << 20 }) }; } catch (e) { return { file: path.basename(file), error: "pdftotext not found — install poppler (choco install poppler) or export the sheet as text" }; } }
  return { file: path.basename(file), text: fs.readFileSync(file, "utf8") };
});

// ── hub sign-in: a normal browser window on mantaglow.com; when Better Auth sets its session cookie we hand the token to the
// local server (which verifies it against /api/hub/users/me) and close the window. The cookie is HttpOnly — only the main
// process can read it, which is the point: the page never sees it.
const COOKIE_NAMES = ["__Secure-better-auth.session_token", "better-auth.session_token"];
async function hubCookie() { for (const name of COOKIE_NAMES) { const c = await session.defaultSession.cookies.get({ url: HUB, name }); if (c[0]?.value) return c[0].value; } return null; }
const tokenFromCookie = (v) => { const d = decodeURIComponent(v); return d.includes(".") ? d.split(".")[0] : d; };
async function handToServer(token) { const r = await fetch(`http://127.0.0.1:${PORT}/api/hub/token`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) }); return { status: r.status, body: await r.json().catch(() => null) }; }
ipcMain.handle("hub-signin", async (ev) => {
  const existing = await hubCookie(); if (existing) { const r = await handToServer(tokenFromCookie(existing)); if (r.status === 200) return r.body; }
  const parent = BrowserWindow.fromWebContents(ev.sender);
  const w = new BrowserWindow({ width: 520, height: 720, parent, modal: false, title: "Sign in to MantaGlow", autoHideMenuBar: true, webPreferences: { contextIsolation: true, sandbox: true } });
  await w.loadURL(`${HUB}/login?redirect=${encodeURIComponent("/dashboard")}`);
  return new Promise((resolve) => {
    const t = setInterval(async () => { if (w.isDestroyed()) { clearInterval(t); return resolve({ error: "sign-in window closed" }); } const c = await hubCookie(); if (!c) return; clearInterval(t); const r = await handToServer(tokenFromCookie(c)); if (!w.isDestroyed()) w.close(); resolve(r.status === 200 ? r.body : { error: r.body?.error ?? `hub said ${r.status}` }); }, 800);
    w.on("closed", () => { clearInterval(t); resolve({ error: "sign-in window closed" }); });
  });
});
ipcMain.handle("hub-signout", async () => { for (const name of COOKIE_NAMES) await session.defaultSession.cookies.remove(HUB, name).catch(() => {}); const r = await fetch(`http://127.0.0.1:${PORT}/api/hub/signout`, { method: "POST" }); return r.json().catch(() => null); });
ipcMain.handle("open-hub", () => shell.openExternal(`${HUB}/apps`));

// ── outputs: one frameless kiosk window per output canvas on the display the operator picked (the LED processor's input).
// The window is the canvas at 1:1 (or fitted per the canvas' fit rule); the page /output.html renders the screens at their
// canvas positions from the server's live state. Same idea as Resolume's Advanced Output, without the mapping step:
// PixelGrid already knows where every screen sits in each processor canvas.
const outputWins = new Map();
const displays = () => screen.getAllDisplays().map((d, i) => ({ id: d.id, label: d.label || `Display ${i + 1}`, x: d.bounds.x, y: d.bounds.y, w: d.bounds.width, h: d.bounds.height, scale: d.scaleFactor, primary: d.id === screen.getPrimaryDisplay().id }));
ipcMain.handle("list-displays", () => displays());
ipcMain.handle("open-output", (_ev, { id, displayId, w, h }) => {
  const d = screen.getAllDisplays().find((x) => x.id === displayId) ?? screen.getPrimaryDisplay(); if (!d) return { error: "no display" };
  if (outputWins.has(id)) { outputWins.get(id).close(); }
  const win = new BrowserWindow({ x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height, frame: false, fullscreen: true, kiosk: true, alwaysOnTop: false, skipTaskbar: true, backgroundColor: "#000000", title: `Surface output — ${id}`, webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  win.setMenuBarVisibility(false);
  win.loadURL(`${DEV ? "http://localhost:3009" : `http://127.0.0.1:${PORT}`}/output.html?id=${encodeURIComponent(id)}&w=${w}&h=${h}`);
  win.on("closed", () => outputWins.delete(id)); outputWins.set(id, win);
  return { ok: true, display: { id: d.id, w: d.bounds.width, h: d.bounds.height } };
});
ipcMain.handle("close-output", (_ev, id) => { const w = outputWins.get(id); if (w) w.close(); return { ok: true }; });
ipcMain.handle("open-outputs", () => [...outputWins.keys()]);
screen.on("display-removed", () => { for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed() && !w.isKiosk()) w.webContents.send("displays-changed", displays()); });
screen.on("display-added", () => { for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed() && !w.isKiosk()) w.webContents.send("displays-changed", displays()); });
app.whenReady().then(createWindow);
app.on("window-all-closed", () => { serverProc?.kill(); app.quit(); });
// closing the console closes every output with it
app.on("browser-window-closed", () => { const main = BrowserWindow.getAllWindows().find((w) => !w.isKiosk()); if (!main) for (const w of outputWins.values()) if (!w.isDestroyed()) w.close(); });
app.on("before-quit", () => serverProc?.kill());
