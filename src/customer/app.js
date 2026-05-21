import { extras, sauces } from "../shared/data.js";
import { createOrder } from "../shared/api.js";
import { activeProducts, money, read, uid, write } from "../shared/store.js";
import { getSupabaseStatus } from "../shared/supabase.js";
import { email, required, sanitize, validateCheckout } from "../shared/validation.js";

const app = document.querySelector("#customerApp");

const copy = {
  delivery: "Delivery",
  pickup: "Pickup",
  startTitle: "How would you like to order?",
  confirmAddress: "Please confirm your delivery address",
};

const state = {
  category: "featured",
  query: "",
  fulfillment: read("fulfillmentChoice") || "",
  selectedProduct: null,
  authOpen: false,
  authMode: "signup",
  locationPrompt: read("cookieConsent") && !read("locationPreference"),
  addressConfirmOpen: false,
  pendingForm: null,
  user: read("session"),
  lastConfirmation: read("lastOrder"),
  submitting: false,
  toast: "",
  formErrors: {},
  accountErrors: {},
};

function cart() {
  return read("cart");
}

function settings() {
  return read("settings");
}

function customerAddress() {
  return read("deliveryAddress") || "";
}

function pickupSchedule() {
  return read("pickupSchedule") || { day: todayISO(), time: "18:00" };
}

function cartCount() {
  return cart().reduce((sum, item) => sum + item.quantity, 0);
}

function subtotal() {
  return cart().reduce((sum, item) => sum + item.lineTotal * item.quantity, 0);
}

function deliveryQuote(address = customerAddress()) {
  if (state.fulfillment !== "delivery") return { fee: 0, eta: "15-20 min", area: "Pickup" };
  const normalized = address.toLowerCase();
  const postcode = normalized.match(/\b\d{5}\b/)?.[0] || "";
  const zones = read("deliveryZones");
  let zone = zones[0];
  if (normalized.includes("midtown") || postcode.startsWith("10")) zone = zones[1] || zone;
  if (normalized.includes("outer") || normalized.includes("ring") || postcode.startsWith("11")) zone = zones[2] || zone;
  const fee = subtotal() >= settings().freeDeliveryThreshold ? 0 : Number(zone.fee || 0);
  return { fee, eta: zone.eta, area: zone.name };
}

function discount() {
  return 0;
}

function total() {
  return Math.max(0, subtotal() + deliveryQuote().fee - discount());
}

function todayISO(offset = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
}

function visibleProducts() {
  return activeProducts().filter((product) => {
    const categoryMatch = state.category === "featured" ? product.featured : product.category === state.category;
    const queryMatch = `${product.name} ${product.description}`.toLowerCase().includes(state.query.toLowerCase());
    return categoryMatch && queryMatch;
  });
}

function productBadge(product) {
  if (product.bestseller || product.featured) return "Popular";
  if (product.spicy || product.description.toLowerCase().includes("spicy")) return "Spicy";
  if (product.vegetarian) return "Vegetarian";
  return "";
}

function render() {
  app.innerHTML = `
    <div class="customer-shell delivery-theme">
      ${renderTopbar()}
      <main>
        ${renderHero()}
        ${!state.fulfillment ? renderStartScreen() : renderOrderingFlow()}
      </main>
      ${cart().length ? `<button class="mobile-cart-fab" data-scroll-cart>Cart (${cartCount()}) · ${money(total())}</button>` : ""}
      ${state.selectedProduct ? renderProductModal() : ""}
      ${state.authOpen ? renderAuthModal() : ""}
      ${state.addressConfirmOpen ? renderAddressConfirmation() : ""}
      ${!read("cookieConsent") ? renderCookieConsent() : ""}
      ${state.locationPrompt ? renderLocationPrompt() : ""}
      <div class="toast-host">${state.toast ? `<div class="toast">${state.toast}</div>` : ""}</div>
    </div>
  `;
}

function renderTopbar() {
  return `
    <header class="customer-topbar">
      <a class="brand premium-brand" href="#home">
        <span class="brand-mark">GK</span>
        <span><strong>Giros King</strong><small>Order online</small></span>
      </a>
      ${state.fulfillment ? `<nav class="premium-nav">
          <a href="#menu">Menu</a>
          <a href="#cart">Cart</a>
          <a href="#confirmation">Orders</a>
        </nav>` : ""}
      ${state.fulfillment ? `<button class="cart-icon" data-scroll-cart aria-label="Open cart">Cart<span>${cartCount()}</span></button>` : ""}
      <button class="user-chip account-button" data-action="auth">${state.user ? state.user.name : "Account"}</button>
    </header>
  `;
}

