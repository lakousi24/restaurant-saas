import { money, read, uid, updateById, write } from "../shared/store.js";
import { changeOrderStatus } from "../shared/api.js";
import { getSupabaseStatus } from "../shared/supabase.js";

const app = document.querySelector("#adminApp");
const state = {
  authed: sessionStorage.getItem("girosking:admin") === "true",
  view: "overview",
  soundEnabled: true,
  dbStatus: "Checking storage",
  orderQuery: "",
  orderFilter: "all",
  sidebarCollapsed: false,
};

const orderStatuses = ["confirmed", "preparing", "ready", "completed", "cancelled"];
const nav = ["overview", "orders"];
const mvpViews = new Set(["overview", "orders"]);

function orders() {
  return read("orders").map((order) => ({
    ...order,
    status: ["Received", "Accepted", "Confirmed"].includes(order.status) ? "confirmed" : String(order.status || "confirmed").toLowerCase(),
  }));
}

function products() {
  return read("products");
}

function analytics() {
  const all = orders();
  const revenue = all.reduce((sum, order) => sum + Number(order.total || 0), 0);
  return {
    revenue,
    count: all.length,
    open: all.filter((order) => order.status !== "completed" && order.status !== "cancelled").length,
    average: all.length ? revenue / all.length : 0,
  };
}

function render() {
  app.innerHTML = state.authed ? renderDashboard() : renderLogin();
}

function renderLogin() {
  return `
    <main class="admin-login-screen">
      <form class="admin-login-card" id="adminLoginForm">
        <a class="brand" href="/"><span class="brand-mark">GK</span><span><strong>Giros King</strong><small>Private restaurant OS</small></span></a>
        <span class="live-badge">Admin only · /admin</span>
        <h1>Restaurant dashboard login</h1>
        <label class="field">Email<input type="email" name="email" value="owner@girosking.com" required /></label>
        <label class="field">Password<input type="password" name="password" value="king123" required /></label>
        <p class="form-message">Forgot password will be connected with real auth in the next backend step.</p>
        <button class="primary-action full" type="submit">Sign in</button>
        <p class="form-message" id="loginMessage"></p>
      </form>
    </main>
  `;
}

function renderDashboard() {
  return `
    <div class="admin-platform">
      <aside class="admin-sidebar ${state.sidebarCollapsed ? "collapsed" : ""}">
        <a class="brand" href="/"><span class="brand-mark">GK</span><span><strong>Giros King</strong><small>Owner console</small></span></a>
        <button class="sidebar-toggle" data-admin-action="toggle-sidebar">Collapse</button>
        <nav>
          ${nav.map((item) => `<button class="${state.view === item ? "active" : ""}" data-admin-view="${item}">${label(item)}</button>`).join("")}
        </nav>
        <button class="secondary-action full" data-admin-action="logout">Log out</button>
      </aside>
      <main class="admin-workspace">
        <header class="admin-header">
          <div><span class="live-badge">${state.dbStatus}</span><h1>${label(state.view)}</h1></div>
          <div class="admin-header-actions">
            <label class="restaurant-status"><input type="checkbox" ${read("settings").online ? "checked" : ""} data-setting="online" /><span></span>${read("settings").online ? "Online" : "Offline"}</label>
            <label class="sound-toggle"><input type="checkbox" ${state.soundEnabled ? "checked" : ""} data-sound /> New order sound</label>
          </div>
        </header>
        ${renderView()}
      </main>
    </div>
  `;
}

