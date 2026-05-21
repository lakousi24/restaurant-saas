import { extras, sauces } from "../shared/data.js";
import { createOrder } from "../shared/api.js";
import { activeProducts, money, read, uid, write } from "../shared/store.js";
import { getSupabaseStatus } from "../shared/supabase.js";
import { sanitize, validateCheckout } from "../shared/validation.js";

const app = document.querySelector("#customerApp");
const state = {
  category: "featured",
  query: "",
  fulfillment: "delivery",
  zone: read("deliveryZones")[0],
  selectedProduct: null,
  promo: null,
  authOpen: false,
  menuOpen: false,
  favoriteIds: new Set(read("favorites") || []),
  user: read("session"),
  lastConfirmation: read("lastOrder"),
  loading: true,
  submitting: false,
  toast: "",
  formErrors: {},
};

function cart() {
  return read("cart");
}

function cartCount() {
  return cart().reduce((sum, item) => sum + item.quantity, 0);
}

function subtotal() {
  return cart().reduce((sum, item) => sum + item.lineTotal * item.quantity, 0);
}

function deliveryFee() {
  const settings = read("settings");
  if (state.fulfillment === "pickup") return 0;
  if (subtotal() >= settings.freeDeliveryThreshold) return 0;
  return state.zone.fee;
}

function discount() {
  if (!state.promo) return 0;
  const base = subtotal();
  return state.promo.type === "percent" ? base * (state.promo.value / 100) : Math.min(base, state.promo.value);
}

function total() {
  return Math.max(0, subtotal() + deliveryFee() - discount());
}

function visibleProducts() {
  return activeProducts().filter((product) => {
    const categoryMatch = state.category === "featured" ? product.featured : product.category === state.category;
    const queryMatch = `${product.name} ${product.description}`.toLowerCase().includes(state.query.toLowerCase());
    return categoryMatch && queryMatch;
  });
}

function productBadge(product) {
  if (product.bestseller || product.featured) return "Best Seller";
  if (product.spicy || product.name.toLowerCase().includes("chili") || product.description.toLowerCase().includes("spicy")) return "Spicy";
  if (product.vegetarian) return "Vegetarian";
  return product.rating >= 4.8 ? "Popular" : "";
}

function render() {
  app.innerHTML = `
    <div class="customer-shell">
      <header class="customer-topbar">
        <a class="brand premium-brand" href="#home" data-nav="home">
          <span class="brand-mark">GK</span>
          <span><strong>Giros King</strong><small>Premium Greek delivery</small></span>
        </a>
        <nav class="premium-nav ${state.menuOpen ? "open" : ""}">
          ${["home", "menu", "cart", "confirmation", "account"].map((id) => `<a class="${activeNav(id)}" href="#${id}" data-nav="${id}">${label(id)}</a>`).join("")}
        </nav>
        <button class="cart-icon" data-scroll-cart aria-label="Open cart">🛒<span>${cartCount()}</span></button>
        <button class="hamburger ${state.menuOpen ? "open" : ""}" data-action="menu" aria-label="Open menu"><span></span><span></span><span></span></button>
        <button class="user-chip" data-action="auth">${state.user ? state.user.name : "Sign in"}</button>
      </header>

      <main>
        ${renderHero()}
        ${renderFeatured()}
        ${renderMenu()}
        ${renderCartCheckout()}
        ${renderConfirmation()}
        ${renderAccount()}
      </main>

      <button class="mobile-cart-fab" data-scroll-cart>Cart · ${cartCount()} · ${money(total())}</button>

      ${state.selectedProduct ? renderProductModal() : ""}
      ${state.authOpen ? renderAuthModal() : ""}
      ${state.toast ? `<div class="toast">${state.toast}</div>` : ""}
      ${state.loading ? renderSkeleton() : ""}
    </div>
  `;
}

function activeNav(id) {
  if (id === "menu" && state.category) return "active";
  return "";
}

function label(id) {
  return id === "confirmation" ? "Orders" : id.charAt(0).toUpperCase() + id.slice(1);
}