function renderHero() {
  return `
    <section class="customer-hero compact-hero" id="home">
      <div class="hero-copy">
        <span class="live-badge">Open today · ${state.fulfillment === "pickup" ? "Pickup available" : "Delivery available"}</span>
        <h1>Fresh Greek food, ordered in a few taps.</h1>
        <p>Choose delivery or pickup, customize your meal, confirm your address, and get an automatic order confirmation.</p>
        <div class="hero-search">
          <input type="search" placeholder="Search gyros, bowls, fries..." value="${state.query}" data-search />
          <button class="primary-action" data-scroll-menu ${state.fulfillment ? "" : "disabled"}>Browse menu</button>
        </div>
      </div>
      <img src="assets/giros-hero.png" alt="Fresh Giros King wrap" />
    </section>
  `;
}

function renderStartScreen() {
  const schedule = pickupSchedule();
  return `
    <section class="start-panel">
      <span class="live-badge">Start order</span>
      <h2>${copy.startTitle}</h2>
      <div class="choice-cards">
        <button data-start-mode="delivery">
          <strong>${copy.delivery}</strong>
          <span>Enter your address and we calculate the delivery fee automatically.</span>
        </button>
        <button data-start-mode="pickup">
          <strong>${copy.pickup}</strong>
          <span>Choose a pickup day and time before checkout.</span>
        </button>
      </div>
      <div class="start-details" data-start-details></div>
      <template data-delivery-template>
        <form id="deliveryStartForm" class="start-form">
          <label class="field">Delivery address<input name="address" placeholder="Street, city, postcode" value="${customerAddress()}" required /></label>
          <button class="primary-action full" type="submit">Continue to menu</button>
        </form>
      </template>
      <template data-pickup-template>
        <form id="pickupStartForm" class="start-form">
          <label class="field">Pickup day<select name="day">
            <option value="${todayISO()}" ${schedule.day === todayISO() ? "selected" : ""}>Today</option>
            <option value="${todayISO(1)}" ${schedule.day === todayISO(1) ? "selected" : ""}>Tomorrow</option>
            <option value="${todayISO(2)}" ${schedule.day === todayISO(2) ? "selected" : ""}>In two days</option>
          </select></label>
          <label class="field">Pickup time<select name="time">
            ${["17:30", "18:00", "18:30", "19:00", "19:30", "20:00"].map((time) => `<option value="${time}" ${schedule.time === time ? "selected" : ""}>${time}</option>`).join("")}
          </select></label>
          <button class="primary-action full" type="submit">Continue to menu</button>
        </form>
      </template>
    </section>
  `;
}

function renderOrderingFlow() {
  return `
    ${renderFulfillmentSummary()}
    ${renderMenu()}
    ${renderCartCheckout()}
    ${renderConfirmation()}
  `;
}

function renderFulfillmentSummary() {
  const quote = deliveryQuote();
  const schedule = pickupSchedule();
  return `
    <section class="order-summary-strip">
      <div>
        <span>${state.fulfillment === "delivery" ? "Delivering to" : "Pickup time"}</span>
        <strong>${state.fulfillment === "delivery" ? customerAddress() : `${schedule.day} at ${schedule.time}`}</strong>
      </div>
      <div>
        <span>${state.fulfillment === "delivery" ? "Delivery fee" : "Pickup fee"}</span>
        <strong>${state.fulfillment === "delivery" ? `${money(quote.fee)} · ${quote.eta}` : money(0)}</strong>
      </div>
      <button class="secondary-action" data-action="change-start">Change</button>
    </section>
  `;
}

function renderMenu() {
  const categories = read("categories").filter((category) => category.visible !== false);
  return `
    <section class="premium-section menu-surface" id="menu">
      <div class="section-title">
        <div><span>Menu</span><h2>Choose your food</h2></div>
      </div>
      <div class="category-dock">
        ${categories.map((category) => `<button class="${state.category === category.id ? "active" : ""}" data-category="${category.id}"><span>${category.icon}</span>${category.name}</button>`).join("")}
      </div>
      <div class="product-grid" data-product-grid>${renderProductGrid()}</div>
    </section>
  `;
}