function label(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function renderView() {
  if (state.view === "overview") return renderOverview();
  if (state.view === "orders") return renderOrders();
  if (state.view === "menu") return renderMenu();
  if (state.view === "categories") return renderCategories();
  if (state.view === "delivery") return renderDelivery();
  if (state.view === "customers") return renderCustomers();
  if (state.view === "promotions") return renderPromotions();
  if (state.view === "analytics") return renderAnalytics();
  return renderSettings();
}

function renderOverview() {
  const stats = analytics();
  const topItems = topSellingItems();
  return `
    <section class="admin-grid">
      <div class="admin-metrics-row span-2">
        <article><span>Total orders</span><strong>${stats.count}</strong></article>
        <article><span>Revenue</span><strong>${money(stats.revenue)}</strong></article>
        <article><span>Open orders</span><strong>${stats.open}</strong></article>
      </div>
      <section class="admin-panel">
        <span>Top selling items</span><h2>Today</h2>
        <div class="compact-admin-list">${topItems.map((item) => `<article><strong>${item.name}</strong><span>${item.count} sold</span></article>`).join("")}</div>
      </section>
      <section class="admin-panel">
        <span>Recent orders</span><h2>Latest activity</h2>
        <div class="compact-admin-list">${orders().slice(0, 5).map((order) => `<article><strong>${order.id}</strong><span>${order.customer} · ${label(order.status)} · ${money(order.total)}</span></article>`).join("")}</div>
      </section>
    </section>
  `;
}

function topSellingItems() {
  const counts = new Map();
  orders().forEach((order) => {
    String(order.items || "").split(",").forEach((raw) => {
      const name = raw.replace(/^\s*\d+x\s*/, "").trim();
      if (name) counts.set(name, (counts.get(name) || 0) + 1);
    });
  });
  return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 5);
}

function renderOrders() {
  const stats = analytics();
  const filteredOrders = orders().filter((order) => {
    const query = `${order.id} ${order.customer} ${order.items}`.toLowerCase().includes(state.orderQuery.toLowerCase());
    const filter = state.orderFilter === "all" || order.status === state.orderFilter;
    return query && filter;
  });
  return `
    <section class="admin-grid">
      <div class="admin-metrics-row">
        <article><span>Revenue</span><strong>${money(stats.revenue)}</strong></article>
        <article><span>Open orders</span><strong>${stats.open}</strong></article>
        <article><span>Average ticket</span><strong>${money(stats.average)}</strong></article>
      </div>
      <section class="admin-panel span-2">
        <div class="panel-heading"><div><span>Live incoming orders</span><h2>Kitchen queue</h2></div></div>
        <div class="admin-toolbar">
          <input type="search" placeholder="Search orders" value="${state.orderQuery}" data-order-search />
          <select data-order-filter><option value="all">All statuses</option>${orderStatuses.map((status) => `<option value="${status}" ${state.orderFilter === status ? "selected" : ""}>${label(status)}</option>`).join("")}</select>
        </div>
        <div class="order-kanban">
          ${orderStatuses.map((status) => `
            <div>
              <h3>${label(status)}</h3>
              ${filteredOrders.filter((order) => order.status === status).map(renderOrderCard).join("") || `<p class="empty-admin">No orders</p>`}
            </div>
          `).join("")}
        </div>
      </section>
    </section>
  `;
}

function renderOrderCard(order) {
  return `
    <article class="admin-order-card">
      <div class="order-card-head"><strong>${order.id}</strong><span class="status-badge ${order.status}">${label(order.status)}</span></div>
      <span>${order.customer} · ${order.phone || "No phone"} · ${order.fulfillment}</span>
      <p>${renderOrderItems(order)}</p>
      <small>${order.zone} · ${order.address || "Pickup"} · ${order.createdAt} · ${money(order.total)}</small>
      <small>${order.notes ? `Note: ${order.notes}` : "No customer notes"} · ${order.paymentMethod || "Card"}</small>
      <div class="order-actions">
        <button data-order-action="preparing" data-order-id="${order.id}" ${order.status === "preparing" ? "disabled" : ""}>Preparing</button>
        <button data-order-action="ready" data-order-id="${order.id}" ${order.status === "ready" ? "disabled" : ""}>Ready</button>
        <button data-order-action="completed" data-order-id="${order.id}" ${order.status === "completed" ? "disabled" : ""}>Completed</button>
        <button data-order-action="cancelled" data-order-id="${order.id}" ${order.status === "cancelled" ? "disabled" : ""}>Cancel</button>
        <button data-print-order="${order.id}">Print</button>
      </div>
      <details><summary>Email history</summary>${(order.emailLogs || []).map((log) => `<small>${log.type} · ${log.status} · ${log.sentAt || ""}</small>`).join("") || "<small>No email logs yet</small>"}</details>
    </article>
  `;
}

