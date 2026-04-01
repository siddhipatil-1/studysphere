// ===============================
// AUTH (keep your existing logic)
// ===============================

window.supabase = window.supabaseClient;

(async function initDashboard() {
  await window.supabaseClient.auth.getSession();

  // ===============================
  // MAIN CONTENT TARGET
  // ===============================

  const main = document.querySelector(".main");
  const IFRAME_FEATURES = {
    studyai: "../features/studyai/index.html",
  };

  async function loadUser() {
    const { data, error } = await window.supabaseClient.auth.getUser();

    if (error || !data?.user) {
      window.location.href = "../landingpage/landingpage.html";
      return null;
    }

    return data.user;
  }

  //=========================================================USERNAME POPUP================================

  function showUsernamePopup(user) {
    const overlay = document.createElement("div");

    overlay.innerHTML = `
    <div style="
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.65);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 9999;
    ">
      <div style="
        background: #d4c8b8;
        padding: 30px;
        border-radius: 12px;
        width: 320px;
        text-align: center;
        color: black;
        font-family: Manrope;
        box-shadow:0 0 40px rgba(0,0,0,0.3);
      ">
        <h2 style="margin-bottom: 10px;">Choose a Username</h2>
        
        <input 
          id="usernameInput"
          placeholder="username"
          style="
            width: 100%;
            padding: 10px;
            margin-top: 10px;
            border-radius: 8px;
            border: none;
            outline: none;
          "
        />

        <p id="errorMsg" style="color: red; font-size: 12px;"></p>

        <button id="saveUsername"
          style="
            margin-top: 15px;
            padding: 10px 15px;
            border: none;
            border-radius: 8px;
            cursor: pointer;
          "
        >
          Continue
        </button>
      </div>
    </div>
  `;

    document.body.appendChild(overlay);

    const input = overlay.querySelector("#usernameInput");
    const errorMsg = overlay.querySelector("#errorMsg");
    const button = overlay.querySelector("#saveUsername");

    button.addEventListener("click", async () => {
      let username = input.value.trim().toLowerCase();

      if (!username) {
        errorMsg.textContent = "Username cannot be empty";
        return;
      }

      if (username.length < 3) {
        errorMsg.textContent = "Minimum 3 characters";
        return;
      }

      const { data: existing } = await window.supabaseClient
        .from("profiles")
        .select("username")
        .eq("username", username);

      if (existing && existing.length > 0) {
        errorMsg.textContent = "Username already taken";
        return;
      }

      const { error } = await window.supabaseClient.from("profiles").insert([
        {
          id: user.id,
          username: username,
        },
      ]);

      if (error) {
        console.error(error);
        errorMsg.textContent = "Something went wrong";
        return;
      }

      overlay.remove();

      const savedFeature = localStorage.getItem("currentFeature");
      const featureToLoad = savedFeature || "home";

      await startApp(user);
    });
  }

  // =====================================PROFILE AVATAR==================================================
  async function loadUserProfileUI(user) {
    const { data, error } = await window.supabaseClient
      .from("profiles")
      .select("username")
      .eq("id", user.id)
      .single();

    if (error || !data) {
      console.error("Failed to load profile UI", error);
      return;
    }

    const username = data.username;

    const avatar = document.querySelector(".avatar");
    if (avatar) {
      avatar.textContent = username.charAt(0).toUpperCase();
      avatar.style.display = "flex";
      avatar.style.alignItems = "center";
      avatar.style.justifyContent = "center";
      avatar.style.fontWeight = "bolder";
      avatar.style.fontSize = "16px";
    }
  }

  // --==========================================CHECK USER PROFILE====================================================

  async function checkUserProfile(user) {
    const { data, error } = await window.supabaseClient
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .maybeSingle();

    if (error) {
      console.error("Profile fetch error:", error);
      return;
    }

    if (!data) {
      showUsernamePopup(user);
      return false;
    }

    return true;
  }

  const user = await loadUser();
  if (!user) return;

  const hasProfile = await checkUserProfile(user);
  window.notifications = [];

  if (hasProfile) {
    await startApp(user);
  }

  async function loadFeature(feature) {
    try {
      if (IFRAME_FEATURES[feature]) {
        main.innerHTML = `
        <iframe 
          src="${IFRAME_FEATURES[feature]}" 
          style="width:100%; height:100%; border:none;"
        ></iframe>
      `;
        window.activeFeatureModule = null;
        localStorage.setItem("currentFeature", feature);
        return;
      }

      const htmlPath = `../features/${feature}/${feature}.html`;
      const jsPath = `../features/${feature}/${feature}.js`;

      const res = await fetch(htmlPath);
      if (!res.ok) throw new Error("HTML not found");

      main.innerHTML = await res.text();

      const module = await import(jsPath + "?v=" + Date.now());

      window.activeFeatureModule = module;

      if (module.init) {
        await module.init(user);
      }

      localStorage.setItem("currentFeature", feature);
    } catch (err) {
      console.error(err);
      main.innerHTML = `<p style="padding:20px;">Failed to load feature</p>`;
    }
  }

  // ===============================
  // SIDEBAR NAV HANDLING
  // ===============================
  document.querySelectorAll(".nav-item").forEach((item) => {
    item.addEventListener("click", (e) => {
      e.preventDefault();

      const feature = item.dataset.feature;
      if (!feature) return;

      document
        .querySelectorAll(".nav-item")
        .forEach((i) => i.classList.remove("active"));
      item.classList.add("active");

      loadFeature(feature);
    });
  });

  // ===============================
  // INITIAL LOAD
  // ===============================
  const savedFeature = localStorage.getItem("currentFeature");
  const featureToLoad = savedFeature || "home";

  loadFeature(featureToLoad);

  document.querySelectorAll(".nav-item").forEach((item) => {
    if (item.dataset.feature === featureToLoad) {
      item.classList.add("active");
    } else {
      item.classList.remove("active");
    }
  });

  // ===============================
  // NOTIFICATION SYSTEM
  // ===============================

  async function loadNotificationsFromDB() {
    const { data: userData } = await window.supabaseClient.auth.getUser();
    const uid = userData?.user?.id;
    if (!uid) return;

    const { data, error } = await window.supabaseClient
      .from("notifications")
      .select("*")
      .eq("user_id", uid)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Failed to load notifications", error);
      return;
    }

    window.notifications = data || [];

    renderNotificationPanel();
    updateNotificationDot();
  }

  function updateNotificationDot() {
    const dot = document.getElementById("notif-dot");
    if (!dot) return;
    const hasUnread = (window.notifications || []).some((n) => !n.read);
    dot.style.display = hasUnread ? "inline-block" : "none";
  }

  function renderNotificationPanel() {
    const list = document.getElementById("notif-list");
    if (!list) return;

    const notifs = window.notifications || [];

    if (notifs.length === 0) {
      list.innerHTML = `
        <div class="notif-empty">
          <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
          <p>No notifications yet</p>
        </div>`;
      return;
    }

    list.innerHTML = notifs
      .map((n) => {
        const timeStr = formatNotifTime(n.time);
        const unreadClass = n.read ? "" : "notif-item--unread";
        // Pick icon based on source
        const iconSvg = getNotifIcon(n.source);

        return `
        <div class="notif-item ${unreadClass}" data-id="${n.id}">
          <div class="notif-icon-wrap">${iconSvg}</div>
          <div class="notif-body">
            <div class="notif-title">${escapeNotif(n.title)}</div>
            <div class="notif-message">${escapeNotif(n.message)}</div>
            <div class="notif-time">${timeStr}</div>
          </div>
          ${!n.read ? '<div class="notif-unread-dot"></div>' : ""}
        </div>`;
      })
      .join("");
  }

  function getNotifIcon(source) {
    // Simple inline SVGs matching dashboard icon style
    const icons = {
      doubt: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
      kanban: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M15 3v18M3 9h18M3 15h18"/></svg>`,
      group: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
      shop: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>`,
      default: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`,
    };
    return icons[source] || icons.default;
  }

  function formatNotifTime(date) {
    if (!date) return "";
    const diff = Math.floor((new Date() - new Date(date)) / 1000);
    if (diff < 60) return "Just now";
    if (diff < 3600) return Math.floor(diff / 60) + "m ago";
    if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
    return Math.floor(diff / 86400) + "d ago";
  }

  function escapeNotif(str) {
    if (!str) return "";
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  // Global addNotification — called by feature modules
  window.addNotification = async function (notif) {
    const { data: userData } = await window.supabaseClient.auth.getUser();
    const uid = userData?.user?.id;
    if (!uid) return;

    const { error } = await window.supabaseClient.from("notifications").insert([
      {
        user_id: uid,
        title: notif.title,
        message: notif.message,
        source: notif.source || "default",
        read: false,
      },
    ]);

    if (error) {
      console.error("Notification insert failed", error);
      return;
    }

    // Reload from DB
    await loadNotificationsFromDB();
  };

  // ── Bell button toggle ──
  const bell = document.querySelector(".icon-btn");
  const panel = document.getElementById("notif-panel");
  if (bell && panel) {
    bell.addEventListener("click", async (e) => {
      e.stopPropagation();

      const isOpen = panel.classList.contains("notif-panel--open");

      if (isOpen) {
        panel.classList.remove("notif-panel--open");
      } else {
        const unreadIds = window.notifications
          .filter((n) => !n.read)
          .map((n) => n.id);

        if (unreadIds.length > 0) {
          await window.supabaseClient
            .from("notifications")
            .update({ read: true })
            .in("id", unreadIds);
        }

        await loadNotificationsFromDB();

        panel.classList.add("notif-panel--open");
      }
    });
  }

  document.addEventListener("click", (e) => {
    if (!panel) return;

    const clickedInsidePanel = panel.contains(e.target);
    const clickedBell = bell && bell.contains(e.target);

    if (!clickedInsidePanel && !clickedBell) {
      panel.classList.remove("notif-panel--open");
    }
  });

  // Clear all button
  const clearBtn = document.getElementById("notif-clear-btn");
  if (clearBtn) {
    clearBtn.addEventListener("click", async () => {
      // ✅ MAKE ASYNC
      const { data: userData } = await window.supabaseClient.auth.getUser();
      const uid = userData?.user?.id;

      if (!uid) return;

      await window.supabaseClient
        .from("notifications")
        .delete()
        .eq("user_id", uid);

      await loadNotificationsFromDB();
    });
  }

  // Initial render
  renderNotificationPanel();
  updateNotificationDot();

  // ── Persistent realtime listeners (dashboard-level) ──────────────────────
  //
  // These run in the dashboard tab itself so notifications work regardless
  // of which feature is open — or whether the shop is in another tab.
  //
  // SHOP SALES: watches the `purchases` table directly via postgres_changes.
  //   When a new row appears whose product belongs to the current user,
  //   we fire an in-dashboard notification. No cross-tab broadcast needed.
  //
  // GROUP EVENTS: the personal broadcast channel handles join_request and
  //   member_status sent by group.js in any other browser session.
  //
  async function setupDashboardRealtime() {
    const { data: userData } = await window.supabaseClient.auth.getUser();
    const uid = userData?.user?.id;
    if (!uid) return;

    // ── 1. Shop sales — postgres_changes on purchases ─────────────────────
    // This fires in THIS tab whenever any purchase row is inserted.
    // We then fetch the product to check if we are the seller.
    window.supabaseClient
      .channel("dashboard_purchases_watch")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "purchases" },
        async (payload) => {
          const purchase = payload.new;

          // Look up the product to find the seller
          const { data: product, error } = await window.supabaseClient
            .from("products")
            .select("seller_id, title")
            .eq("id", purchase.product_id)
            .single();

          if (error || !product) return;

          // Only notify if WE are the seller
          if (product.seller_id !== uid) return;

          window.addNotification({
            source: "shop",
            title: "📚 Book Sold!",
            message: `Your book "${product.title}" was just purchased.`,
          });
        },
      )
      .subscribe((status) => {
        console.log("[Dashboard] purchases channel status:", status);
      });

    // ── 2. Group events — personal broadcast channel ───────────────────────
    // group.js sends targeted broadcasts to "user_notif_{uid}" when:
    //   • someone requests to join a group you own  → "join_request"
    //   • you were approved or rejected             → "member_status"
    // Subscribing here means these work even when Groups isn't loaded.
    window.supabaseClient
      .channel(`user_notif_${uid}`)
      .on("broadcast", { event: "join_request" }, (msg) => {
        const { groupTitle, requesterUsername } = msg.payload || {};
        window.addNotification({
          source: "group",
          title: "📥 New Join Request",
          message: `${requesterUsername} wants to join "${groupTitle}"`,
        });
      })
      .on("broadcast", { event: "member_status" }, (msg) => {
        const { groupTitle, status } = msg.payload || {};
        window.addNotification({
          source: "group",
          title:
            status === "approved"
              ? "✅ Join Request Approved"
              : "❌ Join Request Rejected",
          message:
            status === "approved"
              ? `You were accepted into "${groupTitle}"`
              : `You were not accepted into "${groupTitle}"`,
        });
      })
      .subscribe();
  }
  setupDashboardRealtime();

  // ===================DAILY STREAKS======================
  async function logDailyActivity(user) {
    const today = new Date().toISOString().split("T")[0];

    // check if already logged today
    const { data } = await window.supabaseClient
      .from("user_activity")
      .select("id")
      .eq("user_id", user.id)
      .eq("activity_date", today)
      .maybeSingle();

    if (data) return; // already logged today

    // insert new activity
    await window.supabaseClient.from("user_activity").insert([
      {
        user_id: user.id,
        activity_date: today,
      },
    ]);
  }

  // ==============POST USERNAME RELOAD======================

  async function startApp(user) {
    await logDailyActivity(user);
    await loadUserProfileUI(user);

    const savedFeature = localStorage.getItem("currentFeature");
    const featureToLoad = savedFeature || "home";

    await loadFeature(featureToLoad);
    await loadNotificationsFromDB();

    updateNotificationDot();
  }

  // ===============================
  // LOGOUT
  // ===============================
  document.getElementById("logoutBtn").addEventListener("click", async () => {
    await window.supabaseClient.auth.signOut();
    window.location.href = "../landingpage/landingpage.html";
  });

  // ===============================
  // CLEAN UNIVERSAL SEARCH
  // ===============================

  const searchInput = document.querySelector(".topbar-search input");

  if (searchInput) {
    let debounce;

    searchInput.addEventListener("input", (e) => {
      const query = e.target.value.trim().toLowerCase();

      clearTimeout(debounce);

      debounce = setTimeout(() => {
        const currentFeature = localStorage.getItem("currentFeature");

        if (currentFeature === "notes" && window.activeFeatureModule?.search) {
          window.activeFeatureModule.search(query);
        } else if (
          currentFeature === "subjectbank" &&
          window.sb?.performSearch
        ) {
          window.sb.performSearch(query);
        } else if (
          currentFeature === "doubt" &&
          window.activeFeatureModule?.search
        ) {
          window.activeFeatureModule.search(query);
        } else if (
          currentFeature === "group" &&
          window.activeFeatureModule?.search
        ) {
          window.activeFeatureModule.search(query);
        }
      }, 250);
    });
  }
})();

