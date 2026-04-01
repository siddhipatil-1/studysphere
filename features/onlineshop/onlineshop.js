/**
 * onlineshop.js
 *
 * Uses window.supabaseClient from /js/supabaseClient.js
 * Physical books → Contact Seller modal (no payment, shows locality + college + WhatsApp)
 * Digital books  → Razorpay checkout
 * Complaints     → EmailJS (fill in your keys below)
 *
 * ─── EmailJS setup ────────────────────────────────────────────────────────────
 * 1. Go to https://www.emailjs.com and create a free account
 * 2. Add an Email Service (Gmail recommended) → copy the Service ID
 * 3. Create an Email Template with these variables:
 * {{book_title}}  {{buyer_email}}  {{complaint_message}}  {{purchase_date}}
 * Set the "To Email" in the template to YOUR complaint inbox address.
 * 4. Copy your Public Key from Account → API Keys
 * 5. Fill in the three constants below
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ── EmailJS config — FILL THESE IN ───────────────────────────────────────────
const EMAILJS_PUBLIC_KEY = "-VydCduYmtXKz5HP4"; // Account → API Keys
const EMAILJS_SERVICE_ID = "service_py8q3ui"; // Email Services tab
const EMAILJS_TEMPLATE_ID = "template_q5l1h1d"; // Email Templates tab
// ─────────────────────────────────────────────────────────────────────────────

const RAZORPAY_KEY = "rzp_test_S4pp2O0yUlduKl"; // replace with live key when ready
const sb = window.supabaseClient;

// ─── State ────────────────────────────────────────────────────────────────────
let currentUser = null;
let products = [];
let cart = [];
let myPurchasedIds = new Set();
let activeFilter = "all";
let activeSort = "newest";
let activePayout = "bank";

// ─── Boot ─────────────────────────────────────────────────────────────────────
(async function boot() {
  // Initialise EmailJS
  if (typeof emailjs !== "undefined") emailjs.init(EMAILJS_PUBLIC_KEY);

  const {
    data: { session },
  } = await sb.auth.getSession();
  if (!session) {
    window.location.href = "../../dashboard/dashboard.html";
    return;
  }
  currentUser = session.user;

  const badge = document.getElementById("user-email-badge");
  if (badge) {
    badge.textContent = currentUser.email;
    badge.classList.remove("hidden");
  }

  await Promise.all([loadProducts(), loadLibrary()]);
  updateSellerNavBar();
  bindEvents();
  lucide.createIcons();

  // Initialize Realtime Notifications
  initShopNotifications();
})();

// ─────────────────────────────────────────────────────────────────────────────
//  SALE NOTIFICATION SYSTEM
//
//  The shop opens in a new tab. The dashboard tab handles the bell notification
//  directly via its own postgres_changes listener on `purchases`
//  (set up in dashboard.js → setupDashboardRealtime).
//
//  This listener only refreshes the seller earnings badge on THIS page.
// ─────────────────────────────────────────────────────────────────────────────

function initShopNotifications() {
  if (!currentUser) return;

  sb.channel("online_shop_sales")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "purchases" },
      async (payload) => {
        const purchase = payload.new;

        const { data: product, error } = await sb
          .from("products")
          .select("seller_id")
          .eq("id", purchase.product_id)
          .single();

        if (error || !product) return;
        if (product.seller_id !== currentUser.id) return;

        // Refresh the earnings number shown in the shop topbar
        updateSellerNavBar();
      },
    )
    .subscribe();
}

// ─── Load data ────────────────────────────────────────────────────────────────
async function loadProducts() {
  const { data, error } = await sb
    .from("products")
    .select("*")
    .eq("is_deleted", false)
    .order("created_at", { ascending: false });

  if (error) {
    document.getElementById("product-grid").innerHTML =
      `<div class="empty-state-full"><i data-lucide="wifi-off"></i><p>Could not load marketplace. Check your connection.</p></div>`;
    lucide.createIcons();
    return;
  }

  const rows = data || [];

  // Fetch usernames for all unique seller_ids in one query — no FK join needed
  const sellerIds = [...new Set(rows.map((p) => p.seller_id).filter(Boolean))];
  let usernameMap = {};
  if (sellerIds.length) {
    const { data: profiles } = await sb
      .from("profiles")
      .select("id, username")
      .in("id", sellerIds);
    (profiles || []).forEach((p) => {
      usernameMap[p.id] = p.username;
    });
  }

  // Attach seller_username directly onto each product row
  products = rows.map((p) => ({
    ...p,
    seller_username: usernameMap[p.seller_id] || null,
  }));
  renderProducts();
}

async function loadLibrary() {
  if (!currentUser) return;

  const { data, error } = await sb
    .from("purchases")
    .select("*")
    .eq("user_id", currentUser.id)
    .order("created_at", { ascending: false });
  if (error) return console.error("Library load error:", error.message);

  const rows = data || [];
  if (!rows.length) {
    myPurchasedIds = new Set();
    renderLibrary([]);
    return;
  }

  // Step 1: get seller_id and seller_email from the original products rows
  const productIds = rows.map((r) => r.product_id).filter(Boolean);
  const { data: productRows } = await sb
    .from("products")
    .select("id, seller_id, seller_email")
    .in("id", productIds);

  // Build product_id → { seller_id, seller_email } map
  const productSellerMap = {};
  (productRows || []).forEach((p) => {
    productSellerMap[p.id] = {
      seller_id: p.seller_id,
      seller_email: p.seller_email,
    };
  });

  // Step 2: get usernames for all unique seller_ids
  const sellerIds = [
    ...new Set(
      Object.values(productSellerMap)
        .map((v) => v.seller_id)
        .filter(Boolean),
    ),
  ];
  let usernameMap = {};
  if (sellerIds.length) {
    const { data: profiles } = await sb
      .from("profiles")
      .select("id, username")
      .in("id", sellerIds);
    (profiles || []).forEach((p) => {
      usernameMap[p.id] = p.username;
    });
  }

  // Flatten onto each purchase row
  const enriched = rows.map((row) => {
    const sellerInfo = productSellerMap[row.product_id] || {};
    return {
      ...row,
      seller_id: sellerInfo.seller_id || null,
      seller_email: sellerInfo.seller_email || null,
      seller_username: usernameMap[sellerInfo.seller_id] || null,
    };
  });

  myPurchasedIds = new Set(enriched.map((r) => r.product_id));
  renderLibrary(enriched);
}

async function updateSellerNavBar() {
  if (!currentUser) return;

  // Get all products listed by this user
  const { data: myProducts } = await sb
    .from("products")
    .select("id")
    .eq("seller_id", currentUser.id);

  if (!myProducts || !myProducts.length) return; // not a seller — keep badge hidden

  // Sum earnings directly from purchases
  const ids = myProducts.map((p) => p.id);
  const { data: sales, error } = await sb
    .from("purchases")
    .select("price")
    .in("product_id", ids);

  if (error) {
    console.error("updateSellerNavBar:", error.message);
    return;
  }

  const total = (sales || []).reduce((s, i) => s + Number(i.price), 0);
  const booksSold = (sales || []).length;

  const statsContainer = document.getElementById("nav-seller-stats");
  if (statsContainer) {
    statsContainer.classList.remove("hidden");
    document.getElementById("nav-earnings-amount").textContent =
      total.toLocaleString("en-IN");
    statsContainer.title = `${booksSold} book${booksSold !== 1 ? "s" : ""} sold`;
  }
}

// ─── Delete (soft) a seller's own listing ────────────────────────────────────
async function deleteProduct(id) {
  const product = products.find((p) => p.id === id);
  if (!product) return;

  const hasSales = /* we check purchases below */ false;
  const { count } = await sb
    .from("purchases")
    .select("id", { count: "exact", head: true })
    .eq("product_id", id);

  const soldNote =
    count > 0
      ? `\n\n⚠️ ${count} buyer(s) have already purchased this book. Their library access and your earnings are preserved.`
      : "";

  const confirmed = confirm(
    `Remove "${product.title}" from the marketplace?${soldNote}\n\nThe listing will be hidden but your earnings history is kept.`,
  );
  if (!confirmed) return;

  const { error } = await sb
    .from("products")
    .update({ is_deleted: true })
    .eq("id", id)
    .eq("seller_id", currentUser.id); // double-check ownership client-side too

  if (error) {
    alert("Could not remove listing: " + error.message);
    return;
  }

  // Remove from local state and re-render — no full reload needed
  products = products.filter((p) => p.id !== id);
  renderProducts();
  updateSellerNavBar();
}

