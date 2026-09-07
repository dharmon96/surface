/**
 * Surface desktop shell. Starts the Node server in-process (same runtime, no second install), then opens the UI.
 *   dev : `npm run app:dev`  → Vite dev server for the UI (hot reload), server started here on :8090
 *   prod: `npm run app`      → serves dist/ from the server itself
 * Show file and config are picked from the user data dir (%APPDATA%/Surface) with sensible first-run defaults.
 */
const { app, BrowserWindow, dialog, Menu, shell, ipcMain, session } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { spawn, execFileSync } = require("node:child_process");
const HUB = process.env.SURFACE_HUB || "https://mantaglow.com";

const DEV = process.env.SURFACE_DEV === "1";
const PORT = Number(process.env.SURFACE_PORT || 8090);
const userDir = () => app.getPath("userData");
let serverProc = null;

function ensureDefaults() {
  const d = userDir(); fs.mkdirSync(d, { recursive: true });
  const show = path.join(d, "show.json"); const cfg = path.join(d, "surface.config.json");
  // first run only: the Glendale sample card becomes the first project (the server imports a loose show.json once)
  if (!fs.existsSync(show) && !fs.existsSync(path.join(d, "projects")) && !fs.existsSync(`${show}.imported`)) fs.copyFileSync(path.join(__dirname, "..", "fixtures", "2026-06-13-glendale.bout.json"), show);
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
ipcMain.handle("read-sheet", async () => {
  const r = await dialog.showOpenDialog({ filters: [{ name: "Bout / timing sheet", extensions: ["pdf", "txt"] }], properties: ["openFile"] }); if (r.canceled) return null;
  const file = r.filePaths[0];
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
app.whenReady().then(createWindow);
app.on("window-all-closed", () => { serverProc?.kill(); app.quit(); });
app.on("before-quit", () => serverProc?.kill());
