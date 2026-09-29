import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

/**
 * The app is served from a sub-path of the marketing site
 * (https://kubegraf.io/timesheet), not from a domain root. Everything
 * that builds a URL — asset links, the router, API calls — derives
 * from this one value via `import.meta.env.BASE_URL`.
 *
 * Dev deliberately uses the same base, so the local app lives at
 * http://127.0.0.1:5050/timesheet/ too. Serving dev at `/` would hide
 * exactly the class of bug this setting exists to prevent.
 */
const BASE = "/timesheet/";

export default defineConfig({
  base: BASE,
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    // Emit into dist/timesheet so the deployed file tree mirrors the
    // URL path: dist/timesheet/index.html is served at /timesheet/.
    outDir: "dist/timesheet",
    emptyOutDir: true,
  },
  server: {
    port: 5050,
    proxy: {
      // The browser calls /timesheet/api/*; the local function server
      // (scripts/dev-api.mjs) mirrors Vercel and serves them at /api/*.
      "/timesheet/api": {
        target: "http://localhost:5051",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/timesheet/, ""),
      },
    },
  },
});