function renderProductGrid() {
  const items = visibleProducts();
  return items.length ? items.map(renderProductCard).join("") : `<div class="empty-state dark">No dishes found. Try a different search.</div>`;
}

function updateProductGrid() {
  const grid = app.querySelector("[data-product-grid]");
  if (grid) grid.innerHTML = renderProductGrid();
}

function renderProductCard(product) {
  const badge = productBadge(product);
  return `
    <article class="premium-product ${product.available ? "" : "is-sold-out"}">
      <button class="product-media" data-product="${product.id}">
        <img src="${product.image}" alt="${product.name}" loading="lazy" />
        ${badge ? `<b>${badge}</b>` : ""}
      </button>
      <div class="product-content">
        <div><h3>${product.name}</h3><p>${product.description}</p></div>
        <div class="product-meta"><span>${money(product.price)}</span><small>${product.prep} min</small></div>
        <button class="add-premium" ${product.available ? `data-product="${product.id}"` : "disabled"}>${product.available ? "Customize" : "Sold out"}</button>
      </div>
    </article>
  `;
}

function renderCartCheckout() {
  const minimumRemaining = Math.max(0, settings().minimumOrder - subtotal());
  const validMinimum = state.fulfillment === "pickup" || subtotal() >= settings().minimumOrder;
  return `
    <section class="premium-section cart-checkout" id="cart">
      <div class="checkout-card">
        <div class="section-title compact">
          <div><span>Cart</span><h2>Your order</h2></div>
          ${cart().length ? `<button class="text-button" data-action="clear-cart">Clear</button>` : ""}
        </div>
        <div class="cart-lines">
          ${cart().length ? cart().map((item) => `
            <article>
              <div><strong>${item.name}</strong><span>${item.summary}</span></div>
              <div class="quantity-control"><button data-dec="${item.cartId}">-</button><b>${item.quantity}</b><button data-inc="${item.cartId}">+</button></div>
              <strong>${money(item.lineTotal * item.quantity)}</strong>
            </article>
          `).join("") : renderEmptyCart()}
        </div>
        <div class="fee-note" data-fee-note>${renderFeeNoteContent()}</div>
        ${!validMinimum ? `<div class="cart-warning">Add ${money(minimumRemaining)} more to reach the delivery minimum.</div>` : ""}
        ${renderTotals()}
      </div>
      <div class="checkout-card" id="checkout">
        ${state.user ? renderCheckoutForm(validMinimum) : renderAccountGate()}
      </div>
    </section>
  `;
}

function renderAccountGate() {
  return `
    <div class="section-title compact"><div><span>Account required</span><h2>Create an account to checkout</h2></div></div>
    <p class="helper-copy">Save your contact details before placing an order. This is localStorage for now and ready to replace with Supabase Auth later.</p>
    <button class="primary-action full" data-action="auth">Login or sign up</button>
  `;
}

function renderCheckoutForm(validMinimum) {
  return `
    <form id="checkoutForm" novalidate>
      <div class="section-title compact"><div><span>Checkout</span><h2>Confirm details</h2></div></div>
      <label class="field">Name<input name="name" value="${state.user.name || ""}" required />${error("name")}</label>
      <label class="field">Email<input name="email" type="email" value="${state.user.email || ""}" required />${error("email")}</label>
      <label class="field">Phone<input name="phone" value="${state.user.phone || ""}" required />${error("phone")}</label>
      ${state.fulfillment === "delivery" ? `<label class="field">Address<input name="address" value="${customerAddress()}" required />${error("address")}</label>` : ""}
      <div class="stripe-card disabled-payment"><span>Payment</span><b>Pay at restaurant for MVP</b><small>Online payments will be connected later.</small></div>
      <label class="field">Notes<textarea name="notes" placeholder="No onions, sauce on the side..."></textarea></label>
      <label class="notify-line"><input type="checkbox" checked disabled /> Automatic email confirmation enabled</label>
      <button class="primary-action full" type="submit" ${cart().length && validMinimum && !state.submitting ? "" : "disabled"}>${state.submitting ? "Submitting..." : `Place order · ${money(total())}`}</button>
    </form>
  `;
}

function error(name) {
  return state.formErrors[name] ? `<small class="field-error">${state.formErrors[name]}</small>` : "";
}

function renderEmptyCart() {
  return `<div class="empty-state dark empty-cart"><strong>Your cart is empty</strong><span>Add a dish from the menu to start checkout.</span><button class="secondary-action" data-scroll-menu>Browse menu</button></div>`;
}