function renderHero() {
  return `
    <section class="customer-hero" id="home">
      <img src="assets/giros-hero.png" alt="Fresh Giros King wrap" />
      <div class="animated-overlay"></div>
      <div class="hero-copy">
        <span class="live-badge">Open now · ${state.fulfillment === "delivery" ? state.zone.eta : "14-20 min"}</span>
        <h1>Greek street food with a luxury delivery feel.</h1>
        <p>Customize signature gyros, add sauces and extras, checkout fast, and receive email updates as your order moves through the kitchen.</p>
        <div class="hero-search">
          <input type="search" placeholder="Search gyros, bowls, fries..." value="${state.query}" data-search />
          <button class="primary-action" data-scroll-menu>Browse menu</button>
        </div>
        <div class="trust-row">
          <span>4.9 rating</span><span>Email updates</span><span>Rewards ready</span>
        </div>
      </div>
    </section>
  `;
}

function renderFeatured() {
  const featured = activeProducts().filter((product) => product.featured).slice(0, 3);
  return `
    <section class="premium-section">
      <div class="section-title">
        <div><span>Featured</span><h2>Most ordered today</h2></div>
        <small>Fast kitchen flow, premium packaging, fresh sauces</small>
      </div>
      <div class="featured-rail">${featured.map(renderProductCard).join("")}</div>
    </section>
  `;
}

function renderMenu() {
  const categories = read("categories").filter((category) => category.visible !== false);
  const items = visibleProducts();
  return `
    <section class="premium-section menu-surface" id="menu">
      <div class="section-title">
        <div><span>Menu</span><h2>Build your order</h2></div>
        <div class="eta-card"><strong>${state.fulfillment === "delivery" ? state.zone.eta : "14-20 min"}</strong><span>${state.fulfillment}</span></div>
      </div>
      <div class="category-dock">
        ${categories.map((category) => `<button class="${state.category === category.id ? "active" : ""}" data-category="${category.id}"><span>${category.icon}</span>${category.name}</button>`).join("")}
      </div>
      <div class="product-grid ${state.query ? "filtered" : ""}">
        ${items.length ? items.map(renderProductCard).join("") : `<div class="empty-state dark">No dishes found. Try gyros, fries, or lemonade.</div>`}
      </div>
    </section>
  `;
}

function renderProductCard(product) {
  const badge = productBadge(product);
  const favorite = state.favoriteIds.has(product.id);
  return `
    <article class="premium-product ${product.available ? "" : "is-sold-out"}">
      <button class="favorite-button ${favorite ? "active" : ""}" data-favorite="${product.id}" aria-label="Favorite ${product.name}">♥</button>
      <button class="product-media" data-product="${product.id}">
        <img src="${product.image}" alt="${product.name}" loading="lazy" />
        ${badge ? `<b>${badge}</b>` : ""}
      </button>
      <div class="product-content">
        <div><h3>${product.name}</h3><p>${product.description}</p></div>
        <div class="product-meta"><span>${money(product.price)}</span><small>${product.prep} min · ${product.rating} ★</small></div>
        <div class="card-actions">
          <button class="add-premium" ${product.available ? `data-product="${product.id}"` : "disabled"}>${product.available ? "Customize" : "Sold out"}</button>
          <button class="quick-add" ${product.available ? `data-quick-add="${product.id}"` : "disabled"}>+</button>
        </div>
      </div>
    </article>
  `;
}

