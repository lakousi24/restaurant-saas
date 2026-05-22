import { createOrder } from "../shared/api.js";
import { currentUser, saveDemoUser, validateAccount } from "../shared/auth-service.js";
import { activeProducts, money, read, write } from "../shared/store.js";
import { createOrderFromCart, newCartItem, pickupSlots, quoteDelivery, saveOrder, todayISO } from "../shared/order-service.js";
import { getSupabaseStatus } from "../shared/supabase.js";
import { sanitize, validateCheckout } from "../shared/validation.js";

const app = document.querySelector("#customerApp");
const storeAddress = "Giros King, 24 Market Street";
const paymentMethods = ["Cash", "PayPal", "Apple Pay", "Card", "Klarna"];
const icons = {
  account: `<svg viewBox="0 0 24 24"><path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="8" r="4"/></svg>`,
  back: `<svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>`,
  cart: `<svg viewBox="0 0 24 24"><path d="M6 6h15l-2 8H8L6 3H3"/><circle cx="9" cy="20" r="1"/><circle cx="18" cy="20" r="1"/></svg>`,
  delivery: `<svg viewBox="0 0 24 24"><path d="M3 7h11v10H3z"/><path d="M14 10h4l3 3v4h-7z"/><circle cx="7" cy="19" r="2"/><circle cx="18" cy="19" r="2"/></svg>`,
  menu: `<svg viewBox="0 0 24 24"><path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/></svg>`,
  more: `<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>`,
  offers: `<svg viewBox="0 0 24 24"><path d="M20 12v8H4v-8"/><path d="M2 7h20v5H2z"/><path d="M12 22V7"/><path d="M12 7H8.5a2.5 2.5 0 1 1 2.2-3.7L12 7z"/><path d="M12 7h3.5a2.5 2.5 0 1 0-2.2-3.7L12 7z"/></svg>`,
  pickup: `<svg viewBox="0 0 24 24"><path d="M5 11h14l-1 10H6z"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/><path d="M3 11h18"/></svg>`,
};
const toppingOptions = [
  { id: "mozzarella", name: "Mozzarella", price: 0, included: true },
  { id: "tomato", name: "Tomato", price: 0, included: true },
  { id: "onion", name: "Red onion", price: 0, included: true },
  { id: "mushrooms", name: "Mushrooms", price: 1.2 },
  { id: "jalapeno", name: "Jalapeno", price: 1.0 },
  { id: "chicken", name: "Chicken", price: 2.5 },
];

const state = {
  page: "menu",
  category: "pizza",
  query: "",
  bannerIndex: 0,
  selectedProduct: null,
  productConfig: null,
  upsellOpen: false,
  selectedUpsells: new Set(),
  sheet: !read("cookieDecision") ? "cookies" : read("locationPreference") ? null : "location",
  startMode: "",
  authMode: "guest",
  accountErrors: {},
  checkoutErrors: {},
  minOrderOpen: false,
  addressConfirmOpen: false,
  pendingCheckout: null,
  toast: "",
  user: currentUser(),
  orderContext: read("orderContext"),
  voucherCode: "",
  appliedVoucher: read("appliedVoucher"),
  language: read("language") || "en",
};

const t = {
  en: { start: "Start Your Order", delivery: "Delivery", pickup: "Pickup", rewards: "Rewards Club", account: "Account", language: "Language" },
  de: { start: "Bestellung starten", delivery: "Lieferung", pickup: "Abholung", rewards: "Rewards Club", account: "Konto", language: "Sprache" },
};

function icon(name) {
  return `<span class="nav-icon" aria-hidden="true">${icons[name] || ""}</span>`;
}

function cart() {
  return read("cart");
}

function settings() {
  return read("settings");
}

function categories() {
  return read("categories").filter((category) => category.visible !== false);
}

function context() {
  return state.orderContext || read("orderContext");
}

function subtotal() {
  return cart().reduce((sum, item) => sum + Number(item.lineTotal || 0) * Number(item.quantity || 1), 0);
}

function delivery() {
  const ctx = context();
  return ctx?.type === "delivery" ? quoteDelivery(ctx.address, subtotal()) : { available: true, fee: 0, area: "Pickup", eta: "" };
}

function discount() {
  const voucher = state.appliedVoucher;
  if (!voucher) return 0;
  if (subtotal() < Number(voucher.minimumOrder || 0)) return 0;
  return voucher.type === "percent" ? subtotal() * (Number(voucher.value || 0) / 100) : Math.min(subtotal(), Number(voucher.value || 0));
}

function total() {
  return Math.max(0, subtotal() + delivery().fee - discount());
}

function cartCount() {
  return cart().reduce((sum, item) => sum + Number(item.quantity || 1), 0);
}

function products() {
  return activeProducts().filter((product) => {
    const categoryMatch = state.category === "offers" ? product.category === "offers" || product.featured : product.category === state.category;
    const queryMatch = `${product.name} ${product.description}`.toLowerCase().includes(state.query.toLowerCase());
    return categoryMatch && queryMatch;
  });
}

function render() {
  app.innerHTML = `
    <div class="customer-shell dominos-inspired">
      ${renderTopbar()}
      <main class="${context() ? "" : "menu-blurred"}">
        ${renderPage()}
      </main>
      ${renderBottomNav()}
      ${renderSheets()}
      <div class="toast-host">${state.toast ? `<div class="toast">${state.toast}</div>` : ""}</div>
    </div>
  `;
}