// ─── Render Products ──────────────────────────────────────────────────────────
function renderProducts() {
  let list = [...products];
  if (activeFilter !== "all")
    list = list.filter((p) => p.type === activeFilter);

  const q = document.getElementById("search-input").value.toLowerCase().trim();
  if (q)
    list = list.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        (p.author || "").toLowerCase().includes(q),
    );

  if (activeSort === "price-asc") list.sort((a, b) => a.price - b.price);
  if (activeSort === "price-desc") list.sort((a, b) => b.price - a.price);

  const grid = document.getElementById("product-grid");
  if (!list.length) {
    grid.innerHTML = `<div class="empty-state-full"><i data-lucide="search-x"></i><p>No books found.</p></div>`;
    lucide.createIcons();
    return;
  }

  grid.innerHTML = list
    .map((p, i) => {
      const isPurchased = myPurchasedIds.has(p.id);
      const isOwner = currentUser && p.seller_id === currentUser.id;
      const isPhysical = p.type === "Physical";

      let statusBadge = "";
      let actions = "";

      if (isOwner) {
        statusBadge = `<span class="card-status-badge owned">Your Listing</span>`;
        actions = `
    <div style="display:flex;gap:8px;width:100%;">
      <button class="btn-disabled-listed" style="flex:1;" disabled>Listed by You</button>
      <button class="btn-delete-listing" data-action="delete-listing" data-id="${p.id}" title="Remove listing">
        <i data-lucide="trash-2"></i>
      </button>
    </div>`;
      } else if (isPurchased) {
        statusBadge = `<span class="card-status-badge purchased">✓ Purchased</span>`;
        actions = `<button class="btn-view-lib btn-library-toggle">View in Library</button>`;
      } else if (isPhysical) {
        const locationParts = [p.locality, p.college]
          .filter(Boolean)
          .join(" · ");
        actions = `
        <button class="btn-contact-seller"
          data-action="contact-seller"
          data-id="${p.id}"
          data-title="${escHtml(p.title)}"
          data-phone="${escHtml(p.seller_phone || "")}"
          data-locality="${escHtml(p.locality || "")}"
          data-college="${escHtml(p.college || "")}"
          data-location="${escHtml(p.location || "")}"
          data-price="${p.price}">
          <i data-lucide="message-circle"></i> Contact Seller
        </button>`;
      } else {
        actions = `
        <div style="display:flex;gap:8px;">
          <button class="btn-cart-add" data-action="add-cart" data-id="${p.id}">Add to Cart</button>
          <button class="btn-buy-now"  data-action="buy-now"  data-id="${p.id}">Buy Now</button>
        </div>`;
      }

      const locationChips = isPhysical
        ? `
      <div class="location-chips">
        ${p.locality ? `<span class="location-chip"><i data-lucide="map-pin"></i>${escHtml(p.locality)}</span>` : ""}
        ${p.college ? `<span class="location-chip"><i data-lucide="graduation-cap"></i>${escHtml(p.college)}</span>` : ""}
      </div>`
        : "";

      const sellerUsername = p.seller_username || null;
      const sellerChip =
        !isOwner && sellerUsername
          ? `<div class="seller-chip"><i data-lucide="user-circle"></i>${escHtml(sellerUsername)}</div>`
          : "";

      return `
      <div class="product-card" style="animation-delay:${i * 0.04}s"
           data-seller-username="${escHtml(sellerUsername || "")}"
           data-seller-id="${escHtml(p.seller_id || "")}">
        <div class="card-img-wrap">
          <img src="${escHtml(p.image)}" alt="${escHtml(p.title)}" loading="lazy"
               onerror="this.src='https://via.placeholder.com/280x220?text=📚'">
          <span class="card-type-badge">${escHtml(p.type)}</span>
          ${statusBadge}
        </div>
        <div class="card-body">
          <h3 class="card-title">${escHtml(p.title)}</h3>
          <p class="card-author">by ${escHtml(p.author || "Unknown")}</p>
          ${sellerChip}
          ${locationChips}
          <div class="card-price">₹${p.price} <span>INR</span></div>
          <div class="card-actions">${actions}</div>
        </div>
      </div>`;
    })
    .join("");

  lucide.createIcons();
}