function renderTotals() {
  return `
    <div class="premium-totals" data-totals>
      ${renderTotalsContent()}
    </div>
  `;
}

function renderFeeNoteContent() {
  if (state.fulfillment === "delivery") {
    const quote = deliveryQuote();
    return `<span>Delivery fee</span><strong>${money(quote.fee)}</strong><small>Calculated from your address: ${quote.area}</small>`;
  }
  return `<span>Pickup</span><strong>No delivery fee</strong><small>${pickupSchedule().day} at ${pickupSchedule().time}</small>`;
}

function renderTotalsContent() {
  return `
      <div><span>Subtotal</span><strong>${money(subtotal())}</strong></div>
      <div><span>Delivery</span><strong>${money(deliveryQuote().fee)}</strong></div>
      <div class="grand"><span>Total</span><strong>${money(total())}</strong></div>
  `;
}

function renderConfirmation() {
  const lastOrder = state.lastConfirmation;
  const history = read("orders").filter((order) => !state.user || order.email === state.user.email).slice(0, 4);
  return `
    <section class="premium-section" id="confirmation">
      <div class="section-title"><div><span>Confirmation</span><h2>${lastOrder ? `Order ${lastOrder.id}` : "No order yet"}</h2></div></div>
      <div class="confirmation-card ${lastOrder ? "success" : ""}">
        <div class="success-check">OK</div>
        <div>
          <h3>${lastOrder ? "Order automatically confirmed" : "Orders appear here after checkout"}</h3>
          <p>${lastOrder ? `Your order is confirmed. The restaurant can now mark it as preparing, ready, or completed.` : "Order status updates appear here after checkout."}</p>
        </div>
      </div>
      <div class="history-grid">
        ${history.length ? history.map((order) => `<article><span>${order.id}</span><strong>${order.items}</strong><small>${order.status} · ${money(order.total)}</small></article>`).join("") : `<div class="empty-state dark">Order history appears here after checkout.</div>`}
      </div>
    </section>
  `;
}

function renderProductModal() {
  const product = state.selectedProduct;
  return `
    <div class="modal-backdrop" data-close-modal>
      <section class="product-modal" role="dialog" aria-modal="true" aria-label="${product.name}">
        <button class="modal-close" data-close-modal>×</button>
        <img src="${product.image}" alt="${product.name}" />
        <div class="modal-body">
          <span class="live-badge">${product.prep} min</span>
          <h2>${product.name}</h2>
          <p>${product.description}</p>
          <div class="ingredients"><strong>Ingredients</strong><span>${product.ingredients || product.description}</span></div>
          <div class="ingredients"><strong>Allergens</strong><span>${product.allergens || "Ask the restaurant for allergen details."}</span></div>
          <label class="field">Base customization<select data-custom-option>${product.options.map((option) => `<option>${option}</option>`).join("")}</select></label>
          <div class="choice-grid"><h3>Extras</h3>${extras.map((extra) => `<label><input type="checkbox" value="${extra.id}" data-extra /> ${extra.name} <span>${money(extra.price)}</span></label>`).join("")}</div>
          <div class="choice-grid"><h3>Sauces</h3>${sauces.map((sauce) => `<label><input type="radio" name="sauce" value="${sauce.id}" ${sauce.id === "tzatziki" ? "checked" : ""} data-sauce /> ${sauce.name} <span>${sauce.price ? money(sauce.price) : "Free"}</span></label>`).join("")}</div>
          <label class="field">Special instructions<textarea data-item-notes placeholder="No onions, sauce on the side..."></textarea></label>
          <div class="modal-quantity"><button data-modal-dec>-</button><strong>${product.quantity || 1}</strong><button data-modal-inc>+</button></div>
          <button class="primary-action full" data-action="add-customized">Add to cart · ${money(product.price * Number(product.quantity || 1))}</button>
        </div>
      </section>
    </div>
  `;
}