function renderTopbar() {
  const ctx = context();
  return `
    <header class="app-topbar">
      <button class="icon-button" data-action="start-over" aria-label="Back">${icon("back")}<span class="sr-only">Back</span></button>
      <div class="order-context">
        <strong>${ctx ? `${ctx.type === "delivery" ? "Delivery" : "Pickup"} ${ctx.time} ${ctx.date}` : "Giros King"}</strong>
        <span>${ctx ? (ctx.type === "delivery" ? ctx.address : storeAddress) : "Start your order"}</span>
      </div>
      <button class="icon-button account-fab" data-page="account" aria-label="Account">${icon("account")}<span class="sr-only">Account</span></button>
    </header>
  `;
}

function renderPage() {
  if (!context()) return renderMenuBackground();
  if (state.page === "cart") return renderCartPage();
  if (state.page === "offers") return renderOffersPage();
  if (state.page === "more") return renderMorePage();
  if (state.page === "account") return renderAccountPage();
  return renderMenuPage();
}

function renderMenuBackground() {
  return `<section class="menu-preview">${renderMenuPage()}</section>`;
}

function renderMenuPage() {
  return `
    <section class="menu-page">
      <div class="search-shell">
        <input type="search" placeholder="Search pizza, pasta, drinks..." value="${state.query}" data-search />
      </div>
      ${renderRecentSearches()}
      <nav class="category-tabs">
        ${categories().map((category) => `<button class="${state.category === category.id ? "active" : ""}" data-category="${category.id}">${category.name}</button>`).join("")}
      </nav>
      ${renderPromoCarousel()}
      <div class="product-grid" data-product-grid>${renderProductGrid()}</div>
    </section>
  `;
}

function renderPromoCarousel() {
  const banners = read("offerBanners");
  return `
    <section class="promo-carousel">
      ${banners.map((banner, index) => `
        <button class="promo-banner ${index === state.bannerIndex ? "active" : ""}" data-offer-product="${banner.productId}">
          <span>${banner.badge}</span>
          <strong>${banner.title}</strong>
          <small>${banner.subtitle}</small>
        </button>
      `).join("")}
      <div class="dots">${banners.map((_, index) => `<button class="${index === state.bannerIndex ? "active" : ""}" data-banner="${index}" aria-label="Show offer ${index + 1}"></button>`).join("")}</div>
    </section>
  `;
}

function renderProductGrid() {
  const list = products();
  return list.length ? list.map(renderProductCard).join("") : `<div class="empty-state clean">No products found.</div>`;
}