// ─── Render Library ───────────────────────────────────────────────────────────
function renderLibrary(items) {
  const container = document.getElementById("library-items");
  const badge = document.getElementById("lib-count");

  if (!items.length) {
    container.innerHTML = `<p class="empty-hint">No purchases yet. Buy a book to add it here!</p>`;
    if (badge) badge.classList.add("hidden");
    return;
  }

  if (badge) {
    badge.textContent = items.length;
    badge.classList.remove("hidden");
  }

  container.innerHTML = items
    .map((item) => {
      const isDigital = item.type === "Digital";
      const waMsg = encodeURIComponent(
        `Hi! I bought "${item.title}" on StudySphere. Where can we meet?`,
      );
      const imgSrc = item.image || "https://via.placeholder.com/52x68?text=📚";

      let actionBtn = "";
      if (isDigital && item.pdf) {
        actionBtn = `
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
          <a href="${item.pdf}" download="${item.title.replace(/\s+/g, "_")}.pdf" target="_blank" class="btn-download">
            <i data-lucide="download"></i> Download PDF
          </a>
          <button class="btn-report"
            data-action="report"
            data-title="${escHtml(item.title)}"
            data-pid="${item.product_id}"
            data-seller-username="${escHtml(item.seller_username || "")}"
            data-seller-email="${escHtml(item.seller_email || "")}">
            <i data-lucide="flag"></i> Report
          </button>
        </div>`;
      } else if (isDigital) {
        actionBtn = `<span class="text-muted-sm">PDF not available yet</span>`;
      } else {
        actionBtn = `
        <a href="https://wa.me/${item.seller_phone}?text=${waMsg}" target="_blank" class="btn-whatsapp">
          <i data-lucide="message-circle"></i> Chat with Seller
        </a>`;
      }

      return `
      <div class="lib-card">
        <img src="${imgSrc}" alt="${escHtml(item.title)}" onerror="this.src='https://via.placeholder.com/52x68?text=📚'">
        <div class="lib-card-info">
          <span class="lib-badge ${isDigital ? "digital" : "physical"}">${escHtml(item.type)}</span>
          <div class="lib-card-title">${escHtml(item.title)}</div>
          <div class="lib-card-meta">by ${escHtml(item.author || "?")} &nbsp;·&nbsp; ₹${item.price}</div>
          ${
            item.seller_username
              ? `<div class="lib-seller-info"><i data-lucide="user-circle"></i>${escHtml(item.seller_username)}</div>`
              : ""
          }
          ${actionBtn}
        </div>
      </div>`;
    })
    .join("");

  lucide.createIcons();
}

