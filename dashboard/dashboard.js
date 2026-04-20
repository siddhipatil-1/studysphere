// Alias supabaseClient to window.supabase so feature modules can use either name
window.supabase = window.supabaseClient;

// Remove the FOUC guard once the page is fully loaded
window.addEventListener("load", () => {
  document.body.classList.add("loaded");
});

// ─── MAIN DASHBOARD LOGIC ────────────────────────────────────────────────────
(async function initDashboard() {
  // Warm up the auth session before doing anything else
  await window.supabaseClient.auth.getSession();

  const main = document.querySelector(".main");

  // Features that load inside an iframe instead of the normal HTML+JS injection
  const IFRAME_FEATURES = {
    studyai: "../features/studyai/index.html",
  };

  // ── Auth ──────────────────────────────────────────────────────────────────

  // Fetch the logged-in user; redirect to landing page if none found
  async function loadUser() {
    const { data, error } = await window.supabaseClient.auth.getUser();
    if (error || !data?.user) {
      window.location.href = "/landingpage/";
      return null;
    }
    return data.user;
  }

  // ── Username setup popup ──────────────────────────────────────────────────

  // Shown to new users who don't have a profile row yet.
  // Validates the input, checks for uniqueness, then inserts the profile.
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
          style="width:100%;padding:10px;margin-top:10px;border-radius:8px;border:none;outline:none;"
        />
        <p id="errorMsg" style="color:red;font-size:12px;"></p>
        <button id="saveUsername"
          style="margin-top:15px;padding:10px 15px;border:none;border-radius:8px;cursor:pointer;"
        >Continue</button>
      </div>
    </div>`;

    document.body.appendChild(overlay);

    const input = overlay.querySelector("#usernameInput");
    const errorMsg = overlay.querySelector("#errorMsg");
    const button = overlay.querySelector("#saveUsername");

    button.addEventListener("click", async () => {
      const username = input.value.trim().toLowerCase();

      if (!username) {
        errorMsg.textContent = "Username cannot be empty";
        return;
      }
      if (username.length < 3) {
        errorMsg.textContent = "Minimum 3 characters";
        return;
      }

      // Make sure no one else already has this username
      const { data: existing } = await window.supabaseClient
        .from("profiles")
        .select("username")
        .eq("username", username);

      if (existing && existing.length > 0) {
        errorMsg.textContent = "Username already taken";
        return;
      }

      const { error } = await window.supabaseClient
        .from("profiles")
        .insert([{ id: user.id, username }]);

      if (error) {
        console.error(error);
        errorMsg.textContent = "Something went wrong";
        return;
      }

      overlay.remove();
      await startApp(user);
    });
  }

  // ── Avatar ────────────────────────────────────────────────────────────────

  // Loads the user's username and puts the first letter into the avatar circle
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

    const avatar = document.querySelector(".avatar");
    if (avatar) {
      avatar.textContent = data.username.charAt(0).toUpperCase();
      avatar.style.cssText +=
        "display:flex;align-items:center;justify-content:center;font-weight:bolder;font-size:16px;";
    }
  }

  // ── Profile check ─────────────────────────────────────────────────────────

  // Returns true if the user already has a profile row.
  // If not, shows the username popup and returns false.
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

  // ── Boot sequence ─────────────────────────────────────────────────────────

  const user = await loadUser();
  if (!user) return;

  window.notifications = [];
  const hasProfile = await checkUserProfile(user);

  if (hasProfile) {
    await startApp(user);
  }

  // ── Feature loader ────────────────────────────────────────────────────────

  // Loads a feature into the main content area.
  // iframe-based features just get injected as an <iframe>.
  // All others fetch their HTML, inject it, then dynamically import their JS module.
  async function loadFeature(feature) {
    try {
      if (IFRAME_FEATURES[feature]) {
        main.innerHTML = `<iframe src="${IFRAME_FEATURES[feature]}" style="width:100%;height:100%;border:none;"></iframe>`;
        window.activeFeatureModule = null;
        localStorage.setItem("currentFeature", feature);
        return;
      }

      const htmlPath = `/features/${feature}/${feature}.html`;
      const jsPath = `/features/${feature}/${feature}.js`;

      const res = await fetch(htmlPath);
      if (!res.ok) throw new Error("HTML not found");

      main.innerHTML = await res.text();

      // Cache-bust the module import so re-navigating always gets fresh code
      const module = await import(jsPath + "?v=" + Date.now());
      window.activeFeatureModule = module;

      if (module.init) await module.init(user);

      localStorage.setItem("currentFeature", feature);
    } catch (err) {
      console.error(err);
      main.innerHTML = `<p style="padding:20px;">Failed to load feature</p>`;
    }
  }

  // ── Sidebar nav ───────────────────────────────────────────────────────────

  // On every sidebar link click: clear active state on all items,
  // mark the clicked one active, then load that feature
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

  // ── Initial page load ─────────────────────────────────────────────────────

  // Re-open whichever feature the user was last on (or "home" by default)
  const featureToLoad = localStorage.getItem("currentFeature") || "home";
  loadFeature(featureToLoad);

  // Sync the sidebar active state to match the loaded feature
  document.querySelectorAll(".nav-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.feature === featureToLoad);
  });

  // ── Notifications ─────────────────────────────────────────────────────────

  // Fetches all notifications for the current user, newest first,
  // then re-renders the panel and the unread dot
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

  // Show or hide the red dot on the bell icon based on unread count
  function updateNotificationDot() {
    const dot = document.getElementById("notif-dot");
    if (!dot) return;
    const hasUnread = (window.notifications || []).some((n) => !n.read);
    dot.style.display = hasUnread ? "inline-block" : "none";
  }

  // Rebuilds the notification list HTML from window.notifications
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
      .map(
        (n) => `
      <div class="notif-item ${n.read ? "" : "notif-item--unread"}" data-id="${n.id}">
        <div class="notif-icon-wrap">${getNotifIcon(n.source)}</div>
        <div class="notif-body">
          <div class="notif-title">${escapeNotif(n.title)}</div>
          <div class="notif-message">${escapeNotif(n.message)}</div>
          <div class="notif-time">${formatNotifTime(n.time)}</div>
        </div>
        ${!n.read ? '<div class="notif-unread-dot"></div>' : ""}
      </div>`,
      )
      .join("");
  }

  // Returns an inline SVG icon matched to the notification's source feature
  function getNotifIcon(source) {
    const icons = {
      doubt: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
      kanban: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M15 3v18M3 9h18M3 15h18"/></svg>`,
      group: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
      shop: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>`,
      default: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`,
    };
    return icons[source] || icons.default;
  }

  // Converts a timestamp into a human-readable "Xm ago" / "Xh ago" string
  function formatNotifTime(date) {
    if (!date) return "";
    const diff = Math.floor((new Date() - new Date(date)) / 1000);
    if (diff < 60) return "Just now";
    if (diff < 3600) return Math.floor(diff / 60) + "m ago";
    if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
    return Math.floor(diff / 86400) + "d ago";
  }

  // Safely escapes HTML special characters before injecting into the DOM
  function escapeNotif(str) {
    if (!str) return "";
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  // Global function any feature module can call to push a new notification.
  // Inserts the row into Supabase then refreshes the panel.
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

    await loadNotificationsFromDB();
  };

  // ── Bell button ───────────────────────────────────────────────────────────

  const bell = document.querySelector(".icon-btn");
  const panel = document.getElementById("notif-panel");

  if (bell && panel) {
    bell.addEventListener("click", async (e) => {
      e.stopPropagation();
      const isOpen = panel.classList.contains("notif-panel--open");

      if (isOpen) {
        panel.classList.remove("notif-panel--open");
      } else {
        // Mark all unread notifications as read when the panel opens
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

  // Close the panel when the user clicks anywhere outside it
  document.addEventListener("click", (e) => {
    if (!panel) return;
    if (!panel.contains(e.target) && !(bell && bell.contains(e.target))) {
      panel.classList.remove("notif-panel--open");
    }
  });

  // Delete all notifications for this user from the DB, then re-render
  const clearBtn = document.getElementById("notif-clear-btn");
  if (clearBtn) {
    clearBtn.addEventListener("click", async () => {
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

  // Render the panel once on load (before any DB fetch completes)
  renderNotificationPanel();
  updateNotificationDot();

  // ── Realtime listeners ────────────────────────────────────────────────────

  // These are set up at the dashboard level so they keep working regardless
  // of which feature the user currently has open.
  async function setupDashboardRealtime() {
    const { data: userData } = await window.supabaseClient.auth.getUser();
    const uid = userData?.user?.id;
    if (!uid) return;

    // Watch the purchases table. When a new purchase comes in,
    // look up the product and notify the user only if they are the seller.
    window.supabaseClient
      .channel("dashboard_purchases_watch")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "purchases" },
        async (payload) => {
          const { data: product, error } = await window.supabaseClient
            .from("products")
            .select("seller_id, title")
            .eq("id", payload.new.product_id)
            .single();

          if (error || !product || product.seller_id !== uid) return;

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

    // Listen for group events that group.js broadcasts to this user's personal channel.
    // join_request  → someone wants to join a group the current user owns
    // member_status → the current user's own join request was approved or rejected
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

  // ── Daily activity streak ─────────────────────────────────────────────────

  // Inserts one row per calendar day per user to track login streaks.
  // Does nothing if today's row already exists.
  async function logDailyActivity(user) {
    const today = new Date().toISOString().split("T")[0];

    const { data } = await window.supabaseClient
      .from("user_activity")
      .select("id")
      .eq("user_id", user.id)
      .eq("activity_date", today)
      .maybeSingle();

    if (data) return;

    await window.supabaseClient.from("user_activity").insert([
      {
        user_id: user.id,
        activity_date: today,
      },
    ]);
  }

  // ── App start ─────────────────────────────────────────────────────────────

  // Called once the user is confirmed to have a profile.
  // Runs all the startup tasks in order.
  async function startApp(user) {
    await logDailyActivity(user);
    await loadUserProfileUI(user);
    await loadFeature(localStorage.getItem("currentFeature") || "home");
    await loadNotificationsFromDB();
    updateNotificationDot();
  }

  // ── Logout ────────────────────────────────────────────────────────────────

  document.getElementById("logoutBtn").addEventListener("click", async () => {
    await window.supabaseClient.auth.signOut();
    window.location.href = "/";
  });

  // ── Universal search ──────────────────────────────────────────────────────

  // Debounces the search input and delegates the query to whichever
  // feature is currently active (each feature exposes its own search fn)
  const searchInput = document.querySelector(".topbar-search input");

  if (searchInput) {
    let debounce;

    searchInput.addEventListener("input", (e) => {
      const query = e.target.value.trim().toLowerCase();
      clearTimeout(debounce);

      debounce = setTimeout(() => {
        const current = localStorage.getItem("currentFeature");

        if (current === "notes" && window.activeFeatureModule?.search)
          window.activeFeatureModule.search(query);
        if (current === "subjectbank" && window.sb?.performSearch)
          window.sb.performSearch(query);
        if (current === "doubt" && window.activeFeatureModule?.search)
          window.activeFeatureModule.search(query);
        if (current === "group" && window.activeFeatureModule?.search)
          window.activeFeatureModule.search(query);
      }, 250);
    });
  }
})();

// ─── MOBILE UI ───────────────────────────────────────────────────────────────
// Handles the slide-up drawer, bottom nav, search toggle, and active-state sync.
// Feature loading is always delegated to the sidebar nav items above —
// nothing here touches auth or data.
(function initMobileUI() {
  // ── Drawer open / close ───────────────────────────────────────────────────

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

  // ── Delegate nav clicks to the sidebar ───────────────────────────────────

  // Both the drawer nav and the bottom nav just click the matching
  // sidebar item, which already has all the feature-loading logic attached.
  function delegateNavTo(selector) {
    document.querySelectorAll(selector).forEach((item) => {
      item.addEventListener("click", (e) => {
        e.preventDefault();
        closeDrawer();
        const feature = item.dataset.feature;
        if (!feature) return;
        const target = document.querySelector(
          `.sidebar .nav-item[data-feature='${feature}']`,
        );
        if (target) target.click();
      });
    });
  }

  delegateNavTo(".mobile-drawer-nav .nav-item");
  delegateNavTo(".mobile-bottom-nav .mob-nav-item[data-feature]");

  // ── Drawer logout ─────────────────────────────────────────────────────────

  const logoutDrawer = document.getElementById("logoutBtnDrawer");
  if (logoutDrawer) {
    logoutDrawer.addEventListener("click", (e) => {
      e.preventDefault();
      closeDrawer();
      document.getElementById("logoutBtn")?.click();
    });
  }

  // ── Sync bottom nav active state ──────────────────────────────────────────

  // Watches the sidebar for active-class changes and mirrors them
  // on the bottom nav buttons so both always agree
  const sidebarNav = document.querySelector(".sidebar-nav");
  if (sidebarNav) {
    new MutationObserver(() => {
      const activeFeature =
        document.querySelector(".sidebar .nav-item.active")?.dataset.feature ||
        "";
      document
        .querySelectorAll(".mob-nav-item[data-feature]")
        .forEach((btn) => {
          btn.classList.toggle("active", btn.dataset.feature === activeFeature);
        });
    }).observe(sidebarNav, {
      attributes: true,
      subtree: true,
      attributeFilter: ["class"],
    });
  }

  // ── Mobile search toggle ──────────────────────────────────────────────────

  const topbar = document.querySelector(".topbar");
  const searchToggle = document.getElementById("searchToggleBtn");
  const searchClose = document.getElementById("searchCloseBtn");
  const searchInput = document.querySelector("#topbarSearch input");

  function openSearch() {
    if (!topbar) return;
    topbar.classList.add("search-open");
    searchInput?.focus();
  }

  function closeSearch() {
    if (!topbar) return;
    topbar.classList.remove("search-open");
    if (searchInput) {
      searchInput.value = "";
      // Trigger the search debounce with an empty query to clear any active filter
      searchInput.dispatchEvent(new Event("input"));
    }
  }

  if (searchToggle) searchToggle.addEventListener("click", openSearch);
  if (searchClose) searchClose.addEventListener("click", closeSearch);
})();
