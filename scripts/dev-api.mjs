/**
 * Local dev API server — a stand-in for `vercel dev` when the Vercel CLI
 * isn't logged in.
 *
 * Serves the `api/**\/*.ts` Vercel functions on port 5051, which is exactly
 * what `vite.config.ts` proxies `/api` to. Vite compiles the TypeScript via
 * `ssrLoadModule`, so handlers hot-reload on edit.
 *
 * Usage:
 *   node --env-file=.env.local scripts/dev-api.mjs
 *   npm run dev            # in another shell
 *
 * Supports the subset of Vercel's filesystem routing this project uses:
 * `api/foo.ts`, `api/foo/index.ts`, and `api/foo/[id].ts`.
 */
import { createServer as createHttpServer } from "node:http";
import { createServer as createViteServer } from "vite";
import { readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const API_DIR = path.join(ROOT, "api");
const PORT = Number(process.env.DEV_API_PORT ?? 5051);

/** Map a URL path to a handler file, collecting `[id]`-style params. */
function resolveRoute(segments) {
  let dir = API_DIR;
  const params = {};

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const last = i === segments.length - 1;

    if (last) {
      const direct = path.join(dir, `${seg}.ts`);
      if (existsSync(direct)) return { file: direct, params };

      const index = path.join(dir, seg, "index.ts");
      if (existsSync(index)) return { file: index, params };
    }

    const sub = path.join(dir, seg);
    if (!last && existsSync(sub)) {
      dir = sub;
      continue;
    }

    // Fall back to a dynamic segment, e.g. `[id].ts`.
    const dynamic = readdirSync(dir).find((f) => /^\[.+\]\.ts$/.test(f));
    if (last && dynamic) {
      params[dynamic.slice(1, -4).replace(/\]$/, "")] = decodeURIComponent(seg);
      return { file: path.join(dir, dynamic), params };
    }
    return null;
  }
  return null;
}

function readRawBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

/** Add the bits of the VercelResponse surface the handlers use. */
function decorateResponse(res) {
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (data) => {
    if (!res.getHeader("content-type")) {
      res.setHeader("content-type", "application/json; charset=utf-8");
    }
    res.end(JSON.stringify(data));
    return res;
  };
  res.send = (data) => {
    res.end(typeof data === "string" ? data : JSON.stringify(data));
    return res;
  };
  res.redirect = (location, code = 302) => {
    res.statusCode = code;
    res.setHeader("location", location);
    res.end();
    return res;
  };
  return res;
}

const vite = await createViteServer({
  root: ROOT,
  configFile: false,
  appType: "custom",
  server: { middlewareMode: true, hmr: false },
});

const server = createHttpServer(async (req, res) => {
  decorateResponse(res);

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const segments = url.pathname.split("/").filter(Boolean);

  if (segments[0] !== "api") {
    return res.status(404).json({ error: "Not found" });
  }

  const route = resolveRoute(segments.slice(1));
  if (!route) {
    console.warn(`[dev-api] 404 ${req.method} ${url.pathname}`);
    return res.status(404).json({ error: `No handler for ${url.pathname}` });
  }

  req.query = { ...Object.fromEntries(url.searchParams), ...route.params };

  const raw = await readRawBody(req);
  if (raw) {
    try {
      req.body = JSON.parse(raw);
    } catch {
      req.body = raw;
    }
  }

  try {
    const mod = await vite.ssrLoadModule(route.file);
    const handler = mod.default;
    if (typeof handler !== "function") {
      throw new Error(`${path.relative(ROOT, route.file)} has no default export`);
    }
    await handler(req, res);
    console.log(`[dev-api] ${res.statusCode} ${req.method} ${url.pathname}`);
  } catch (err) {
    vite.ssrFixStacktrace?.(err);
    console.error(`[dev-api] 500 ${req.method} ${url.pathname}\n`, err);
    if (!res.headersSent) res.status(500).json({ error: String(err?.message ?? err) });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[dev-api] serving api/ on http://127.0.0.1:${PORT}`);
});
