#!/usr/bin/env node
/**
 * Local Album View server.
 * Serves compiled output/ and maps /catalogs to the shared catalogue tree
 * (examples/SetFinder/catalogs — same files CI publishes to public/catalogs/).
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const CATALOG_ROOT = path.resolve(ROOT, "../SetFinder/catalogs");
const PORT = Number(process.env.ALBUMVIEW_PORT || 8090);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

function send(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type });
  res.end(body);
}

function safeJoin(root, requestPath) {
  const absolute = path.resolve(root, `.${requestPath}`);
  if (!absolute.startsWith(`${root}${path.sep}`) && absolute !== root) return null;
  return absolute;
}

http.createServer((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return send(res, 405, "Method not allowed");
  }

  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  let requestPath = decodeURIComponent(url.pathname);

  // Mimic GitHub Pages: /albumview/index.html → ../catalogs/
  // Page is served as /output/index.html so ../catalogs === /catalogs
  if (requestPath === "/" || requestPath === "/output" || requestPath === "/output/") {
    requestPath = "/output/index.html";
  }

  let root = ROOT;
  let filePath = requestPath;

  if (requestPath === "/catalogs" || requestPath.startsWith("/catalogs/")) {
    root = CATALOG_ROOT;
    filePath = requestPath === "/catalogs" || requestPath === "/catalogs/"
      ? "/"
      : requestPath.slice("/catalogs".length);
  }

  const absolute = safeJoin(root, filePath === "/" ? "/." : filePath);
  if (!absolute) return send(res, 403, "Forbidden");

  fs.stat(absolute, (statErr, stat) => {
    const target = !statErr && stat.isDirectory()
      ? path.join(absolute, "index.html")
      : absolute;
    fs.readFile(target, (err, body) => {
      if (err) return send(res, 404, "Not found");
      const type = TYPES[path.extname(target).toLowerCase()] || "application/octet-stream";
      send(res, 200, body, type);
    });
  });
}).listen(PORT, () => {
  console.log(`Album View listening on http://localhost:${PORT}/`);
  console.log(`Catalogs from ${CATALOG_ROOT}`);
});