function renderOrderItems(order) {
  if (Array.isArray(order.orderItems) && order.orderItems.length) {
    return order.orderItems.map((item) => `${item.quantity}x ${item.name}${item.options ? ` (${item.options})` : ""}`).join(", ");
  }
  return order.items || "No items";
}

function renderMenu() {
  return `
    <section class="admin-grid">
      <section class="admin-panel span-2">
        <div class="panel-heading"><div><span>Menu management</span><h2>Products, photos, prices</h2></div><button class="secondary-action" data-admin-action="add-product">Add product</button></div>
        <div class="menu-admin-list">${products().map(renderProductEditor).join("")}</div>
      </section>
    </section>
  `;
}

function renderCategories() {
  return `
    <section class="admin-panel">
      <div class="panel-heading"><div><span>Category management</span><h2>Categories</h2></div><button class="secondary-action" data-admin-action="add-category">Add category</button></div>
      <div class="compact-admin-list category-admin-list">
        ${read("categories").map((category) => `
          <article>
            <label>Name<input value="${category.name}" data-category-name="${category.id}" /></label>
            <label>Icon<input value="${category.icon || ""}" data-category-icon="${category.id}" /></label>
            <label>Description<input value="${category.description || ""}" data-category-description="${category.id}" /></label>
            <label>Sort order<input type="number" value="${category.sortOrder || 0}" data-category-sort="${category.id}" /></label>
            <label class="toggle-control"><input type="checkbox" ${category.visible !== false ? "checked" : ""} data-category-visible="${category.id}" /><span></span> Visible</label>
            <button class="danger-button" data-delete-category="${category.id}">Delete</button>
          </article>
        `).join("")}
      </div>
    </section>
  `;
}

function renderProductEditor(product) {
  return `
    <article class="product-admin-row ${product.available === false ? "sold-out" : ""}">
      <div class="admin-photo">
        <img src="${product.image || "assets/giros-hero.png"}" alt="${product.name}" />
        <input type="file" accept="image/*" data-photo="${product.id}" />
      </div>
      <div class="admin-product-fields">
        <input value="${product.name}" data-product-field="${product.id}" data-field="name" />
        <select data-product-field="${product.id}" data-field="category">
          ${read("categories").map((category) => `<option value="${category.id}" ${category.id === product.category ? "selected" : ""}>${category.name}</option>`).join("")}
        </select>
        <input type="number" step="0.05" min="0" value="${product.price}" data-product-field="${product.id}" data-field="price" />
        <input type="number" step="1" min="1" value="${product.prep || 10}" data-product-field="${product.id}" data-field="prep" />
        <textarea data-product-field="${product.id}" data-field="description">${product.description}</textarea>
        <textarea data-product-field="${product.id}" data-field="ingredients">${product.ingredients || ""}</textarea>
        <input value="${product.allergens || ""}" data-product-field="${product.id}" data-field="allergens" />
      </div>
      <label class="toggle-control"><input type="checkbox" ${product.available !== false ? "checked" : ""} data-product-availability="${product.id}" /><span></span> Available</label>
      <label class="toggle-control"><input type="checkbox" ${product.bestseller ? "checked" : ""} data-product-flag="${product.id}" data-field="bestseller" /><span></span> Bestseller</label>
      <label class="toggle-control"><input type="checkbox" ${product.spicy ? "checked" : ""} data-product-flag="${product.id}" data-field="spicy" /><span></span> Spicy</label>
      <label class="toggle-control"><input type="checkbox" ${product.vegetarian ? "checked" : ""} data-product-flag="${product.id}" data-field="vegetarian" /><span></span> Vegetarian</label>
      <button class="secondary-action" data-duplicate-product="${product.id}">Duplicate</button>
      <button class="danger-button" data-delete-product="${product.id}">Delete</button>
    </article>
  `;
}

