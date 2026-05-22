import { quoteDelivery } from "./address-service.js";
import { uid, write, read } from "./store.js";
import { sanitize } from "./validation.js";

export const ORDER_STATUSES = ["confirmed", "preparing", "ready", "completed", "cancelled"];
export { quoteDelivery } from "./address-service.js";

export function pickupSlots() {
  return ["11:30", "12:00", "12:30", "13:00", "17:30", "18:00", "18:30", "19:00", "19:30", "20:00", "20:30"];
}

export function todayISO(offset = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
}

export function formatSchedule(schedule) {
  if (!schedule?.date || !schedule?.time) return "ASAP";
  return `${schedule.time} ${schedule.date}`;
}

export function cartSubtotal(cart) {
  return cart.reduce((sum, item) => sum + Number(item.lineTotal || 0) * Number(item.quantity || 1), 0);
}

export function createOrderFromCart({ cart, context, customer, notes = "", paymentMethod = "Cash", voucher = null }) {
  const subtotal = cartSubtotal(cart);
  const addressDetails = context.addressDetails || null;
  const quote = context.type === "delivery" ? quoteDelivery(addressDetails || context.address, subtotal) : { available: true, fee: 0, area: "Pickup", eta: "" };
  const discount = voucher ? Math.min(subtotal, Number(voucher.discount || voucher.value || 0)) : 0;
  return {
    id: `GK-${Math.floor(100000 + Math.random() * 899999)}`,
    restaurantId: "giros-king",
    customerId: customer.id,
    customer: customer.name,
    email: customer.email,
    phone: customer.phone,
    status: "confirmed",
    fulfillment: context.type === "delivery" ? "Delivery" : "Pickup",
    orderType: context.type,
    address: context.type === "delivery" ? addressDetails?.formattedAddress || context.address : "",
    addressDetails: context.type === "delivery" ? addressDetails : null,
    pickupStore: context.type === "pickup" ? context.storeAddress : "",
    scheduledDate: context.date,
    scheduledTime: context.time,
    zone: quote.area,
    distanceKm: quote.distanceKm || 0,
    items: cart.map((item) => `${item.quantity}x ${item.name}`).join(", "),
    orderItems: cart.map((item) => ({
      productId: item.productId,
      name: item.name,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      lineTotal: item.lineTotal * item.quantity,
      size: item.size,
      base: item.base,
      sauce: item.sauce,
      toppings: item.toppings,
      removedToppings: item.removedToppings,
      extras: item.extras,
      notes: item.notes,
    })),
    subtotal,
    deliveryFee: quote.fee,
    discount,
    total: Math.max(0, subtotal + quote.fee - discount),
    paymentMethod,
    notes: sanitize(notes),
    createdAt: new Date().toISOString(),
    confirmedAt: new Date().toISOString(),
  };
}

export function saveOrder(order) {
  write("orders", [order, ...read("orders")]);
  write("lastOrder", order);
  return order;
}

export function newCartItem(product, config = {}) {
  return {
    cartId: uid("cart"),
    productId: product.id,
    name: product.name,
    quantity: Number(config.quantity || 1),
    unitPrice: Number(config.unitPrice || product.price || 0),
    lineTotal: Number(config.lineTotal || product.price || 0),
    size: config.size || "Medium",
    base: config.base || "Classic",
    sauce: config.sauce || "Tomato",
    toppings: config.toppings || [],
    removedToppings: config.removedToppings || [],
    extras: config.extras || [],
    notes: sanitize(config.notes),
    summary: config.summary || "",
  };
}
