import { categories, deliveryZones, demoCustomers, demoOrders, products, promotions, settings } from "./data.js";

const defaults = {
  categories,
  products,
  orders: [],
  customers: demoCustomers,
  deliveryZones,
  promotions,
  settings,
  session: null,
  cart: [],
  lastOrder: null,
  points: 460,
};

const key = (name) => `girosking:${name}`;

export function read(name) {
  try {
    return JSON.parse(localStorage.getItem(key(name))) ?? structuredClone(defaults[name]);
  } catch {
    return structuredClone(defaults[name]);
  }
}

export function write(name, value) {
  localStorage.setItem(key(name), JSON.stringify(value));
  window.dispatchEvent(new CustomEvent("giros:data", { detail: { name } }));
  return value;
}

export function ensureSeedData() {
  Object.entries(defaults).forEach(([name, value]) => {
    if (!localStorage.getItem(key(name))) write(name, structuredClone(value));
  });
  const currentOrders = read("orders");
  const demoOrderIds = new Set(demoOrders.map((order) => order.id));
  if (currentOrders.length && currentOrders.every((order) => demoOrderIds.has(order.id))) {
    write("orders", []);
  }
}

export function money(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value || 0));
}

export function uid(prefix = "id") {
  return `${prefix}-${Math.random().toString(16).slice(2, 8)}${Date.now().toString(16).slice(-4)}`;
}

export function updateById(collection, id, patch) {
  return collection.map((item) => (item.id === id ? { ...item, ...patch } : item));
}

export function activeProducts() {
  const visibleCategories = new Set(read("categories").filter((category) => category.visible !== false).map((category) => category.id));
  return read("products").filter((product) => visibleCategories.has(product.category));
}

ensureSeedData();