function renderAuthModal() {
  return `
    <div class="modal-backdrop" data-close-auth>
      <form class="auth-modal" id="authForm">
        <button class="modal-close" type="button" data-close-auth>×</button>
        <span class="live-badge">Account</span><h2>${state.authMode === "login" ? "Log in" : "Create account"}</h2>
        <div class="auth-tabs">
          <button type="button" class="${state.authMode === "signup" ? "active" : ""}" data-auth-mode="signup">Sign up</button>
          <button type="button" class="${state.authMode === "login" ? "active" : ""}" data-auth-mode="login">Log in</button>
        </div>
        <button class="google-button" type="button" disabled>Continue with Google</button>
        <small class="helper-copy">Google login is prepared but not connected yet.</small>
        <label class="field">Name<input name="name" value="${state.user?.name || ""}" ${state.authMode === "signup" ? "required" : ""} />${accountError("name")}</label>
        <label class="field">Email<input name="email" type="email" value="${state.user?.email || ""}" required />${accountError("email")}</label>
        <label class="field">Phone<input name="phone" value="${state.user?.phone || ""}" ${state.authMode === "signup" ? "required" : ""} />${accountError("phone")}</label>
        <button class="primary-action full" type="submit">${state.authMode === "login" ? "Log in" : "Create account"}</button>
      </form>
    </div>
  `;
}

function accountError(name) {
  return state.accountErrors[name] ? `<small class="field-error">${state.accountErrors[name]}</small>` : "";
}

function renderAddressConfirmation() {
  const address = state.pendingForm?.address || customerAddress();
  return `
    <div class="modal-backdrop">
      <section class="auth-modal address-confirm">
        <span class="live-badge">Delivery address</span>
        <h2>${copy.confirmAddress}</h2>
        <p>${sanitize(address)}</p>
        <div class="confirmation-actions">
          <button class="secondary-action" data-action="edit-address">Edit address</button>
          <button class="primary-action" data-action="confirm-address">Confirm and place order</button>
        </div>
      </section>
    </div>
  `;
}

function renderCookieConsent() {
  return `
    <div class="modal-backdrop blocking-modal">
      <section class="auth-modal consent-card">
        <span class="live-badge">Privacy</span>
        <h2>We use cookies to run ordering</h2>
        <p>Cookies keep your cart, account, and order preferences on this device for the MVP.</p>
        <button class="primary-action full" data-action="accept-cookies">Accept cookies</button>
      </section>
    </div>
  `;
}

function renderLocationPrompt() {
  return `
    <div class="modal-backdrop blocking-modal">
      <section class="auth-modal consent-card">
        <span class="live-badge">Location</span>
        <h2>Use your location?</h2>
        <p>We can save an approximate location to help with delivery later. You can continue manually.</p>
        <div class="confirmation-actions">
          <button class="secondary-action" data-action="skip-location">Enter manually</button>
          <button class="primary-action" data-action="allow-location">Use my location</button>
        </div>
      </section>
    </div>
  `;
}

function showToast(message) {
  state.toast = message;
  const host = app.querySelector(".toast-host");
  if (host) host.innerHTML = `<div class="toast">${message}</div>`;
  setTimeout(() => {
    state.toast = "";
    const currentHost = app.querySelector(".toast-host");
    if (currentHost) currentHost.innerHTML = "";
  }, 2200);
}

function addCustomizedProduct() {
  const product = state.selectedProduct;
  const selectedExtras = [...document.querySelectorAll("[data-extra]:checked")].map((input) => extras.find((extra) => extra.id === input.value));
  const selectedSauce = sauces.find((sauce) => sauce.id === document.querySelector("[data-sauce]:checked")?.value) || sauces[0];
  const option = document.querySelector("[data-custom-option]")?.value || product.options[0];
  const notes = sanitize(document.querySelector("[data-item-notes]")?.value);
  const quantity = Number(product.quantity || 1);
  const lineTotal = product.price + selectedSauce.price + selectedExtras.reduce((sum, extra) => sum + extra.price, 0);
  write("cart", [{
    cartId: uid("cart"),
    productId: product.id,
    name: product.name,
    quantity,
    lineTotal,
    summary: [option, selectedSauce.name, ...selectedExtras.map((extra) => extra.name), notes].filter(Boolean).join(" · "),
  }, ...cart()]);
  state.selectedProduct = null;
  render();
  showToast("Added to cart");
}

function validateAccount(formData) {
  const errors = {};
  if (state.authMode === "signup" && !required(formData.get("name"))) errors.name = "Name is required";
  if (!email(formData.get("email"))) errors.email = "Enter a valid email";
  if (state.authMode === "signup" && !required(formData.get("phone"))) errors.phone = "Phone is required";
  state.accountErrors = errors;
  return !Object.keys(errors).length;
}