// ─── Contact Seller modal (Physical books) ────────────────────────────────────
function openContactSeller(dataset) {
  const { title, phone, locality, college, location, price } = dataset;
  const waMsg = encodeURIComponent(
    `Hi! I'm interested in buying "${title}" listed on StudySphere. Is it still available?`,
  );

  document.getElementById("contact-details").innerHTML = `
    <div class="contact-book-title">${escHtml(title)}</div>
    <div class="contact-price">₹${escHtml(price)}</div>
    <div class="contact-info-grid">
      ${locality ? `<div class="contact-info-row"><i data-lucide="map-pin"></i><div><strong>Area / Locality</strong><span>${escHtml(locality)}</span></div></div>` : ""}
      ${college ? `<div class="contact-info-row"><i data-lucide="graduation-cap"></i><div><strong>College</strong><span>${escHtml(college)}</span></div></div>` : ""}
      ${location ? `<div class="contact-info-row"><i data-lucide="home"></i><div><strong>Full Address</strong><span>${escHtml(location)}</span></div></div>` : ""}
    </div>
    <p class="contact-note">This is a physical book — arrange pickup directly with the seller via WhatsApp.</p>
    <a href="https://wa.me/${escHtml(phone)}?text=${waMsg}" target="_blank" class="btn-whatsapp btn-whatsapp--full">
      <i data-lucide="message-circle"></i> Chat with Seller on WhatsApp
    </a>`;

  openModal("contact-modal");
  lucide.createIcons();
}