function renderDelivery() {
  const settings = read("settings");
  return `
    <section class="admin-grid">
      <section class="admin-panel">
        <span>Opening hours</span><h2>Weekly schedule</h2>
        <div class="hours-admin">${settings.hours.map(([day, open, close]) => `<article><strong>${day}</strong><input type="time" value="${open}" /><input type="time" value="${close}" /></article>`).join("")}</div>
        <label class="toggle-control"><input type="checkbox" ${settings.temporaryClosed ? "checked" : ""} data-setting="temporaryClosed" /><span></span> Temporarily closed</label>
        <label class="toggle-control"><input type="checkbox" ${settings.preorderEnabled ? "checked" : ""} data-setting="preorderEnabled" /><span></span> Allow preorders</label>
        <label>Order cutoff<input type="time" value="${settings.cutoffTime}" data-setting="cutoffTime" /></label>
        <label>Default prep time<input type="number" value="${settings.defaultPrepMinutes}" data-setting="defaultPrepMinutes" /></label>
      </section>
      <section class="admin-panel">
        <span>Pickup and delivery settings</span><h2>Fulfillment</h2>
        <div class="settings-stack">
          <label class="toggle-control"><input type="checkbox" ${settings.pickupEnabled ? "checked" : ""} data-setting="pickupEnabled" /><span></span> Pickup enabled</label>
          <label class="toggle-control"><input type="checkbox" ${settings.deliveryEnabled ? "checked" : ""} data-setting="deliveryEnabled" /><span></span> Delivery enabled</label>
          <label>Minimum order<input type="number" value="${settings.minimumOrder}" data-setting="minimumOrder" /></label>
          <label>Free delivery threshold<input type="number" value="${settings.freeDeliveryThreshold}" data-setting="freeDeliveryThreshold" /></label>
        </div>
      </section>
      <section class="admin-panel span-2">
        <div class="panel-heading"><div><span>Delivery zones and fees</span><h2>Zones</h2></div><button class="secondary-action" data-admin-action="add-zone">Add zone</button></div>
        <div class="zone-grid">${read("deliveryZones").map((zone) => `<article><input value="${zone.name}" data-zone-field="${zone.id}" data-field="name" /><input value="${zone.area}" data-zone-field="${zone.id}" data-field="area" /><input type="number" value="${zone.fee}" data-zone-field="${zone.id}" data-field="fee" /><input value="${zone.eta}" data-zone-field="${zone.id}" data-field="eta" /></article>`).join("")}</div>
      </section>
    </section>
  `;
}

function renderCustomers() {
  return `
    <section class="admin-panel">
      <span>Customer management</span><h2>Customer database</h2>
      <div class="customer-admin-grid">${read("customers").map((customer) => `<article><strong>${customer.name}</strong><span>${customer.email}</span><span>${customer.phone}</span><b>${customer.orders} orders · ${money(customer.spent)} · ${customer.points} pts</b></article>`).join("")}</div>
    </section>
  `;
}

function renderPromotions() {
  const settings = read("settings");
  return `
    <section class="admin-grid">
      <section class="admin-panel">
        <div class="panel-heading"><div><span>Promo and discount management</span><h2>Discount codes</h2></div><button class="secondary-action" data-admin-action="add-promo">Add code</button></div>
        <div class="compact-admin-list">${read("promotions").map((promo) => `<article><input value="${promo.code}" data-promo-field="${promo.id}" data-field="code" /><select data-promo-field="${promo.id}" data-field="type"><option value="percent" ${promo.type === "percent" ? "selected" : ""}>Percent</option><option value="fixed" ${promo.type === "fixed" ? "selected" : ""}>Fixed</option></select><input type="number" value="${promo.value}" data-promo-field="${promo.id}" data-field="value" /><input type="number" value="${promo.minimumOrder || 0}" data-promo-field="${promo.id}" data-field="minimumOrder" /><input type="number" value="${promo.maxRedemptions || 100}" data-promo-field="${promo.id}" data-field="maxRedemptions" /><input type="date" value="${promo.expiresAt || ""}" data-promo-field="${promo.id}" data-field="expiresAt" /><label class="toggle-control"><input type="checkbox" ${promo.firstOrderOnly ? "checked" : ""} data-promo-flag="${promo.id}" data-field="firstOrderOnly" /><span></span> First order</label><label class="toggle-control"><input type="checkbox" ${promo.active ? "checked" : ""} data-promo-active="${promo.id}" /><span></span> Active</label></article>`).join("")}</div>
      </section>
      <section class="admin-panel">
        <span>Loyalty settings</span><h2>Rewards</h2>
        <div class="settings-stack">
          <label>Points per dollar<input type="number" value="${settings.loyalty.pointsPerDollar}" data-loyalty="pointsPerDollar" /></label>
          <label>Redemption points<input type="number" value="${settings.loyalty.redemptionPoints}" data-loyalty="redemptionPoints" /></label>
          <label>Reward value<input type="number" value="${settings.loyalty.rewardValue}" data-loyalty="rewardValue" /></label>
        </div>
      </section>
    </section>
  `;
}