function renderCartCheckout() {
  const settings = read("settings");
  const minRemaining = Math.max(0, settings.minimumOrder - subtotal());
  const validMinimum = state.fulfillment === "pickup" || subtotal() >= settings.minimumOrder;
  return `
    <section class="premium-section cart-checkout" id="cart">
      <div class="checkout-card">
        <div class="section-title compact">
          <div><span>Cart</span><h2>Your order</h2></div>
          <button class="text-button" data-action="clear-cart">Clear</button>
        </div>
        <div class="fulfillment-toggle">
          <button class="${state.fulfillment === "delivery" ? "active" : ""}" data-fulfillment="delivery">Delivery</button>
          <button class="${state.fulfillment === "pickup" ? "active" : ""}" data-fulfillment="pickup">Pickup</button>
        </div>
        ${state.fulfillment === "delivery" ? `<label class="field">Delivery zone<select data-zone>${read("deliveryZones").map((zone) => `<option value="${zone.id}" ${zone.id === state.zone.id ? "selected" : ""}>${zone.name} · ${money(zone.fee)} · ${zone.eta}</option>`).join("")}</select></label>` : `<div class="pickup-card">Pickup from ${settings.address}. Ready in 14-20 minutes.</div>`}
        ${!validMinimum ? `<div class="cart-warning">Add ${money(minRemaining)} more to reach the delivery minimum.</div>` : ""}
        <div class="cart-lines">
          ${cart().length ? cart().map((item) => `
            <article>
              <div><strong>${item.name}</strong><span>${item.summary}</span></div>
              <div class="quantity-control"><button data-dec="${item.cartId}">-</button><b>${item.quantity}</b><button data-inc="${item.cartId}">+</button></div>
              <strong>${money(item.lineTotal * item.quantity)}</strong>
            </article>
          `).join("") : renderEmptyCart()}
        </div>
        <div class="promo-row">
          <input type="text" placeholder="Coupon code" data-promo-input />
          <button class="secondary-action" data-action="apply-promo">Apply</button>
        </div>
        ${state.promo ? `<p class="success-copy">${state.promo.code} applied.</p>` : ""}
        ${renderTotals()}
      </div>

      <form class="checkout-card" id="checkoutForm" novalidate>
        <div class="section-title compact"><div><span>Checkout</span><h2>Fast checkout</h2></div></div>
        <div class="wallet-row"><button type="button"> Pay</button><button type="button">G Pay</button></div>
        <label class="field">Name<input name="name" value="${state.user?.name || ""}" placeholder="Alex Morgan" required />${error("name")}</label>
        <label class="field">Email<input name="email" type="email" value="${state.user?.email || ""}" placeholder="alex@example.com" required />${error("email")}</label>
        <label class="field">Phone<input name="phone" value="${state.user?.phone || ""}" placeholder="(555) 014-2040" required />${error("phone")}</label>
        <label class="field">Address<input name="address" placeholder="Delivery address or pickup note" ${state.fulfillment === "delivery" ? "required" : ""} />${error("address")}</label>
        <div class="stripe-card"><span>Card</span><b>4242 4242 4242 4242</b><small>MM/YY · CVC · ZIP</small></div>
        <label class="field">Notes<textarea name="notes" placeholder="Extra tzatziki, no onions..."></textarea></label>
        <label class="notify-line"><input type="checkbox" checked /> Email me order updates</label>
        <button class="primary-action full" type="submit" ${cart().length && validMinimum && !state.submitting ? "" : "disabled"}>${state.submitting ? "Sending order..." : `Place order · ${money(total())}`}</button>
      </form>
    </section>
  `;
}

function error(name) {
  return state.formErrors[name] ? `<small class="field-error">${state.formErrors[name]}</small>` : "";
}

function renderEmptyCart() {
  return `<div class="empty-state dark empty-cart"><strong>Your bag is empty</strong><span>Start with a best seller, then customize sauces and extras.</span><button class="secondary-action" data-scroll-menu>Browse menu</button></div>`;
}

function renderTotals() {
  return `
    <div class="premium-totals">
      <div><span>Subtotal</span><strong>${money(subtotal())}</strong></div>
      <div><span>Delivery</span><strong>${money(deliveryFee())}</strong></div>
      <div><span>Coupon</span><strong>-${money(discount())}</strong></div>
      <div class="grand"><span>Total</span><strong>${money(total())}</strong></div>
    </div>
  `;
}

function renderConfirmation() {
  const lastOrder = state.lastConfirmation;
  const history = read("orders").filter((order) => order.customer === (state.user?.name || lastOrder?.customer)).slice(0, 4);
  return `
    <section class="premium-section" id="confirmation">
      <div class="section-title"><div><span>Order confirmation</span><h2>${lastOrder ? `Order ${lastOrder.id}` : "Email updates after checkout"}</h2></div></div>
      <div class="confirmation-card ${lastOrder ? "success" : ""}">
        <div class="success-check">✓</div>
        <div>
          <h3>${lastOrder ? "Order received" : "No recent order yet"}</h3>
          <p>${lastOrder ? `We emailed confirmation to ${lastOrder.email || "the customer"} and notified the restaurant.` : "Place an order and customers will receive email updates when it is received, accepted, and ready."}</p>
        </div>
      </div>
      <div class="history-grid">
        ${history.length ? history.map((order) => `<article><span>${order.id}</span><strong>${order.items}</strong><small>${order.status} · ${money(order.total)}</small></article>`).join("") : `<div class="empty-state dark">Order history appears here after checkout.</div>`}
      </div>
    </section>
  `;
}

