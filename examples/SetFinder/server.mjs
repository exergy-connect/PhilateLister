#!/usr/bin/env node
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.SETFINDER_PORT || 8080);
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const IMAGE_TYPES = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
  ["image/gif", ".gif"],
]);

function json(res, status, value) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(`${JSON.stringify(value)}\n`);
}

function safeSegment(value, label) {
  const segment = String(value || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(segment)) {
    throw new Error(`Invalid ${label}`);
  }
  return segment;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_IMAGE_BYTES) {
        reject(new Error("Image is larger than 20 MB"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function hasImageSignature(body, contentType) {
  if (contentType === "image/jpeg") return body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff;
  if (contentType === "image/png") return body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (contentType === "image/gif") return /^GIF8[79]a$/.test(body.subarray(0, 6).toString("ascii"));
  if (contentType === "image/webp") {
    return body.subarray(0, 4).toString("ascii") === "RIFF"
      && body.subarray(8, 12).toString("ascii") === "WEBP";
  }
  return false;
}

async function uploadImage(req, res, url) {
  try {
    const country = safeSegment(url.searchParams.get("country"), "country code").toLowerCase();
    const catalog = safeSegment(url.searchParams.get("catalog"), "catalog number");
    const setId = String(url.searchParams.get("set") || "");
    const contentType = String(req.headers["content-type"] || "").split(";", 1)[0].toLowerCase();
    const extension = IMAGE_TYPES.get(contentType);
    if (!extension) throw new Error("Use a JPEG, PNG, WebP, or GIF image");

    const catalogPath = path.join(ROOT, "catalogs", `${country}.json`);
    const doc = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
    const sets = Array.isArray(doc) ? doc : doc.sets;
    const set = sets.find((entry) => String(entry.id || "") === setId);
    const stamp = set?.stamps?.find((entry) => String(entry.no || "") === catalog);
    if (!stamp) throw new Error("Catalog entry was not found in the selected set");

    const body = await readBody(req);
    if (!body.length) throw new Error("The uploaded image is empty");
    if (!hasImageSignature(body, contentType)) throw new Error("File contents do not match the selected image type");
    const imageDir = path.join(ROOT, "images", country);
    fs.mkdirSync(imageDir, { recursive: true });
    const filename = `${catalog}${extension}`;
    const imagePath = path.join(imageDir, filename);
    fs.writeFileSync(imagePath, body);

    const relativeUrl = `images/${country}/${filename}`;
    stamp.image = relativeUrl;
    fs.writeFileSync(catalogPath, `${JSON.stringify(doc)}\n`, "utf8");
    json(res, 200, { path: relativeUrl, url: relativeUrl });
  } catch (err) {
    json(res, /not found/i.test(err.message) ? 404 : 400, { error: err.message || String(err) });
  }
}

function serveFile(req, res, url) {
  const requestPath = decodeURIComponent(url.pathname === "/" ? "/output/index.html" : url.pathname);
  const absolute = path.resolve(ROOT, `.${requestPath}`);
  if (!absolute.startsWith(`${ROOT}${path.sep}`)) return json(res, 403, { error: "Forbidden" });
  fs.readFile(absolute, (err, body) => {
    if (err) return json(res, 404, { error: "Not found" });
    const type = ({ ".html": "text/html", ".json": "application/json", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif", ".svg": "image/svg+xml", ".ico": "image/x-icon" })[path.extname(absolute).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type });
    res.end(body);
  });
}

http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (req.method === "POST" && url.pathname === "/api/setfinder/image") {
    uploadImage(req, res, url);
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD") return json(res, 405, { error: "Method not allowed" });
  serveFile(req, res, url);
}).listen(PORT, () => {
  console.log(`Set Finder listening on http://localhost:${PORT}`);
});