function renderAnalytics() {
  const stats = analytics();
  return `
    <section class="admin-grid">
      <div class="admin-metrics-row span-2">
        <article><span>Total revenue</span><strong>${money(stats.revenue)}</strong></article>
        <article><span>Total orders</span><strong>${stats.count}</strong></article>
        <article><span>Average ticket</span><strong>${money(stats.average)}</strong></article>
      </div>
      <section class="admin-panel span-2">
        <span>Analytics dashboard</span><h2>Order volume</h2>
        <div class="analytics-bars">${[12, 18, 15, 24, Math.max(8, stats.count * 5)].map((value, index) => `<div><strong style="height:${value * 5}px"></strong><span>${["Mon", "Tue", "Wed", "Thu", "Fri"][index]}</span></div>`).join("")}</div>
      </section>
    </section>
  `;
}

function renderSettings() {
  const settings = read("settings");
  return `
    <section class="admin-grid">
      <section class="admin-panel">
        <span>Restaurant settings</span><h2>Profile</h2>
        <div class="settings-stack">
          <label>Name<input value="${settings.restaurantName}" data-setting="restaurantName" /></label>
          <label>Phone<input value="${settings.phone}" data-setting="phone" /></label>
          <label>Address<input value="${settings.address}" data-setting="address" /></label>
          <label>Email<input value="${settings.email}" data-setting="email" /></label>
          <label>Google Maps link<input value="${settings.mapsUrl}" data-setting="mapsUrl" /></label>
          <label>Logo upload<input type="file" data-logo-upload /></label>
          <label>Favicon upload<input type="file" data-favicon-upload /></label>
        </div>
      </section>
      <section class="admin-panel">
        <span>Payment settings</span><h2>Payments</h2>
        <p class="empty-admin">Stripe-ready structure for provider credentials, payout schedule, terminal mapping, and tax settings.</p>
        <div class="settings-stack row">
          <label class="toggle-control"><input type="checkbox" checked disabled /><span></span> Cash</label>
          <label class="toggle-control"><input type="checkbox" checked disabled /><span></span> Card</label>
          <label class="toggle-control"><input type="checkbox" checked disabled /><span></span> Online</label>
        </div>
      </section>
      <section class="admin-panel span-2">
        <span>Notification settings</span><h2>Alerts</h2>
        <div class="settings-stack row">
          <label>Admin email<input value="${settings.adminEmail}" data-setting="adminEmail" /></label>
          <label class="toggle-control"><input type="checkbox" ${settings.customerEmailNotifications ? "checked" : ""} data-setting="customerEmailNotifications" /><span></span> Customer emails</label>
          <label class="toggle-control"><input type="checkbox" ${state.soundEnabled ? "checked" : ""} data-sound /><span></span> New order sound</label>
          <label class="toggle-control"><input type="checkbox" ${settings.browserNotifications ? "checked" : ""} data-setting="browserNotifications" /><span></span> Browser notifications</label>
          <label class="toggle-control"><input type="checkbox" checked disabled /><span></span> Daily report email</label>
        </div>
      </section>
      <section class="admin-panel span-2">
        <span>Business</span><h2>Localization and legal</h2>
        <div class="settings-stack row">
          <label>Currency<input value="${settings.currency}" data-setting="currency" /></label>
          <label>Language<input value="${settings.language}" data-setting="language" /></label>
          <label>Timezone<input value="${settings.timezone}" data-setting="timezone" /></label>
          <label>VAT / tax rate<input type="number" value="${settings.taxRate}" data-setting="taxRate" /></label>
          <label>Service fee<input type="number" value="${settings.serviceFee}" data-setting="serviceFee" /></label>
        </div>
      </section>
    </section>
  `;
}