function checkoutPayload(form) {
  const formData = new FormData(form);
  return {
    name: sanitize(formData.get("name")),
    email: sanitize(formData.get("email")),
    phone: sanitize(formData.get("phone")),
    address: state.fulfillment === "delivery" ? sanitize(formData.get("address")) : "",
    notes: sanitize(formData.get("notes")),
  };
}

function validateOrderForm(form) {
  const formData = new FormData(form);
  const errors = validateCheckout(formData, state.fulfillment);
  state.formErrors = errors;
  return !Object.keys(errors).length;
}

async function placeOrder(details) {
  state.submitting = true;
  state.addressConfirmOpen = false;
  render();

  if (state.fulfillment === "delivery") write("deliveryAddress", details.address);
  const quote = deliveryQuote(details.address);
  const order = {
    id: `GK-${Math.floor(1300 + Math.random() * 700)}`,
    restaurantId: "giros-king",
    customer: details.name,
    email: details.email,
    phone: details.phone,
    status: "Confirmed",
    fulfillment: state.fulfillment === "delivery" ? "Delivery" : "Pickup",
    zone: state.fulfillment === "delivery" ? quote.area : "Pickup counter",
    address: details.address,
    pickupSchedule: state.fulfillment === "pickup" ? pickupSchedule() : null,
    notes: details.notes,
    paymentMethod: "Pay at restaurant",
    total: Math.max(0, subtotal() + quote.fee),
    subtotal: subtotal(),
    deliveryFee: quote.fee,
    discount: 0,
    items: cart().map((item) => `${item.quantity}x ${item.name}${item.summary ? ` (${item.summary})` : ""}`).join(", "),
    orderItems: cart().map((item) => ({
      productId: item.productId,
      name: item.name,
      quantity: item.quantity,
      unitPrice: item.lineTotal,
      lineTotal: item.lineTotal * item.quantity,
      options: item.summary,
    })),
    createdAt: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    confirmedAt: new Date().toISOString(),
  };

  let persistedOrder = order;
  try {
    const result = await createOrder(order);
    persistedOrder = { ...result.order, status: "Confirmed" };
  } catch {
    showToast("Order saved locally. Email service unavailable.");
  }

  write("orders", [persistedOrder, ...read("orders")]);
  write("lastOrder", persistedOrder);
  write("cart", []);
  state.lastConfirmation = persistedOrder;
  state.submitting = false;
  state.pendingForm = null;
  state.formErrors = {};
  render();
  showToast("Order confirmed");
  setTimeout(() => document.querySelector("#confirmation")?.scrollIntoView({ behavior: "smooth" }), 50);
}

app.addEventListener("click", (event) => {
  const productButton = event.target.closest("[data-product]");
  const action = event.target.closest("[data-action]")?.dataset.action;
  const categoryButton = event.target.closest("[data-category]");
  const dec = event.target.closest("[data-dec]");
  const inc = event.target.closest("[data-inc]");
  const authMode = event.target.closest("[data-auth-mode]")?.dataset.authMode;
  const startMode = event.target.closest("[data-start-mode]")?.dataset.startMode;

  if (productButton) {
    const product = activeProducts().find((item) => item.id === productButton.dataset.product);
    if (product) state.selectedProduct = { ...product, quantity: 1 };
    render();
  }
  if (categoryButton) {
    state.category = categoryButton.dataset.category;
    render();
  }
  if (dec || inc) {
    const id = (dec || inc).dataset.dec || (dec || inc).dataset.inc;
    write("cart", cart().flatMap((item) => item.cartId !== id ? item : item.quantity + (inc ? 1 : -1) > 0 ? [{ ...item, quantity: item.quantity + (inc ? 1 : -1) }] : []));
    render();
  }
  if (event.target.closest("[data-modal-dec]") && state.selectedProduct) {
    state.selectedProduct.quantity = Math.max(1, Number(state.selectedProduct.quantity || 1) - 1);
    render();
  }
  if (event.target.closest("[data-modal-inc]") && state.selectedProduct) {
    state.selectedProduct.quantity = Number(state.selectedProduct.quantity || 1) + 1;
    render();
  }
  if (action === "add-customized") addCustomizedProduct();
  if (action === "clear-cart") {
    write("cart", []);
    render();
  }
  if (action === "auth") {
    state.authOpen = true;
    render();
  }
  if (authMode) {
    state.authMode = authMode;
    state.accountErrors = {};
    render();
  }
  if (action === "change-start") {
    state.fulfillment = "";
    write("fulfillmentChoice", "");
    render();
  }
  if (startMode) {
    const holder = app.querySelector("[data-start-details]");
    const template = app.querySelector(startMode === "delivery" ? "[data-delivery-template]" : "[data-pickup-template]");
    if (holder && template) holder.innerHTML = template.innerHTML;
  }
  if (action === "accept-cookies") {
    write("cookieConsent", true);
    state.locationPrompt = true;
    render();
  }
  if (action === "skip-location") {
    write("locationPreference", { allowed: false });
    state.locationPrompt = false;
    render();
  }
  if (action === "allow-location") requestLocation();
  if (action === "edit-address") {
    state.addressConfirmOpen = false;
    render();
    setTimeout(() => document.querySelector("#checkout")?.scrollIntoView({ behavior: "smooth" }), 50);
  }
  if (action === "confirm-address" && state.pendingForm) placeOrder(state.pendingForm);
  if (event.target.matches("[data-close-modal]")) {
    state.selectedProduct = null;
    render();
  }
  if (event.target.matches("[data-close-auth]")) {
    state.authOpen = false;
    render();
  }
  if (event.target.closest("[data-scroll-menu]")) document.querySelector("#menu")?.scrollIntoView({ behavior: "smooth" });
  if (event.target.closest("[data-scroll-cart]")) document.querySelector("#cart")?.scrollIntoView({ behavior: "smooth" });
});

