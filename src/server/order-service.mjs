const adminEmail = process.env.ADMIN_ORDER_EMAIL || "owner@girosking.com";
const memoryOrders = globalThis.__GIROS_KING_ORDERS__ || new Map();
const rateWindow = globalThis.__GIROS_KING_RATE_WINDOW__ || new Map();

globalThis.__GIROS_KING_ORDERS__ = memoryOrders;
globalThis.__GIROS_KING_RATE_WINDOW__ = rateWindow;

export function sanitize(value) {
  return String(value || "").replace(/[<>]/g, "").trim();
}

export function sanitizeOrder(order) {
  return {
    ...order,
    id: sanitize(order.id),
    customer: sanitize(order.customer),
    email: sanitize(order.email),
    phone: sanitize(order.phone),
    fulfillment: sanitize(order.fulfillment),
    address: sanitize(order.address),
    notes: sanitize(order.notes),
    items: sanitize(order.items),
    paymentMethod: sanitize(order.paymentMethod || "Card"),
    total: Number(order.total || 0),
    subtotal: Number(order.subtotal || 0),
    deliveryFee: Number(order.deliveryFee || 0),
    discount: Number(order.discount || 0),
    emailLogs: Array.isArray(order.emailLogs) ? order.emailLogs : [],
  };
}

export function validateOrder(order) {
  const missing = ["id", "customer", "email", "phone", "items"].filter((field) => !sanitize(order[field]));
  if (missing.length) return `Missing required fields: ${missing.join(", ")}`;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(order.email)) return "Invalid customer email";
  if (!Number.isFinite(Number(order.total)) || Number(order.total) <= 0) return "Invalid order total";
  return "";
}

export function rateLimited(ip = "local") {
  const now = Date.now();
  const current = rateWindow.get(ip) || { count: 0, start: now };
  if (now - current.start > 60_000) {
    rateWindow.set(ip, { count: 1, start: now });
    return false;
  }
  current.count += 1;
  rateWindow.set(ip, current);
  return current.count > 60;
}

async function createTransport() {
  try {
    const nodemailer = await import("nodemailer");
    if (process.env.SMTP_HOST) {
      return nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_SECURE === "true",
        auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
      });
    }
    return {
      sendMail: async (message) => {
        console.log("[email:dev]", message.to, message.subject);
        return { messageId: `dev-${Date.now()}` };
      },
    };
  } catch {
    return {
      sendMail: async (message) => {
        console.log("[email:nodemailer-not-installed]", message.to, message.subject);
        return { messageId: `mock-${Date.now()}` };
      },
    };
  }
}

function emailShell(title, body) {
  return `
    <div style="margin:0;background:#0b0f14;padding:32px;font-family:Inter,Arial,sans-serif;color:#f7f3ec">
      <div style="max-width:620px;margin:auto;background:#121820;border:1px solid rgba(255,255,255,.12);border-radius:24px;overflow:hidden">
        <div style="padding:24px;background:linear-gradient(135deg,#ef5b3f,#f4bf4f);color:#17100c">
          <strong style="font-size:22px">Giros King</strong>
          <div style="font-size:13px;font-weight:700">Premium Greek delivery</div>
        </div>
        <div style="padding:28px">
          <h1 style="margin:0 0 12px;font-size:28px;line-height:1.05">${title}</h1>
          ${body}
        </div>
      </div>
    </div>
  `;
}

function customerEmail(order, type) {
  const copy = {
    received: ["Order received", "Your order is in our system and the restaurant has been notified."],
    accepted: ["Order accepted", "The kitchen accepted your order and is preparing it now."],
    preparing: ["Order in preparation", "Your order is now being prepared by the Giros King kitchen."],
    ready: ["Order ready", "Your Giros King order is ready for pickup or handoff."],
    rejected: ["Order cancelled", "The restaurant could not accept this order. Please contact Giros King if you need help."],
    cancelled: ["Order cancelled", "This order was cancelled. Please contact Giros King if you need help."],
  }[type];
  return emailShell(copy[0], `
    <p style="color:#cbd5df;line-height:1.6">${copy[1]}</p>
    <div style="margin:22px 0;padding:18px;border-radius:18px;background:rgba(255,255,255,.07)">
      <strong>Order ${order.id}</strong>
      <p style="margin:8px 0;color:#cbd5df">${order.items}</p>
      <p style="margin:0;color:#f4bf4f;font-weight:800">$${Number(order.total || 0).toFixed(2)}</p>
    </div>
  `);
}

function restaurantEmail(order) {
  return emailShell("New order received", `
    <p style="color:#cbd5df;line-height:1.6">A new ${order.fulfillment} order just arrived.</p>
    <div style="margin:22px 0;padding:18px;border-radius:18px;background:rgba(255,255,255,.07)">
      <strong>${order.id} · ${order.customer}</strong>
      <p style="margin:8px 0;color:#cbd5df">${order.items}</p>
      <p style="margin:0;color:#f4bf4f;font-weight:800">$${Number(order.total || 0).toFixed(2)}</p>
    </div>
    <p style="color:#cbd5df">Phone: ${order.phone || "Not provided"}</p>
  `);
}

async function sendEmail({ to, subject, html }) {
  const transport = await createTransport();
  const result = await transport.sendMail({ from: process.env.EMAIL_FROM || "Giros King <orders@girosking.local>", to, subject, html });
  return { to, subject, messageId: result.messageId, sentAt: new Date().toISOString() };
}

export async function createOrder(body = {}) {
  const order = sanitizeOrder(body.order || {});
  const validationError = validateOrder(order);
  if (validationError) return { status: 400, payload: { ok: false, error: validationError } };

  const emailResults = await Promise.allSettled([
    sendEmail({ to: order.email, subject: `Giros King order ${order.id} received`, html: customerEmail(order, "received") }),
    sendEmail({ to: adminEmail, subject: `New Giros King order ${order.id}`, html: restaurantEmail(order) }),
  ]);
  order.emailLogs = emailResults.map((result, index) => ({
    type: index === 0 ? "customer_received" : "restaurant_new_order",
    status: result.status,
    ...(result.status === "fulfilled" ? result.value : { error: result.reason?.message || "Email failed" }),
  }));
  memoryOrders.set(order.id, order);
  return { status: 201, payload: { ok: true, order } };
}

export async function updateOrderStatus(id, body = {}) {
  const status = sanitize(body.status);
  const order = sanitizeOrder(body.order || {});
  const nextOrder = { ...order, ...(memoryOrders.get(id) || {}), status };
  const statusToEmail = {
    Accepted: "accepted",
    Preparing: "preparing",
    Ready: "ready",
    Rejected: "rejected",
    Cancelled: "cancelled",
  };
  const emailType = statusToEmail[status];

  if (emailType && nextOrder.email) {
    try {
      const log = await sendEmail({ to: nextOrder.email, subject: `Giros King order ${nextOrder.id} ${status.toLowerCase()}`, html: customerEmail(nextOrder, emailType) });
      nextOrder.emailLogs = [...(nextOrder.emailLogs || []), { type: `customer_${emailType}`, status: "fulfilled", ...log }];
    } catch (error) {
      nextOrder.emailLogs = [...(nextOrder.emailLogs || []), { type: `customer_${emailType}`, status: "rejected", error: error.message }];
    }
  }

  memoryOrders.set(id, nextOrder);
  return { status: 200, payload: { ok: true, order: nextOrder } };
}