function playOrderSound() {
  if (!state.soundEnabled) return;
  const audio = new AudioContext();
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  oscillator.frequency.value = 880;
  gain.gain.value = 0.05;
  oscillator.connect(gain).connect(audio.destination);
  oscillator.start();
  oscillator.stop(audio.currentTime + 0.18);
}

function updateCollection(name, id, patch) {
  write(name, updateById(read(name), id, patch));
  render();
}

async function updateOrderStatus(id, status) {
  const order = orders().find((item) => item.id === id);
  if (!order) return;
  const nextOrder = { ...order, status };
  write("orders", updateById(orders(), id, { status }));
  render();
  try {
    const result = await changeOrderStatus(nextOrder, status);
    write("orders", updateById(orders(), id, result.order));
  } catch {
    console.warn("Email status notification failed");
  }
  render();
}

function printReceipt(order) {
  const receipt = `
    <section class="receipt">
      <h1>Giros King</h1>
      <p>${order.id} · ${order.createdAt || new Date().toLocaleString()}</p>
      <hr />
      <p><strong>${order.customer}</strong><br />${order.phone || ""}<br />${order.fulfillment} ${order.address ? `· ${order.address}` : ""}</p>
      <p>${order.items}</p>
      <p>Notes: ${order.notes || "None"}</p>
      <hr />
      <p>Subtotal: ${money(order.subtotal || order.total)}<br />Delivery: ${money(order.deliveryFee || 0)}<br />Discount: ${money(order.discount || 0)}</p>
      <h2>Total ${money(order.total)}</h2>
      <p>${order.paymentMethod || "Card"}</p>
    </section>
  `;
  const printWindow = window.open("", "_blank", "width=420,height=640");
  if (!printWindow) return;
  printWindow.document.write(`<html><head><title>${order.id}</title><link rel="stylesheet" href="styles.css"></head><body>${receipt}</body></html>`);
  printWindow.document.close();
  printWindow.print();
}

app.addEventListener("submit", (event) => {
  event.preventDefault();
  if (event.target.id !== "adminLoginForm") return;
  const data = new FormData(event.target);
  if (data.get("email") === "owner@girosking.com" && data.get("password") === "king123") {
    state.authed = true;
    sessionStorage.setItem("girosking:admin", "true");
    render();
  } else {
    document.querySelector("#loginMessage").textContent = "Invalid admin credentials.";
  }
});

app.addEventListener("click", (event) => {
  const view = event.target.closest("[data-admin-view]")?.dataset.adminView;
  const action = event.target.closest("[data-admin-action]")?.dataset.adminAction;
  if (view && mvpViews.has(view)) {
    state.view = view;
    render();
  }
  if (action === "logout") {
    state.authed = false;
    sessionStorage.removeItem("girosking:admin");
    render();
  }
  if (action === "toggle-sidebar") {
    state.sidebarCollapsed = !state.sidebarCollapsed;
    render();
  }
  if (action === "add-product") {
    write("products", [{ id: uid("product"), name: "New product", category: "gyros", price: 9.95, prep: 10, rating: 4.7, image: "assets/giros-hero.png", icon: "NP", description: "Describe this product.", available: true }, ...products()]);
    render();
  }
  if (action === "add-category") {
    write("categories", [...read("categories"), { id: uid("cat"), name: "New category", icon: "□", visible: true }]);
    render();
  }
  if (action === "add-zone") {
    write("deliveryZones", [...read("deliveryZones"), { id: uid("zone"), name: "New zone", area: "Custom", fee: 3.99, eta: "30-45 min" }]);
    render();
  }
  if (action === "add-promo") {
    write("promotions", [...read("promotions"), { id: uid("promo"), code: "NEW10", label: "New discount", type: "percent", value: 10, active: true }]);
    render();
  }
  const orderAction = event.target.closest("[data-order-action]");
  if (orderAction) updateOrderStatus(orderAction.dataset.orderId, orderAction.dataset.orderAction);
  const deleteProduct = event.target.closest("[data-delete-product]");
  if (deleteProduct) {
    write("products", products().filter((product) => product.id !== deleteProduct.dataset.deleteProduct));
    render();
  }
  const duplicateProduct = event.target.closest("[data-duplicate-product]");
  if (duplicateProduct) {
    const product = products().find((item) => item.id === duplicateProduct.dataset.duplicateProduct);
    write("products", [{ ...product, id: uid("product"), name: `${product.name} copy` }, ...products()]);
    render();
  }
  const deleteCategory = event.target.closest("[data-delete-category]");
  if (deleteCategory) {
    write("categories", read("categories").filter((category) => category.id !== deleteCategory.dataset.deleteCategory));
    render();
  }
  const printOrder = event.target.closest("[data-print-order]");
  if (printOrder) printReceipt(orders().find((order) => order.id === printOrder.dataset.printOrder));
});

