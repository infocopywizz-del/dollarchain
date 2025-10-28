// server.js — runs Vite dev + mounts /api/*.js Vercel-style handlers via Express
import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT ? Number(process.env.PORT) : 5000;

async function start() {
  const app = express();

  // Body parsers
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true }));

  // Mount API middleware at /api — this must be BEFORE Vite middleware
  app.use("/api", async (req, res) => {
    try {
      let relPath = req.path || "/";
      relPath = relPath.replace(/^\/+/, "");
      if (!relPath) relPath = "index";

      let filePath = path.join(__dirname, "api", relPath);
      if (!filePath.endsWith(".js")) filePath = `${filePath}.js`;

      if (!fs.existsSync(filePath)) {
        res.status(404).json({ error: "not_found", path: req.originalUrl });
        return;
      }

      const mod = await vite.ssrLoadModule(filePath);

      if (mod && typeof mod.default === "function") {
        return mod.default(req, res);
      } else {
        res.status(500).json({ error: "module_missing_default_export", file: filePath });
      }
    } catch (err) {
      vite && vite.ssrFixStacktrace && vite.ssrFixStacktrace(err);
      console.error("API handler error:", err);
      res.status(500).json({ error: "internal_server_error", message: String(err.message) });
    }
  });

  // Create Vite server in middleware (dev) mode
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: "spa",
  });

  // Use Vite's middleware for frontend + HMR
  app.use(vite.middlewares);

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Dev server (Vite + API adapter) running at http://localhost:${PORT}`);
  });
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
