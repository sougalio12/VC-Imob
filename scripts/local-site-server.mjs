import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { createServer } from "node:http";

const root = resolve(process.cwd());
const port = Number(process.env.LOCAL_SITE_PORT || 4174);
const mimeTypes = { ".css": "text/css", ".html": "text/html", ".jpeg": "image/jpeg", ".jpg": "image/jpeg", ".js": "text/javascript", ".json": "application/json", ".md": "text/markdown", ".png": "image/png", ".svg": "image/svg+xml" };

createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url || "/", `http://${request.headers.host || "localhost"}`).pathname);
  const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = resolve(root, relativePath);
  if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) { response.writeHead(403).end(); return; }
  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error("Not a file");
    response.writeHead(200, { "Content-Type": `${mimeTypes[extname(filePath).toLowerCase()] || "application/octet-stream"}; charset=utf-8`, "Cache-Control": "no-store" });
    createReadStream(filePath).pipe(response);
  } catch { response.writeHead(404).end("Not found"); }
}).listen(port, "127.0.0.1", () => console.log(`Local site listening on ${port}`));
