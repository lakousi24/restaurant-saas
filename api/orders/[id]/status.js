import { rateLimited, updateOrderStatus } from "../../../src/server/order-service.mjs";

function clientIp(request) {
  return request.headers["x-forwarded-for"]?.split(",")[0]?.trim() || request.socket?.remoteAddress || "vercel";
}

function body(request) {
  if (typeof request.body === "string") return request.body ? JSON.parse(request.body) : {};
  return request.body || {};
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    response.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }
  if (rateLimited(clientIp(request))) {
    response.status(429).json({ ok: false, error: "Too many requests" });
    return;
  }

  const id = Array.isArray(request.query.id) ? request.query.id[0] : request.query.id;
  const result = await updateOrderStatus(id, body(request));
  response.status(result.status).json(result.payload);
}