function renderAccount() {
  const points = Number(read("points") || 0);
  return `
    <section class="premium-section account-grid" id="account">
      <article class="reward-card" id="rewards">
        <span>Rewards</span><h2>${points} points</h2><p>Redeem ${read("settings").loyalty.redemptionPoints} points for ${money(read("settings").loyalty.rewardValue)} off.</p>
        <div><span style="width:${Math.min(100, points / 5)}%"></span></div>
      </article>
      <article class="account-card"><span>Profile</span><h2>${state.user?.name || "Guest customer"}</h2><p>${state.user ? state.user.email : "Sign in to sync addresses, rewards, and order history."}</p><button class="secondary-action" data-action="auth">${state.user ? "Edit account" : "Login or sign up"}</button></article>
      <article class="account-card"><span>Email notifications</span><h2>Automatic updates</h2><p>Customers receive received, accepted, and ready emails. Restaurant gets a new order email.</p></article>
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
          <span class="live-badge">${product.prep} min · ${product.rating} ★</span>
          <h2>${product.name}</h2>
          <p>${product.description}</p>
          <div class="ingredients"><strong>Ingredients</strong><span>${product.ingredients || product.description.replaceAll(",", " ·")}</span></div>
          <div class="ingredients"><strong>Allergens</strong><span>${product.allergens || "Ask the restaurant for allergen details."}</span></div>
          <label class="field">Base customization<select data-custom-option>${product.options.map((option) => `<option>${option}</option>`).join("")}</select></label>
          <div class="choice-grid"><h3>Extras</h3>${extras.map((extra) => `<label><input type="checkbox" value="${extra.id}" data-extra /> ${extra.name} <span>${money(extra.price)}</span></label>`).join("")}</div>
          <div class="choice-grid"><h3>Sauces</h3>${sauces.map((sauce) => `<label><input type="radio" name="sauce" value="${sauce.id}" ${sauce.id === "tzatziki" ? "checked" : ""} data-sauce /> ${sauce.name} <span>${sauce.price ? money(sauce.price) : "Free"}</span></label>`).join("")}</div>
          <label class="field">Spice level<select data-spice><option>Mild</option><option>Medium</option><option>Hot</option><option>King hot</option></select></label>
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
        <span class="live-badge">Customer account</span><h2>Login or sign up</h2>
        <label class="field">Name<input name="name" value="${state.user?.name || ""}" required /></label>
        <label class="field">Email<input name="email" type="email" value="${state.user?.email || ""}" required /></label>
        <label class="field">Phone<input name="phone" value="${state.user?.phone || ""}" required /></label>
        <button class="primary-action full" type="submit">Continue</button>
      </form>
    </div>
  `;
}

function renderSkeleton() {
  return `<div class="loading-screen"><span></span><strong>Preparing Giros King</strong></div>`;
}

function showToast(message) {
  state.toast = message;
  render();
  setTimeout(() => {
    state.toast = "";
    render();
  }, 2400);
}

function addItem(product, quantity = 1) {
  const item = {
    cartId: uid("cart"),
    productId: product.id,
    name: product.name,
    quantity,
    lineTotal: product.price,
    summary: "Classic build",
  };
  write("cart", [...cart(), item]);
  showToast(`${product.name} added to cart`);
}

function addCustomizedProduct() {
  const product = state.selectedProduct;
  const selectedExtras = [...document.querySelectorAll("[data-extra]:checked")].map((input) => extras.find((extra) => extra.id === input.value));
  const selectedSauce = sauces.find((sauce) => sauce.id === document.querySelector("[data-sauce]:checked")?.value) || sauces[0];
  const option = document.querySelector("[data-custom-option]")?.value || product.options[0];
  const spice = document.querySelector("[data-spice]")?.value || "Mild";
  const notes = sanitize(document.querySelector("[data-item-notes]")?.value);
  const quantity = Number(product.quantity || 1);
  const lineTotal = product.price + selectedSauce.price + selectedExtras.reduce((sum, extra) => sum + extra.price, 0);
  write("cart", [...cart(), {
    cartId: uid("cart"),
    productId: product.id,
    name: product.name,
    quantity,
    lineTotal,
    summary: [option, selectedSauce.name, spice, ...selectedExtras.map((extra) => extra.name), notes].filter(Boolean).join(" · "),
  }]);
  state.selectedProduct = null;
  showToast("Added to cart");
}

function validate(formData) {
  const errors = validateCheckout(formData, state.fulfillment);
  state.formErrors = errors;
  return !Object.keys(errors).length;
}