// ─── Report / Complaint (EmailJS) ────────────────────────────────────────────
let reportBookTitle = "";
let reportSellerUsername = "";
let reportSellerEmail = "";

function openReportModal(title, sellerUsername, sellerEmail) {
  reportBookTitle = title;
  reportSellerUsername = sellerUsername || "Unknown";
  reportSellerEmail = sellerEmail || "Unknown";
  document.getElementById("report-book-title").value = title;
  document.getElementById("report-user-email").value = currentUser.email;
  document.getElementById("report-message").value = "";
  document.getElementById("report-status").classList.add("hidden");
  openModal("report-modal");
}

async function submitReport() {
  const message = document.getElementById("report-message").value.trim();
  if (!message) return alert("Please describe the issue before submitting.");

  const btn = document.getElementById("btn-submit-report");
  btn.disabled = true;
  btn.innerHTML = `<i data-lucide="loader-circle"></i> Sending…`;
  lucide.createIcons();

  const status = document.getElementById("report-status");

  try {
    await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
      book_title: reportBookTitle,
      buyer_email: currentUser.email,
      seller_username: reportSellerUsername,
      seller_email: reportSellerEmail,
      complaint_message: message,
      purchase_date: new Date().toLocaleDateString("en-IN", {
        dateStyle: "long",
      }),
    });

    status.textContent =
      "✅ Complaint submitted! We'll review it within 48 hours.";
    status.classList.remove("hidden", "report-status--error");
    status.classList.add("report-status--ok");
    document.getElementById("report-message").value = "";

    setTimeout(() => closeModal("report-modal"), 3000);
  } catch (err) {
    console.error("EmailJS error:", err);
    status.textContent =
      "❌ Failed to send. Please try again or contact support directly.";
    status.classList.remove("hidden", "report-status--ok");
    status.classList.add("report-status--error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<i data-lucide="send"></i> Submit Complaint`;
    lucide.createIcons();
  }
}

// ─── Cart (Digital only) ──────────────────────────────────────────────────────
function addToCart(id) {
  const p = products.find((x) => x.id === id);
  if (!p) return;
  if (p.type === "Physical") return;
  if (p.seller_id === currentUser.id)
    return alert("You cannot buy your own listing!");
  if (myPurchasedIds.has(id)) return alert("You already own this book.");
  const ex = cart.find((x) => x.id === id);
  if (ex) ex.qty++;
  else cart.push({ ...p, qty: 1 });
  updateCartUI();
}

function removeFromCart(id) {
  cart = cart.filter((i) => i.id !== id);
  updateCartUI();
}

function updateCartUI() {
  const count = cart.reduce((s, i) => s + i.qty, 0);
  const total = cart.reduce((s, i) => s + i.price * i.qty, 0);

  const cartCountEl = document.getElementById("cart-count");
  const cartTotalEl = document.getElementById("cart-total");
  const btn = document.getElementById("btn-checkout");

  if (cartCountEl) cartCountEl.textContent = count;
  if (cartTotalEl) cartTotalEl.textContent = total;
  if (btn) btn.disabled = cart.length === 0;

  const items = document.getElementById("cart-items");
  if (!items) return;

  if (!cart.length) {
    items.innerHTML = `<p class="empty-hint">Your cart is empty.</p>`;
    return;
  }

  items.innerHTML = cart
    .map(
      (i) => `
    <div class="cart-item">
      <img src="${escHtml(i.image)}" alt="${escHtml(i.title)}"
           onerror="this.src='https://via.placeholder.com/44x56?text=📚'">
      <div class="cart-item-info">
        <div class="cart-item-title">${escHtml(i.title)}</div>
        <div class="cart-item-price">₹${i.price} × ${i.qty}</div>
      </div>
      <button class="btn-remove-cart" data-action="remove-cart" data-id="${i.id}" aria-label="Remove">
        <i data-lucide="trash-2"></i>
      </button>
    </div>`,
    )
    .join("");

  lucide.createIcons();
}