function renderRecentSearches() {
  const terms = read("recentSearches").map((term) => sanitize(term).replace(/["']/g, "").slice(0, 40)).filter(Boolean).slice(0, 4);
  if (!terms.length) return "";
  return `<div class="recent-searches"><span>Recent</span>${terms.map((term) => `<button data-recent-search="${term}">${term}</button>`).join("")}</div>`;
}

function renderProductCard(product) {
  const label = product.category === "offers" ? "Lunch Deal" : product.bestseller ? "Popular" : product.vegetarian ? "Vegan option" : product.spicy ? "New" : "";
  return `
    <article class="food-card">
      <button class="food-image" data-product="${product.id}">
        <img src="${product.image}" alt="${product.name}" loading="lazy" />
        ${label ? `<span>${label}</span>` : ""}
      </button>
      <div>
        <h3>${product.name}</h3>
        <p>${product.description}</p>
        <strong>${money(product.price)}</strong>
      </div>
    </article>
  `;
}

function renderCartPage() {
  const missing = Math.max(0, Number(settings().minimumOrder || 15) - subtotal());
  const canCheckout = context()?.type === "pickup" || missing <= 0;
  return `
    <section class="cart-page">
      <h1>Cart</h1>
      ${renderVoucherBox()}
      <div class="cart-lines">
        ${cart().length ? cart().map(renderCartItem).join("") : `<div class="empty-state clean">Your cart is empty.</div>`}
      </div>
      ${!canCheckout && cart().length ? `<div class="minimum-alert"><strong>Minimum order ${money(settings().minimumOrder)}</strong><span>Add ${money(missing)} more to continue.</span></div>` : ""}
      ${renderSuggestedAddons()}
      ${renderTotals()}
      <button class="sticky-checkout" data-action="checkout" ${cart().length ? "" : "disabled"}>Checkout · ${money(total())}</button>
    </section>
  `;
}

function renderCartItem(item) {
  return `
    <article class="cart-item">
      <div>
        <strong>${item.name}</strong>
        <span>${[item.size, item.base, item.sauce, ...(item.toppings || []).map((topping) => topping.name), item.notes].filter(Boolean).join(" · ")}</span>
      </div>
      <div class="quantity-control"><button data-dec="${item.cartId}">-</button><b>${item.quantity}</b><button data-inc="${item.cartId}">+</button></div>
      <strong>${money(item.lineTotal * item.quantity)}</strong>
    </article>
  `;
}

function renderVoucherBox() {
  const saved = read("savedVouchers");
  return `
    <section class="voucher-box">
      <label>Voucher code<input value="${state.voucherCode}" placeholder="Enter voucher" data-voucher-input /></label>
      <button class="secondary-action" data-action="apply-voucher">Apply voucher</button>
      ${state.appliedVoucher ? `<p>${state.appliedVoucher.code} applied: -${money(discount())}</p>` : ""}
      ${saved.length ? `<div class="saved-vouchers">${saved.map((voucher) => `<button data-saved-voucher="${voucher.id}">${voucher.code}</button>`).join("")}</div>` : ""}
    </section>
  `;
}

function renderSuggestedAddons() {
  return `
    <section class="suggested-addons">
      <h2>Suggested add ons</h2>
      <div>${read("upsellProducts").map((item) => `<button data-add-upsell="${item.id}"><img src="${item.image}" alt="" /><span>${item.name}</span><strong>${money(item.price)}</strong></button>`).join("")}</div>
    </section>
  `;
}

function renderTotals() {
  return `
    <section class="totals-card">
      <div><span>Subtotal</span><strong>${money(subtotal())}</strong></div>
      <div><span>Delivery fee</span><strong>${money(delivery().fee)}</strong></div>
      <div><span>Discount</span><strong>-${money(discount())}</strong></div>
      <div class="grand"><span>Total</span><strong>${money(total())}</strong></div>
    </section>
  `;
}

function renderOffersPage() {
  const promos = read("promotions").filter((promo) => promo.active);
  return `
    <section class="offers-page">
      <h1>Offers</h1>
      ${renderVoucherBox()}
      <h2>Available offers</h2>
      <div class="offer-list">${promos.map((promo) => `<article><strong>${promo.code}</strong><span>${promo.label || "Voucher"}</span><small>Minimum ${money(promo.minimumOrder || 0)} · expires ${promo.expiresAt || "not set"}</small><button data-save-voucher="${promo.id}">Save voucher</button></article>`).join("")}</div>
      <p class="helper-copy">Terms and conditions are available under More.</p>
    </section>
  `;
}

function renderMorePage() {
  return `
    <section class="more-page">
      <h1>More</h1>
      <button data-sheet="language">Language</button>
      <button data-sheet="cookie-settings">Cookie Settings</button>
      <article><strong>Terms & Conditions</strong><span>Prepared for legal content.</span></article>
      <article><strong>Privacy Policy</strong><span>Prepared for legal content.</span></article>
      <article><strong>Legal</strong><span>Giros King ordering MVP</span></article>
      <article><strong>Order IDs</strong><span>${read("orders").slice(0, 3).map((order) => order.id).join(", ") || "No orders yet"}</span></article>
      <article><strong>App version</strong><span>0.2 MVP</span></article>
    </section>
  `;
}

function renderAccountPage() {
  const orders = read("orders").filter((order) => !state.user || order.email === state.user.email).slice(0, 4);
  const addresses = [read("deliveryAddress")].filter(Boolean);
  return `
    <section class="account-page">
      <h1>Account</h1>
      ${state.user ? `<article class="account-card profile-card"><strong>${state.user.name}</strong><span>${state.user.email}</span><span>${state.user.phone}</span><button data-action="logout">Log out</button></article>` : `<button class="primary-action full" data-sheet="account">Login, sign up, or continue as guest</button>`}
      <section class="reward-card"><strong>Rewards Club</strong><span>${state.user?.rewards ? "Joined" : "Join during sign up"}</span></section>
      <section class="account-stack"><h2>Order history</h2>${orders.length ? orders.map((order) => `<article><strong>${order.id}</strong><span>${order.fulfillment} · ${order.status} · ${money(order.total)}</span></article>`).join("") : `<p>No orders yet.</p>`}</section>
      <section class="account-stack"><h2>Saved addresses</h2>${addresses.length ? addresses.map((address) => `<article><strong>Delivery</strong><span>${address}</span></article>`).join("") : `<p>No saved addresses yet.</p>`}</section>
      <section class="account-stack"><h2>Payment methods</h2><article><strong>Cash</strong><span>Active for MVP</span></article><article class="disabled-row"><strong>Card</strong><span>Coming soon</span></article></section>
      <section class="account-stack"><h2>Favorite orders</h2><p>Favorite orders will appear here after reorder support is connected.</p></section>
    </section>
  `;
}

function renderBottomNav() {
  const items = [
    ["account", "account", "Account"],
    ["more", "more", "More"],
    ["menu", "menu", "Menu"],
    ["offers", "offers", "Offers"],
    ["cart", "cart", "Cart"],
  ];
  return `
    <nav class="mobile-bottom-nav">
      ${items.map(([page, iconName, label]) => `<button class="${state.page === page ? "active" : ""}" data-page="${page}">${icon(iconName)}<span class="nav-label">${label}</span>${page === "cart" && cartCount() ? `<b>${cartCount()}</b>` : ""}</button>`).join("")}
    </nav>
  `;
}

function renderSheets() {
  return `
    ${state.sheet === "cookies" ? renderCookieSheet() : ""}
    ${state.sheet === "cookie-settings" ? renderCookieSettings() : ""}
    ${state.sheet === "location" ? renderLocationSheet() : ""}
    ${!context() && !state.sheet ? renderStartSheet() : ""}
    ${state.sheet === "delivery" ? renderDeliveryFlow() : ""}
    ${state.sheet === "pickup" ? renderPickupFlow() : ""}
    ${state.sheet === "address-confirm" ? renderAddressConfirm() : ""}
    ${state.sheet === "account" ? renderAccountSheet() : ""}
    ${state.sheet === "language" ? renderLanguageSheet() : ""}
    ${state.selectedProduct ? renderProductSheet() : ""}
    ${state.upsellOpen ? renderUpsellSheet() : ""}
    ${state.minOrderOpen ? renderMinimumSheet() : ""}
    ${state.addressConfirmOpen ? renderCheckoutAddressConfirm() : ""}
    ${state.sheet === "checkout" ? renderCheckoutSheet() : ""}
  `;
}

function sheet(content, extra = "") {
  return `<div class="sheet-backdrop ${extra}"><section class="bottom-sheet">${content}</section></div>`;
}

function renderCookieSheet() {
  return sheet(`
    <h2>We use cookies to improve your ordering experience.</h2>
    <p>Cookies store your cart, preferences, and local MVP session.</p>
    <button class="primary-action full" data-cookie-choice="all">Accept all</button>
    <button class="secondary-action full" data-sheet="cookie-settings">Manage settings</button>
    <button class="text-button full" data-cookie-choice="required">Reject optional cookies</button>
  `, "blocking-modal");
}

function renderCookieSettings() {
  const decision = read("cookieDecision") || { required: true, analytics: false };
  return sheet(`
    <h2>Cookie Settings</h2>
    <label class="setting-row"><span>Required cookies</span><input type="checkbox" checked disabled /></label>
    <label class="setting-row"><span>Analytics cookies</span><input type="checkbox" ${decision.analytics ? "checked" : ""} data-cookie-analytics /></label>
    <button class="primary-action full" data-action="save-cookie-settings">Save settings</button>
  `);
}

function renderLocationSheet() {
  return sheet(`
    <h2>Allow location access?</h2>
    <p>Location helps check delivery availability and nearest restaurant. You can enter an address manually.</p>
    <button class="primary-action full" data-action="allow-location">Allow location</button>
    <button class="secondary-action full" data-action="manual-address">Enter address manually</button>
  `);
}

function renderStartSheet() {
  const lang = t[state.language] || t.en;
  return sheet(`
    <h2>${lang.start}</h2>
    <button class="start-button delivery" data-sheet="delivery">${icon("delivery")}<span>${lang.delivery}</span><small>Bring it to my door</small></button>
    <button class="start-button pickup" data-sheet="pickup">${icon("pickup")}<span>${lang.pickup}</span><small>Collect from Giros King</small></button>
    <section class="rewards-mini"><strong>${lang.rewards}</strong><span>Save details and vouchers locally for this MVP.</span></section>
    <div class="start-shortcuts">
      <button data-sheet="language">${lang.language}</button>
      <button data-sheet="account">${lang.account}</button>
    </div>
  `);
}

function renderDeliveryFlow() {
  const address = read("deliveryAddress") || "";
  const quote = quoteDelivery(address, subtotal());
  return sheet(`
    <button class="sheet-back" data-sheet="">Back</button>
    <h2>Delivery</h2>
    <form id="deliveryFlowForm">
      <label class="field">Address search<input name="address" placeholder="Start typing your address here..." value="${address}" required /></label>
      <section class="address-section"><span>Current</span>${address ? `<button class="address-card" type="button" data-select-current-address>${address}<small>${quote.message}</small></button>` : `<p>No saved address yet.</p>`}</section>
      ${address && !quote.available ? `<div class="minimum-alert">${quote.message}</div>` : ""}
      <label class="field">Delivery date<select name="date">${[0, 1, 2, 3].map((offset) => `<option value="${todayISO(offset)}">${offset === 0 ? "Today" : offset === 1 ? "Tomorrow" : todayISO(offset)}</option>`).join("")}</select></label>
      <label class="field">Delivery time<select name="time">${pickupSlots().map((slot) => `<option>${slot}</option>`).join("")}</select></label>
      <p class="helper-copy">${settings().online ? "Store is open. You can deliver now." : "Store is currently closed. Choose a later time."}</p>
      <button class="primary-action full" type="submit">${settings().online ? "Deliver now" : "Deliver later"}</button>
    </form>
  `);
}

function renderPickupFlow() {
  return sheet(`
    <button class="sheet-back" data-sheet="">Back</button>
    <h2>Pickup</h2>
    <p>${storeAddress}</p>
    <form id="pickupFlowForm">
      <label class="field">Pickup day<select name="date">${[0, 1, 2, 3, 4].map((offset) => `<option value="${todayISO(offset)}">${offset === 0 ? "Today" : offset === 1 ? "Tomorrow" : todayISO(offset)}</option>`).join("")}</select></label>
      <label class="field">Pickup time<select name="time">${pickupSlots().map((slot, index) => `<option ${index === 3 ? "selected" : ""}>${slot}</option>`).join("")}</select></label>
      <p class="helper-copy">${settings().online ? "Choose a pickup time." : "Restaurant is closed now. Next available time is shown."}</p>
      <button class="primary-action full" type="submit">Continue to menu</button>
    </form>
  `);
}

function renderAddressConfirm() {
  const ctx = state.pendingCheckout;
  return sheet(`
    <h2>Please confirm your delivery address</h2>
    <article class="address-card">${ctx.address}<small>${quoteDelivery(ctx.address, subtotal()).message}</small></article>
    <button class="secondary-action full" data-sheet="delivery">Edit address</button>
    <button class="primary-action full" data-action="confirm-delivery-start">Confirm address</button>
  `);
}

function renderAccountSheet() {
  return sheet(`
    <h2>${state.authMode === "login" ? "Login" : state.authMode === "guest" ? "Guest details" : "Create account"}</h2>
    <div class="auth-tabs">
      <button class="${state.authMode === "guest" ? "active" : ""}" data-auth-mode="guest">Guest</button>
      <button class="${state.authMode === "login" ? "active" : ""}" data-auth-mode="login">Login</button>
      <button class="${state.authMode === "signup" ? "active" : ""}" data-auth-mode="signup">Sign up</button>
    </div>
    <button class="google-button" disabled>Continue with Google</button>
    <button class="google-button" disabled>Continue with Apple</button>
    <button class="google-button" disabled>Continue with Facebook</button>
    <small class="helper-copy">Social login placeholders are disabled until OAuth is configured.</small>
    <form id="accountForm">
      <label class="field">Name<input name="name" value="${state.user?.name || ""}" />${accountError("name")}</label>
      <label class="field">Mobile number<input name="phone" value="${state.user?.phone || ""}" />${accountError("phone")}</label>
      <label class="field">Email<input name="email" type="email" value="${state.user?.email || ""}" />${accountError("email")}</label>
      ${state.authMode === "signup" ? `<label class="field">Password<input name="password" type="password" />${accountError("password")}</label><label class="terms-line"><input name="terms" type="checkbox" /> I accept terms and privacy</label>${accountError("terms")}<label class="terms-line"><input name="rewards" type="checkbox" /> Join Rewards Club</label>` : ""}
      <button class="primary-action full" type="submit">${state.authMode === "login" ? "Login" : state.authMode === "guest" ? "Continue as guest" : "Create account"}</button>
    </form>
  `);
}

function renderLanguageSheet() {
  return sheet(`
    <h2>Language</h2>
    <button class="language-row ${state.language === "en" ? "active" : ""}" data-language="en">English</button>
    <button class="language-row ${state.language === "de" ? "active" : ""}" data-language="de">German</button>
  `);
}

function productTotal() {
  const product = state.selectedProduct;
  const cfg = state.productConfig;
  if (!product || !cfg) return 0;
  const sizePrice = { Small: -2, Medium: 0, Large: 3 }[cfg.size] || 0;
  const basePrice = cfg.base === "Cheese crust" ? 2.5 : 0;
  const toppingPrice = cfg.toppings.reduce((sum, topping) => sum + topping.price, 0);
  return Math.max(0, product.price + sizePrice + basePrice + toppingPrice) * cfg.quantity;
}

function renderProductSheet() {
  const product = state.selectedProduct;
  const cfg = state.productConfig;
  return sheet(`
    <button class="modal-close" data-action="close-product">Close</button>
    <img class="detail-image" src="${product.image}" alt="${product.name}" />
    <h2>${product.name}</h2>
    <strong>${money(product.price)}</strong>
    <p>${product.description}</p>
    <div class="info-row"><span>Allergens: ${product.allergens}</span><span>VAT included</span></div>
    ${optionGroup("Size", "size", ["Small", "Medium", "Large"], cfg.size)}
    ${optionGroup("Base/crust", "base", ["Classic", "Thin", "Cheese crust"], cfg.base)}
    ${optionGroup("Sauce", "sauce", ["Tomato", "Garlic", "BBQ", "No sauce"], cfg.sauce)}
    <section class="topping-editor"><h3>Toppings</h3>${toppingOptions.map((topping) => {
      const selected = cfg.toppings.some((item) => item.id === topping.id);
      return `<article><span>${topping.name}${topping.price ? ` · ${money(topping.price)}` : " included"}</span><button data-toggle-topping="${topping.id}">${selected ? "-" : "+"}</button></article>`;
    }).join("")}</section>
    <label class="field">Notes<textarea data-product-notes>${cfg.notes || ""}</textarea></label>
    <div class="quantity-control modal-quantity"><button data-product-qty="-">-</button><b>${cfg.quantity}</b><button data-product-qty="+">+</button></div>
    <button class="sticky-checkout product-add" data-action="add-product">Add to Cart · ${money(productTotal())}</button>
  `);
}

function optionGroup(title, key, values, selected) {
  return `<section class="option-group"><h3>${title}</h3>${values.map((value) => `<button class="${selected === value ? "active" : ""}" data-product-option="${key}" data-option-value="${value}">${value}</button>`).join("")}</section>`;
}

function renderUpsellSheet() {
  return sheet(`
    <h2>Would you like any add ons?</h2>
    <div class="upsell-grid">${read("upsellProducts").map((item) => `<button class="${state.selectedUpsells.has(item.id) ? "active" : ""}" data-upsell-select="${item.id}"><img src="${item.image}" alt="" /><span>${item.name}</span><strong>${money(item.price)}</strong></button>`).join("")}</div>
    <button class="primary-action full" data-action="add-upsells">Add selected</button>
    <button class="text-button full" data-action="skip-upsells">Skip</button>
  `);
}

function renderMinimumSheet() {
  const missing = Math.max(0, Number(settings().minimumOrder || 15) - subtotal());
  return sheet(`
    <h2>Sorry, your order does not meet the minimum delivery amount of ${money(settings().minimumOrder)}</h2>
    <p>Add ${money(missing)} more to continue.</p>
    ${renderSuggestedAddons()}
    <button class="primary-action full" data-action="close-minimum">Add more items</button>
  `);
}

function renderCheckoutAddressConfirm() {
  return sheet(`
    <h2>Please confirm your delivery address</h2>
    <article class="address-card">${state.pendingCheckout.address}<small>${quoteDelivery(state.pendingCheckout.address, subtotal()).message}</small></article>
    <button class="secondary-action full" data-action="edit-checkout-address">Edit address</button>
    <button class="primary-action full" data-action="place-confirmed-order">Confirm and place order</button>
  `);
}

function renderCheckoutSheet() {
  const ctx = context();
  const customer = state.user || {};
  return sheet(`
    <h2>Checkout</h2>
    <form id="checkoutForm">
      <section class="checkout-section"><h3>Order details</h3><p>${ctx.type === "delivery" ? ctx.address : storeAddress}<br />${ctx.date} at ${ctx.time}</p></section>
      <section class="checkout-section"><h3>My Details</h3>
        <label class="field">Name<input name="name" value="${customer.name || ""}" />${checkoutError("name")}</label>
        <label class="field">Phone<input name="phone" value="${customer.phone || ""}" />${checkoutError("phone")}</label>
        <label class="field">Email<input name="email" type="email" value="${customer.email || ""}" />${checkoutError("email")}</label>
      </section>
      <section class="checkout-section"><h3>Instructions</h3><textarea name="notes" placeholder="${ctx.type === "delivery" ? "Doorbell, floor, apartment..." : "Pickup notes..."}"></textarea></section>
      <section class="checkout-section"><h3>Terms and Conditions</h3><label class="terms-line"><input name="terms" type="checkbox" /> I agree to privacy and order terms</label>${checkoutError("terms")}</section>
      <section class="checkout-section"><h3>Payment Method</h3>${paymentMethods.map((method) => `<label class="payment-card ${method === "Cash" ? "active" : "disabled"}"><input type="radio" name="payment" value="${method}" ${method === "Cash" ? "checked" : "disabled"} /> ${method}${method === "Cash" ? "" : " · coming soon"}</label>`).join("")}</section>
      <button class="sticky-checkout" type="submit">Place order · ${money(total())}</button>
    </form>
  `);
}

function accountError(name) {
  return state.accountErrors[name] ? `<small class="field-error">${state.accountErrors[name]}</small>` : "";
}

function checkoutError(name) {
  return state.checkoutErrors[name] ? `<small class="field-error">${state.checkoutErrors[name]}</small>` : "";
}

function updateProductGrid() {
  const grid = app.querySelector("[data-product-grid]");
  if (grid) grid.innerHTML = renderProductGrid();
}

function showToast(message) {
  state.toast = message;
  const host = app.querySelector(".toast-host");
  if (host) host.innerHTML = `<div class="toast">${message}</div>`;
  setTimeout(() => {
    state.toast = "";
    const current = app.querySelector(".toast-host");
    if (current) current.innerHTML = "";
  }, 2200);
}

function openProduct(product) {
  state.selectedProduct = product;
  state.productConfig = { size: "Medium", base: "Classic", sauce: "Tomato", toppings: toppingOptions.filter((item) => item.included), quantity: 1, notes: "" };
  render();
}

function addProductToCart() {
  const product = state.selectedProduct;
  const cfg = state.productConfig;
  const unitTotal = productTotal() / cfg.quantity;
  write("cart", [newCartItem(product, {
    ...cfg,
    unitPrice: unitTotal,
    lineTotal: unitTotal,
    summary: [cfg.size, cfg.base, cfg.sauce, ...cfg.toppings.map((item) => item.name), cfg.notes].filter(Boolean).join(" · "),
  }), ...cart()]);
  state.selectedProduct = null;
  state.productConfig = null;
  state.upsellOpen = true;
  render();
}

function addUpsell(id) {
  const item = read("upsellProducts").find((upsell) => upsell.id === id);
  if (!item) return;
  write("cart", [{ cartId: `cart-${Date.now()}`, productId: item.productId, name: item.name, quantity: 1, unitPrice: item.price, lineTotal: item.price, toppings: [], extras: [], summary: "Add on" }, ...cart()]);
}

function continueToCheckout() {
  if (context()?.type === "delivery" && subtotal() < Number(settings().minimumOrder || 15)) {
    state.minOrderOpen = true;
    render();
    return;
  }
  if (!state.user) {
    state.sheet = "account";
    render();
    return;
  }
  state.sheet = "checkout";
  render();
}

async function placeOrder(details) {
  const order = createOrderFromCart({ cart: cart(), context: context(), customer: state.user, notes: details.notes, paymentMethod: details.payment, voucher: state.appliedVoucher });
  let persisted = order;
  try {
    const result = await createOrder(order);
    persisted = { ...result.order, status: "confirmed", orderItems: order.orderItems };
  } catch {
    showToast("Order saved locally. Email service unavailable.");
  }
  saveOrder(persisted);
  write("cart", []);
  state.sheet = null;
  state.addressConfirmOpen = false;
  state.pendingCheckout = null;
  state.page = "cart";
  render();
  showToast("Order confirmed");
}

app.addEventListener("click", (event) => {
  const page = event.target.closest("[data-page]")?.dataset.page;
  const sheetName = event.target.closest("[data-sheet]")?.dataset.sheet;
  const action = event.target.closest("[data-action]")?.dataset.action;
  const category = event.target.closest("[data-category]")?.dataset.category;
  const productId = event.target.closest("[data-product]")?.dataset.product || event.target.closest("[data-offer-product]")?.dataset.offerProduct;
  const banner = event.target.closest("[data-banner]")?.dataset.banner;
  const authMode = event.target.closest("[data-auth-mode]")?.dataset.authMode;
  const language = event.target.closest("[data-language]")?.dataset.language;
  const toppingId = event.target.closest("[data-toggle-topping]")?.dataset.toggleTopping;
  const optionKey = event.target.closest("[data-product-option]")?.dataset.productOption;
  const optionValue = event.target.closest("[data-product-option]")?.dataset.optionValue;
  const qty = event.target.closest("[data-product-qty]")?.dataset.productQty;
  const dec = event.target.closest("[data-dec]");
  const inc = event.target.closest("[data-inc]");

  if (page) {
    state.page = page;
    state.sheet = null;
    render();
  }
  if (sheetName !== undefined) {
    state.sheet = sheetName || null;
    render();
  }
  if (category) {
    state.category = category;
    updateProductGrid();
    app.querySelectorAll("[data-category]").forEach((button) => button.classList.toggle("active", button.dataset.category === category));
  }
  if (productId) {
    const product = read("products").find((item) => item.id === productId);
    if (product) openProduct(product);
  }
  if (banner !== undefined) {
    state.bannerIndex = Number(banner);
    render();
  }
  if (authMode) {
    state.authMode = authMode;
    state.accountErrors = {};
    render();
  }
  if (language) {
    state.language = language;
    write("language", language);
    state.sheet = null;
    render();
  }
  if (toppingId && state.productConfig) {
    const topping = toppingOptions.find((item) => item.id === toppingId);
    const exists = state.productConfig.toppings.some((item) => item.id === toppingId);
    state.productConfig.toppings = exists ? state.productConfig.toppings.filter((item) => item.id !== toppingId) : [...state.productConfig.toppings, topping];
    render();
  }
  if (optionKey && state.productConfig) {
    state.productConfig[optionKey] = optionValue;
    render();
  }
  if (qty && state.productConfig) {
    state.productConfig.quantity = Math.max(1, state.productConfig.quantity + (qty === "+" ? 1 : -1));
    render();
  }
  if (dec || inc) {
    const id = (dec || inc).dataset.dec || (dec || inc).dataset.inc;
    write("cart", cart().flatMap((item) => item.cartId !== id ? item : item.quantity + (inc ? 1 : -1) > 0 ? [{ ...item, quantity: item.quantity + (inc ? 1 : -1) }] : []));
    render();
  }
  if (action === "close-product") {
    state.selectedProduct = null;
    render();
  }
  if (action === "add-product") addProductToCart();
  if (action === "add-upsells") {
    [...state.selectedUpsells].forEach(addUpsell);
    state.selectedUpsells.clear();
    state.upsellOpen = false;
    state.page = "cart";
    render();
  }
  if (action === "skip-upsells") {
    state.upsellOpen = false;
    state.page = "cart";
    render();
  }
  if (event.target.closest("[data-upsell-select]")) {
    const id = event.target.closest("[data-upsell-select]").dataset.upsellSelect;
    state.selectedUpsells.has(id) ? state.selectedUpsells.delete(id) : state.selectedUpsells.add(id);
    render();
  }
  if (event.target.closest("[data-add-upsell]")) {
    addUpsell(event.target.closest("[data-add-upsell]").dataset.addUpsell);
    render();
  }
  if (event.target.closest("[data-recent-search]")) {
    state.query = event.target.closest("[data-recent-search]").dataset.recentSearch;
    render();
  }
  if (action === "checkout") continueToCheckout();
  if (action === "close-minimum") {
    state.minOrderOpen = false;
    state.page = "menu";
    render();
  }
  if (action === "edit-checkout-address") {
    state.addressConfirmOpen = false;
    state.sheet = "checkout";
    render();
  }
  if (action === "place-confirmed-order") placeOrder(state.pendingCheckout);
  if (action === "logout") {
    write("session", null);
    state.user = null;
    render();
  }
  if (action === "allow-location") requestLocation();
  if (action === "manual-address") {
    write("locationPreference", { allowed: false });
    state.sheet = "delivery";
    render();
  }
  if (action === "save-cookie-settings") {
    const analytics = Boolean(app.querySelector("[data-cookie-analytics]")?.checked);
    write("cookieDecision", { required: true, analytics });
    state.sheet = read("locationPreference") ? null : "location";
    render();
  }
  if (event.target.closest("[data-cookie-choice]")) {
    const choice = event.target.closest("[data-cookie-choice]").dataset.cookieChoice;
    write("cookieDecision", { required: true, analytics: choice === "all" });
    state.sheet = read("locationPreference") ? null : "location";
    render();
  }
  if (action === "apply-voucher") applyVoucher();
  if (event.target.closest("[data-save-voucher]")) saveVoucher(event.target.closest("[data-save-voucher]").dataset.saveVoucher);
  if (event.target.closest("[data-saved-voucher]")) useSavedVoucher(event.target.closest("[data-saved-voucher]").dataset.savedVoucher);
  if (action === "start-over") {
    write("orderContext", null);
    state.orderContext = null;
    state.sheet = null;
    render();
  }
});

app.addEventListener("input", (event) => {
  if (event.target.matches("[data-search]")) {
    state.query = event.target.value;
    const term = sanitize(state.query).replace(/["']/g, "").slice(0, 40);
    if (term.length > 2) write("recentSearches", [term, ...read("recentSearches").filter((item) => item !== term)].slice(0, 6));
    window.clearTimeout(state.searchTimer);
    state.searchTimer = window.setTimeout(updateProductGrid, 120);
  }
  if (event.target.matches("[data-voucher-input]")) state.voucherCode = event.target.value;
  if (event.target.matches("[data-product-notes]") && state.productConfig) state.productConfig.notes = event.target.value;
});

app.addEventListener("submit", (event) => {
  event.preventDefault();
  if (event.target.id === "deliveryFlowForm") {
    const data = new FormData(event.target);
    const address = sanitize(data.get("address"));
    const quote = quoteDelivery(address, subtotal());
    write("deliveryAddress", address);
    if (!quote.available) return showToast(quote.message);
    state.pendingCheckout = { type: "delivery", address, date: String(data.get("date")), time: String(data.get("time")) };
    state.sheet = "address-confirm";
    render();
  }
  if (event.target.id === "pickupFlowForm") {
    const data = new FormData(event.target);
    state.orderContext = { type: "pickup", storeAddress, date: String(data.get("date")), time: String(data.get("time")) };
    write("orderContext", state.orderContext);
    state.sheet = null;
    render();
  }
  if (event.target.id === "accountForm") {
    const data = new FormData(event.target);
    const input = { name: data.get("name"), phone: data.get("phone"), email: data.get("email"), password: data.get("password"), terms: Boolean(data.get("terms")), rewards: Boolean(data.get("rewards")) };
    const errors = validateAccount(input, { requirePassword: state.authMode === "signup", requireTerms: state.authMode === "signup" });
    state.accountErrors = errors;
    if (Object.keys(errors).length) return render();
    state.user = saveDemoUser(input, state.authMode);
    state.sheet = null;
    render();
  }
  if (event.target.id === "checkoutForm") {
    const data = new FormData(event.target);
    if (context().type === "delivery") data.set("address", context().address);
    const errors = validateCheckout(data, context().type);
    if (!data.get("terms")) errors.terms = "Please accept terms";
    state.checkoutErrors = errors;
    if (Object.keys(errors).length) return render();
    state.user = saveDemoUser({ name: data.get("name"), email: data.get("email"), phone: data.get("phone") }, state.user?.type || "guest");
    state.pendingCheckout = { notes: sanitize(data.get("notes")), payment: data.get("payment") || "Cash", address: context().address };
    if (context().type === "delivery") {
      state.addressConfirmOpen = true;
      render();
    } else {
      placeOrder(state.pendingCheckout);
    }
  }
});

function applyVoucher() {
  const code = sanitize(state.voucherCode).toUpperCase();
  const voucher = read("promotions").find((promo) => promo.active && promo.code === code);
  if (!voucher) return showToast("Voucher not found");
  state.appliedVoucher = voucher;
  write("appliedVoucher", voucher);
  render();
}

function saveVoucher(id) {
  const voucher = read("promotions").find((promo) => promo.id === id);
  if (!voucher) return;
  write("savedVouchers", [voucher, ...read("savedVouchers").filter((item) => item.id !== id)]);
  showToast("Voucher saved");
}

function useSavedVoucher(id) {
  const voucher = read("savedVouchers").find((item) => item.id === id);
  if (!voucher) return;
  state.appliedVoucher = voucher;
  state.voucherCode = voucher.code;
  write("appliedVoucher", voucher);
  render();
}

function requestLocation() {
  if (!navigator.geolocation) {
    write("locationPreference", { allowed: false, reason: "unavailable" });
    state.sheet = "delivery";
    render();
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (position) => {
      write("locationPreference", { allowed: true, lat: Number(position.coords.latitude.toFixed(3)), lng: Number(position.coords.longitude.toFixed(3)) });
      state.sheet = "delivery";
      render();
    },
    () => {
      write("locationPreference", { allowed: false });
      state.sheet = "delivery";
      render();
    },
    { enableHighAccuracy: false, timeout: 5000, maximumAge: 600000 },
  );
}

app.addEventListener("click", (event) => {
  if (event.target.closest("[data-action='confirm-delivery-start']") && state.pendingCheckout) {
    state.orderContext = state.pendingCheckout;
    write("orderContext", state.orderContext);
    state.pendingCheckout = null;
    state.sheet = null;
    render();
  }
});

getSupabaseStatus().then((status) => console.info(`[Giros King] ${status.mode}`));
render();