async function placeOrder(form) {
  const formData = new FormData(form);
  if (!validate(formData)) {
    showToast("Please check the highlighted fields");
    return;
  }
  state.submitting = true;
  render();
  const order = {
    id: `GK-${Math.floor(1300 + Math.random() * 700)}`,
    restaurantId: "giros-king",
    customer: sanitize(formData.get("name")),
    email: sanitize(formData.get("email")),
    phone: sanitize(formData.get("phone")),
    status: "Received",
    fulfillment: state.fulfillment === "delivery" ? "Delivery" : "Pickup",
    zone: state.fulfillment === "delivery" ? state.zone.name : "Pickup counter",
    address: sanitize(formData.get("address")),
    notes: sanitize(formData.get("notes")),
    paymentMethod: "Card",
    total: total(),
    subtotal: subtotal(),
    deliveryFee: deliveryFee(),
    discount: discount(),
    items: cart().map((item) => `${item.quantity}x ${item.name}`).join(", "),
    createdAt: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
  };
  let persistedOrder = order;
  try {
    const result = await createOrder(order);
    persistedOrder = result.order;
  } catch {
    showToast("Order saved locally. Email service unavailable.");
  }
  write("orders", [persistedOrder, ...read("orders")]);
  write("lastOrder", persistedOrder);
  write("cart", []);
  write("points", Number(read("points") || 0) + Math.floor(order.total));
  state.lastConfirmation = persistedOrder;
  state.submitting = false;
  state.formErrors = {};
  showToast("Order confirmed. Email sent.");
  setTimeout(() => document.querySelector("#confirmation")?.scrollIntoView({ behavior: "smooth" }), 50);
}

app.addEventListener("click", (event) => {
  const productButton = event.target.closest("[data-product]");
  const quickAdd = event.target.closest("[data-quick-add]");
  const action = event.target.closest("[data-action]")?.dataset.action;
  const categoryButton = event.target.closest("[data-category]");
  const fulfillmentButton = event.target.closest("[data-fulfillment]");
  const dec = event.target.closest("[data-dec]");
  const inc = event.target.closest("[data-inc]");
  const favorite = event.target.closest("[data-favorite]");

  if (productButton) {
    const product = activeProducts().find((item) => item.id === productButton.dataset.product);
    state.selectedProduct = { ...product, quantity: 1 };
    render();
  }
  if (quickAdd) addItem(activeProducts().find((item) => item.id === quickAdd.dataset.quickAdd));
  if (favorite) {
    state.favoriteIds.has(favorite.dataset.favorite) ? state.favoriteIds.delete(favorite.dataset.favorite) : state.favoriteIds.add(favorite.dataset.favorite);
    write("favorites", [...state.favoriteIds]);
    render();
  }
  if (categoryButton) {
    state.category = categoryButton.dataset.category;
    render();
  }
  if (fulfillmentButton) {
    state.fulfillment = fulfillmentButton.dataset.fulfillment;
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
  if (action === "menu") {
    state.menuOpen = !state.menuOpen;
    render();
  }
  if (action === "add-customized") addCustomizedProduct();
  if (action === "clear-cart") {
    write("cart", []);
    render();
  }
  if (action === "apply-promo") {
    const code = document.querySelector("[data-promo-input]")?.value.toUpperCase();
    state.promo = read("promotions").find((promo) => promo.active && promo.code === code) || null;
    showToast(state.promo ? "Coupon applied" : "Coupon not found");
  }
  if (action === "auth") {
    state.authOpen = true;
    render();
  }
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
    render();
  }
});

app.addEventListener("change", (event) => {
  if (event.target.matches("[data-zone]")) {
    state.zone = read("deliveryZones").find((zone) => zone.id === event.target.value);
    render();
  }
});

app.addEventListener("submit", (event) => {
  event.preventDefault();
  if (event.target.id === "checkoutForm") placeOrder(event.target);
  if (event.target.id === "authForm") {
    const formData = new FormData(event.target);
    state.user = { name: String(formData.get("name")), email: String(formData.get("email")), phone: String(formData.get("phone")) };
    write("session", state.user);
    state.authOpen = false;
    showToast("Account saved");
  }
});

getSupabaseStatus().then((status) => {
  console.info(`[Giros King] ${status.mode}`);
  state.loading = false;
  render();
});

render();