// ─── Checkout (Razorpay — Digital only) ──────────────────────────────────────
function checkout() {
  const total = cart.reduce((s, i) => s + i.price * i.qty, 0);
  if (!total) return;

  new Razorpay({
    key: RAZORPAY_KEY,
    amount: total * 100,
    currency: "INR",
    name: "StudySphere Marketplace",
    description: `${cart.length} digital book${cart.length > 1 ? "s" : ""}`,
    prefill: { email: currentUser.email },
    theme: { color: "#6b68b8" },
    handler: () => handlePaymentSuccess(),
  }).open();
}

async function handlePaymentSuccess() {
  const savedCart = [...cart];

  const { ok, error: saveErr } = await savePurchases(savedCart);
  if (!ok) {
    alert(
      `Payment went through but we could not save your purchase:\n${saveErr}\n\nPlease screenshot this and contact support — your money is safe.`,
    );
    return;
  }

  const productIds = savedCart.map((i) => i.id);
  const { data: freshProducts } = await sb
    .from("products")
    .select("id, title, pdf, type")
    .in("id", productIds);

  const pdfMap = {};
  (freshProducts || []).forEach((p) => {
    pdfMap[p.id] = p.pdf;
  });

  const container = document.getElementById("order-details");
  if (container) {
    container.innerHTML = savedCart
      .map((item) => {
        const pdfUrl = pdfMap[item.id] || item.pdf;
        const safeName = (item.title || "book").replace(/\s+/g, "_");
        return `
      <div class="order-item">
        <div class="order-item-title">${escHtml(item.title)} (Digital)</div>
        ${
          pdfUrl
            ? `<a href="${pdfUrl}" download="${safeName}.pdf" target="_blank" class="btn-download" style="margin-top:8px;display:inline-flex;">
               <i data-lucide="download"></i> Download PDF now
             </a>`
            : `<div class="order-item-detail" style="color:var(--green);">✅ Saved to My Library</div>`
        }
      </div>`;
      })
      .join("");
  }

  const purchaseModal = document.getElementById("purchase-modal");
  if (purchaseModal) purchaseModal.classList.remove("hidden");
  lucide.createIcons();

  cart = [];
  updateCartUI();
  closePanel("cart-panel");
  await loadLibrary();
  renderProducts();
}

async function savePurchases(items) {
  if (!currentUser) return { ok: false, error: "Not logged in" };
  const rows = items.map((item) => ({
    user_id: currentUser.id,
    product_id: item.id,
    title: item.title,
    author: item.author || null,
    type: item.type,
    price: item.price,
    image: item.image || null,
    pdf: item.pdf || null,
    seller_phone: item.seller_phone || null,
    locality: item.locality || null,
    college: item.college || null,
  }));

  const { error } = await sb.from("purchases").upsert(rows, {
    onConflict: "user_id,product_id",
    ignoreDuplicates: false,
  });
  if (error) {
    if (error.code === "23505") return { ok: true };
    return { ok: false, error: `${error.message} (code: ${error.code})` };
  }
  return { ok: true };
}