app.addEventListener("input", (event) => {
  if (event.target.matches("[data-search]")) {
    state.query = event.target.value;
    updateProductGrid();
  }
  if (event.target.matches("#checkoutForm input[name='address']")) {
    write("deliveryAddress", sanitize(event.target.value));
    const feeNote = app.querySelector("[data-fee-note]");
    if (feeNote) feeNote.innerHTML = renderFeeNoteContent();
    const totals = app.querySelector("[data-totals]");
    if (totals) totals.innerHTML = renderTotalsContent();
  }
});

app.addEventListener("submit", (event) => {
  event.preventDefault();
  if (event.target.id === "deliveryStartForm") {
    const address = sanitize(new FormData(event.target).get("address"));
    if (!address) return showToast("Enter a delivery address");
    write("deliveryAddress", address);
    write("fulfillmentChoice", "delivery");
    state.fulfillment = "delivery";
    render();
  }
  if (event.target.id === "pickupStartForm") {
    const data = new FormData(event.target);
    write("pickupSchedule", { day: String(data.get("day")), time: String(data.get("time")) });
    write("fulfillmentChoice", "pickup");
    state.fulfillment = "pickup";
    render();
  }
  if (event.target.id === "authForm") {
    const formData = new FormData(event.target);
    if (!validateAccount(formData)) return render();
    const existing = read("session") || {};
    state.user = {
      name: sanitize(formData.get("name")) || existing.name || "Customer",
      email: sanitize(formData.get("email")),
      phone: sanitize(formData.get("phone")) || existing.phone || "",
    };
    write("session", state.user);
    state.authOpen = false;
    state.accountErrors = {};
    render();
    showToast("Account saved");
  }
  if (event.target.id === "checkoutForm") {
    if (!state.user) {
      state.authOpen = true;
      render();
      return;
    }
    if (!validateOrderForm(event.target)) {
      render();
      showToast("Please check the highlighted fields");
      return;
    }
    const details = checkoutPayload(event.target);
    if (state.fulfillment === "delivery") {
      state.pendingForm = details;
      state.addressConfirmOpen = true;
      render();
      return;
    }
    placeOrder(details);
  }
});

function requestLocation() {
  if (!navigator.geolocation) {
    write("locationPreference", { allowed: false, reason: "unavailable" });
    state.locationPrompt = false;
    render();
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (position) => {
      write("locationPreference", {
        allowed: true,
        lat: Number(position.coords.latitude.toFixed(3)),
        lng: Number(position.coords.longitude.toFixed(3)),
      });
      state.locationPrompt = false;
      render();
    },
    () => {
      write("locationPreference", { allowed: false });
      state.locationPrompt = false;
      render();
    },
    { enableHighAccuracy: false, maximumAge: 600000, timeout: 5000 },
  );
}

getSupabaseStatus().then((status) => {
  console.info(`[Giros King] ${status.mode}`);
});

render();