/* ════════════════════════════════════════════════════════════
   MOBILE RESPONSIVE UI
   Handles: drawer open/close, bottom nav delegation,
            search bar toggle, active-state sync.

   All feature loading is delegated to the existing sidebar
   .nav-item click handlers above — nothing here duplicates
   any feature or auth logic.
════════════════════════════════════════════════════════════ */
(function initMobileUI() {
  // ── Drawer ────────────────────────────────────────────────
  const moreBtn = document.getElementById("mobileMoreBtn");
  const drawer = document.getElementById("mobileDrawer");
  const overlay = document.getElementById("mobileDrawerOverlay");
  const closeBtn = document.getElementById("mobileDrawerClose");

  function openDrawer() {
    if (!drawer || !overlay) return;
    drawer.classList.add("mobile-drawer--open");
    overlay.classList.add("mobile-drawer-overlay--open");
    document.body.style.overflow = "hidden";
  }

  function closeDrawer() {
    if (!drawer || !overlay) return;
    drawer.classList.remove("mobile-drawer--open");
    overlay.classList.remove("mobile-drawer-overlay--open");
    document.body.style.overflow = "";
  }

  if (moreBtn) moreBtn.addEventListener("click", openDrawer);
  if (closeBtn) closeBtn.addEventListener("click", closeDrawer);
  if (overlay) overlay.addEventListener("click", closeDrawer);

  // ── Drawer nav items → delegate to sidebar nav items ─────
  // The sidebar .nav-item elements already have the feature-load
  // event listeners from initDashboard() above. We just click them.
  document
    .querySelectorAll(".mobile-drawer-nav .nav-item")
    .forEach(function (item) {
      item.addEventListener("click", function (e) {
        e.preventDefault();
        closeDrawer();
        var feature = item.dataset.feature;
        if (!feature) return;
        var target = document.querySelector(
          ".sidebar .nav-item[data-feature='" + feature + "']",
        );
        if (target) target.click();
      });
    });

  // ── Bottom nav items → delegate to sidebar nav items ─────
  document
    .querySelectorAll(".mobile-bottom-nav .mob-nav-item[data-feature]")
    .forEach(function (item) {
      item.addEventListener("click", function (e) {
        e.preventDefault();
        var feature = item.dataset.feature;
        if (!feature) return;
        var target = document.querySelector(
          ".sidebar .nav-item[data-feature='" + feature + "']",
        );
        if (target) target.click();
      });
    });

  // ── Drawer logout → delegates to main logout button ──────
  var logoutDrawer = document.getElementById("logoutBtnDrawer");
  if (logoutDrawer) {
    logoutDrawer.addEventListener("click", function (e) {
      e.preventDefault();
      closeDrawer();
      var mainLogout = document.getElementById("logoutBtn");
      if (mainLogout) mainLogout.click();
    });
  }

  // ── Sync bottom nav active state with sidebar ─────────────
  // Watches for class changes on sidebar nav items (set by the
  // existing initDashboard listener) and mirrors them on the bottom nav.
  var sidebarNav = document.querySelector(".sidebar-nav");
  if (sidebarNav) {
    var activeObserver = new MutationObserver(function () {
      var activeSidebarItem = document.querySelector(
        ".sidebar .nav-item.active",
      );
      var activeFeature = activeSidebarItem
        ? activeSidebarItem.dataset.feature
        : "";
      document
        .querySelectorAll(".mob-nav-item[data-feature]")
        .forEach(function (btn) {
          btn.classList.toggle("active", btn.dataset.feature === activeFeature);
        });
    });
    activeObserver.observe(sidebarNav, {
      attributes: true,
      subtree: true,
      attributeFilter: ["class"],
    });
  }

  // ── Mobile search bar toggle ──────────────────────────────
  var topbar = document.querySelector(".topbar");
  var searchToggle = document.getElementById("searchToggleBtn");
  var searchClose = document.getElementById("searchCloseBtn");
  var searchInput = document.querySelector("#topbarSearch input");

  function openSearch() {
    if (!topbar) return;
    topbar.classList.add("search-open");
    if (searchInput) searchInput.focus();
  }

  function closeSearch() {
    if (!topbar) return;
    topbar.classList.remove("search-open");
    if (searchInput) searchInput.value = "";
    // Fire an input event so the existing search debounce clears any active filter
    if (searchInput) searchInput.dispatchEvent(new Event("input"));
  }

  if (searchToggle) searchToggle.addEventListener("click", openSearch);
  if (searchClose) searchClose.addEventListener("click", closeSearch);
})();
