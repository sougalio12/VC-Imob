import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const port = Number(process.env.LOCAL_PROPERTY_PORT || 4173);
const catalogPath = resolve(process.cwd(), "data/imoveis.json");

const server = createServer(async (request, response) => {
  if (request.url !== "/data/imoveis.json") {
    response.writeHead(404).end();
    return;
  }

  try {
    const body = await readFile(catalogPath);
    response.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*"
    });
    response.end(body);
  } catch {
    response.writeHead(500).end();
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Local property catalog listening on ${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
