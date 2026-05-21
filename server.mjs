import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createOrder, rateLimited, updateOrderStatus } from "./src/server/order-service.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.PORT || 4173);

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
};

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(payload));
}

async function handleApi(request, response, url) {
  if (rateLimited(request.socket.remoteAddress || "local")) {
    sendJson(response, 429, { ok: false, error: "Too many requests" });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/orders") {
    const result = await createOrder(await readBody(request));
    sendJson(response, result.status, result.payload);
    return true;
  }

  if (request.method === "POST" && url.pathname.startsWith("/api/orders/") && url.pathname.endsWith("/status")) {
    const id = url.pathname.split("/")[3];
    const result = await updateOrderStatus(id, await readBody(request));
    sendJson(response, result.status, result.payload);
    return true;
  }

  return false;
}

createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host}`);
    if (url.pathname.startsWith("/api/") && (await handleApi(request, response, url))) return;

    const cleanPath = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
    const routePath = cleanPath === "/admin" || cleanPath === "/admin/" ? "admin.html" : cleanPath === "/" ? "index.html" : cleanPath;
    let filePath = join(root, routePath);

    if (existsSync(filePath) && statSync(filePath).isDirectory()) filePath = join(filePath, "index.html");
    if (!existsSync(filePath)) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }

    response.writeHead(200, { "Content-Type": types[extname(filePath)] || "application/octet-stream" });
    createReadStream(filePath).pipe(response);
  } catch (error) {
    sendJson(response, 500, { ok: false, error: error.message });
  }
}).listen(port, "0.0.0.0", () => {
  console.log(`Giros King app running at http://localhost:${port}`);
});