app.addEventListener("change", (event) => {
  const target = event.target;
  if (target.matches("[data-sound]")) state.soundEnabled = target.checked;
  if (target.matches("[data-order-status]")) updateOrderStatus(target.dataset.orderStatus, target.value);
  if (target.matches("[data-product-field]")) {
    updateCollection("products", target.dataset.productField, { [target.dataset.field]: target.dataset.field === "price" ? Number(target.value) : target.value });
  }
  if (target.matches("[data-product-availability]")) updateCollection("products", target.dataset.productAvailability, { available: target.checked });
  if (target.matches("[data-product-flag]")) updateCollection("products", target.dataset.productFlag, { [target.dataset.field]: target.checked });
  if (target.matches("[data-category-name]")) updateCollection("categories", target.dataset.categoryName, { name: target.value });
  if (target.matches("[data-category-icon]")) updateCollection("categories", target.dataset.categoryIcon, { icon: target.value });
  if (target.matches("[data-category-description]")) updateCollection("categories", target.dataset.categoryDescription, { description: target.value });
  if (target.matches("[data-category-sort]")) updateCollection("categories", target.dataset.categorySort, { sortOrder: Number(target.value || 0) });
  if (target.matches("[data-category-visible]")) updateCollection("categories", target.dataset.categoryVisible, { visible: target.checked });
  if (target.matches("[data-zone-field]")) updateCollection("deliveryZones", target.dataset.zoneField, { [target.dataset.field]: target.dataset.field === "fee" ? Number(target.value) : target.value });
  if (target.matches("[data-promo-field]")) updateCollection("promotions", target.dataset.promoField, { [target.dataset.field]: target.dataset.field === "value" ? Number(target.value) : target.value });
  if (target.matches("[data-promo-active]")) updateCollection("promotions", target.dataset.promoActive, { active: target.checked });
  if (target.matches("[data-promo-flag]")) updateCollection("promotions", target.dataset.promoFlag, { [target.dataset.field]: target.checked });
  if (target.matches("[data-setting]")) {
    const settings = read("settings");
    const value = target.type === "checkbox" ? target.checked : target.type === "number" ? Number(target.value) : target.value;
    write("settings", { ...settings, [target.dataset.setting]: value });
    render();
  }
  if (target.matches("[data-loyalty]")) {
    const settings = read("settings");
    write("settings", { ...settings, loyalty: { ...settings.loyalty, [target.dataset.loyalty]: Number(target.value) } });
    render();
  }
  if (target.matches("[data-photo]") && target.files?.[0]) {
    const reader = new FileReader();
    reader.addEventListener("load", () => updateCollection("products", target.dataset.photo, { image: String(reader.result) }));
    reader.readAsDataURL(target.files[0]);
  }
});

app.addEventListener("input", (event) => {
  if (event.target.matches("[data-order-search]")) {
    state.orderQuery = event.target.value;
    render();
  }
});

app.addEventListener("change", (event) => {
  if (event.target.matches("[data-order-filter]")) {
    state.orderFilter = event.target.value;
    render();
  }
});

getSupabaseStatus().then((status) => {
  state.dbStatus = status.mode;
  render();
});

window.addEventListener("storage", (event) => {
  if (event.key === "girosking:orders") render();
});

window.addEventListener("giros:data", (event) => {
  if (event.detail?.name === "orders") render();
});

render();