// ─── Seller listing ───────────────────────────────────────────────────────────
async function submitSellerProduct() {
  if (!currentUser) return;
  const btn = document.getElementById("btn-submit-seller");

  const title = document.getElementById("seller-title").value.trim();
  const author = document.getElementById("seller-author").value.trim();
  const phone = document.getElementById("seller-phone").value.trim();
  const type = document.getElementById("seller-type").value;
  const price = document.getElementById("seller-price").value;
  const imageFile = document.getElementById("seller-image").files[0];

  if (!title || !price || !imageFile || !phone)
    return alert("Please fill in all required fields.");
  if (isNaN(parseFloat(price)) || parseFloat(price) <= 0)
    return alert("Enter a valid price.");

  if (type === "Digital" && activePayout === "bank") {
    const acc1 = document.getElementById("seller-acc-1").value.trim();
    const acc2 = document.getElementById("seller-acc-2").value.trim();
    const ifsc = document.getElementById("seller-ifsc").value.trim();
    if (!/^\d{9,18}$/.test(acc1))
      return alert("Account number must be 9–18 digits.");
    if (acc1 !== acc2) return alert("Account numbers do not match.");
    if (!/^[A-Za-z0-9]{11}$/.test(ifsc))
      return alert("IFSC code must be exactly 11 characters.");
  }

  btn.disabled = true;
  const origHtml = btn.innerHTML;
  btn.innerHTML = `<i data-lucide="loader-circle"></i> Listing…`;
  lucide.createIcons();

  try {
    const imgName = `${Date.now()}_img`;
    const { error: imgErr } = await sb.storage
      .from("images")
      .upload(imgName, imageFile);
    if (imgErr) throw imgErr;
    const { data: imgRes } = sb.storage.from("images").getPublicUrl(imgName);

    let pdfUrl = null;
    const pdfFile = document.getElementById("seller-pdf").files[0];
    if (type === "Digital" && pdfFile) {
      const pdfName = `${Date.now()}_pdf`;
      const { error: pdfErr } = await sb.storage
        .from("pdfs")
        .upload(pdfName, pdfFile);
      if (pdfErr) throw pdfErr;
      pdfUrl = sb.storage.from("pdfs").getPublicUrl(pdfName).data.publicUrl;
    }

    const row = {
      seller_id: currentUser.id,
      seller_email: currentUser.email,
      title,
      author,
      type,
      price: parseFloat(price),
      seller_phone: phone,
      image: imgRes.publicUrl,
      pdf: pdfUrl,
      locality:
        type === "Physical"
          ? document.getElementById("seller-locality").value.trim() || null
          : null,
      college:
        type === "Physical"
          ? document.getElementById("seller-college").value.trim() || null
          : null,
      seller_bank_acc:
        type === "Digital" && activePayout === "bank"
          ? document.getElementById("seller-acc-1").value.trim()
          : null,
      seller_ifsc:
        type === "Digital" && activePayout === "bank"
          ? document.getElementById("seller-ifsc").value.trim().toUpperCase()
          : null,
      seller_upi:
        type === "Digital" && activePayout === "upi"
          ? document.getElementById("seller-upi").value.trim()
          : null,
    };

    const { error: insertErr } = await sb.from("products").insert([row]);
    if (insertErr) throw insertErr;

    closeModal("seller-modal");
    document
      .querySelectorAll(
        "#seller-modal input:not([readonly]), #seller-modal select, #seller-modal textarea",
      )
      .forEach((el) => {
        el.value = "";
      });
    await loadProducts();
    updateSellerNavBar();
    alert("Book listed successfully! 🎉");
  } catch (err) {
    alert("Something went wrong: " + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = origHtml;
    lucide.createIcons();
  }
}

// ─── Seller type toggle ───────────────────────────────────────────────────────
function toggleSellerTypeFields() {
  const isDig = document.getElementById("seller-type").value === "Digital";
  const digitalFields = document.getElementById("digital-fields");
  const physicalFields = document.getElementById("physical-fields");
  const payoutSection = document.getElementById("payout-section");

  if (digitalFields) digitalFields.classList.toggle("hidden", !isDig);
  if (physicalFields) physicalFields.classList.toggle("hidden", isDig);
  if (payoutSection) payoutSection.classList.toggle("hidden", !isDig);
}

function setPayoutMethod(method) {
  activePayout = method;
  const tabBank = document.getElementById("tab-bank");
  const tabUpi = document.getElementById("tab-upi");
  const bankFields = document.getElementById("payout-bank-fields");
  const upiFields = document.getElementById("payout-upi-fields");

  if (tabBank) tabBank.classList.toggle("active", method === "bank");
  if (tabUpi) tabUpi.classList.toggle("active", method === "upi");
  if (bankFields) bankFields.classList.toggle("hidden", method !== "bank");
  if (upiFields) upiFields.classList.toggle("hidden", method !== "upi");
}

// ─── Panel / Modal helpers ────────────────────────────────────────────────────
function openPanel(id) {
  ["cart-panel", "library-panel"].forEach((p) => {
    const el = document.getElementById(p);
    if (p !== id && el) closePanel(p);
  });
  const target = document.getElementById(id);
  if (target) {
    target.classList.add("open");
    target.setAttribute("aria-hidden", "false");
  }
  const backdrop = document.getElementById("panel-backdrop");
  if (backdrop) backdrop.classList.add("visible");
}
function closePanel(id) {
  const target = document.getElementById(id);
  if (target) {
    target.classList.remove("open");
    target.setAttribute("aria-hidden", "true");
  }
  const anyOpen = ["cart-panel", "library-panel"].some((p) => {
    const el = document.getElementById(p);
    return el && el.classList.contains("open");
  });
  const backdrop = document.getElementById("panel-backdrop");
  if (!anyOpen && backdrop) backdrop.classList.remove("visible");
}
function togglePanel(id) {
  const target = document.getElementById(id);
  if (target && target.classList.contains("open")) {
    closePanel(id);
  } else {
    openPanel(id);
  }
}
function openModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.remove("hidden");
}
function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.add("hidden");
}

