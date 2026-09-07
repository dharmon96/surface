import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Same shape as ShowCall: single Vite project, `server/` alongside, frontend builds to dist/ at root.
export default defineConfig({
  plugins: [react()],
  server: { port: 3009, proxy: { "/api": "http://127.0.0.1:8090", "/socket.io": { target: "http://127.0.0.1:8090", ws: true } } },
  build: { outDir: "dist", rollupOptions: { input: { main: "index.html", output: "output.html", clock: "clock.html" } } },
});