// ─── Event wiring ─────────────────────────────────────────────────────────────
function bindEvents() {
  document.getElementById("product-grid").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const a = btn.dataset.action;
    if (a === "add-cart") addToCart(btn.dataset.id);
    if (a === "buy-now") {
      addToCart(btn.dataset.id);
      checkout();
    }
    if (a === "contact-seller") openContactSeller(btn.dataset);
    if (a === "delete-listing") deleteProduct(btn.dataset.id);
  });

  document.getElementById("library-items").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action='report']");
    if (btn)
      openReportModal(
        btn.dataset.title,
        btn.dataset.sellerUsername,
        btn.dataset.sellerEmail,
      );
  });

  document
    .querySelectorAll(".btn-library-toggle")
    .forEach((b) =>
      b.addEventListener("click", () => togglePanel("library-panel")),
    );
  document
    .querySelectorAll(".btn-cart-toggle")
    .forEach((b) =>
      b.addEventListener("click", () => togglePanel("cart-panel")),
    );

  document.getElementById("cart-items").addEventListener("click", (e) => {
    const b = e.target.closest("[data-action='remove-cart']");
    if (b) removeFromCart(b.dataset.id);
  });

  document.getElementById("panel-backdrop").addEventListener("click", () => {
    closePanel("cart-panel");
    closePanel("library-panel");
  });

  document.getElementById("btn-checkout").addEventListener("click", checkout);

  document
    .getElementById("btn-become-seller")
    .addEventListener("click", () => openModal("seller-modal"));
  document
    .getElementById("btn-close-seller")
    .addEventListener("click", () => closeModal("seller-modal"));
  document
    .getElementById("btn-cancel-seller")
    .addEventListener("click", () => closeModal("seller-modal"));
  document
    .getElementById("btn-submit-seller")
    .addEventListener("click", submitSellerProduct);
  document
    .getElementById("seller-type")
    .addEventListener("change", toggleSellerTypeFields);
  document
    .getElementById("tab-bank")
    .addEventListener("click", () => setPayoutMethod("bank"));
  document
    .getElementById("tab-upi")
    .addEventListener("click", () => setPayoutMethod("upi"));

  document
    .getElementById("btn-close-contact")
    .addEventListener("click", () => closeModal("contact-modal"));

  document
    .getElementById("btn-close-report")
    .addEventListener("click", () => closeModal("report-modal"));
  document
    .getElementById("btn-cancel-report")
    .addEventListener("click", () => closeModal("report-modal"));
  document
    .getElementById("btn-submit-report")
    .addEventListener("click", submitReport);

  document
    .getElementById("btn-close-purchase")
    .addEventListener("click", () => closeModal("purchase-modal"));

  document.getElementById("filter-pills").addEventListener("click", (e) => {
    const pill = e.target.closest(".pill");
    if (!pill) return;
    document
      .querySelectorAll(".pill")
      .forEach((p) => p.classList.remove("active"));
    pill.classList.add("active");
    activeFilter = pill.dataset.filter;
    renderProducts();
  });
  document.getElementById("sort-select").addEventListener("change", (e) => {
    activeSort = e.target.value;
    renderProducts();
  });
  document
    .getElementById("search-input")
    .addEventListener("input", () => renderProducts());

  document.querySelectorAll(".modal-overlay").forEach((overlay) =>
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.classList.add("hidden");
    }),
  );

  toggleSellerTypeFields();
  updateCartUI();
}

// ─── Util ─────────────────────────────────────────────────────────────────────
function escHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
