/* ============================================================
   HOME — main entry point
   Handles: greeting, streak, due-soon kanban, stats skeleton
   ============================================================ */

const AFFIRMATIONS = [
  "Every page you read today is an investment in tomorrow.",
  "You don't have to be perfect. You just have to keep going.",
  "Small steps every day lead to big results.",
  "Your curiosity is your greatest asset.",
  "Rest if you must, but don't quit.",
  "One focused hour beats five distracted ones.",
  "Growth happens just outside your comfort zone.",
  "You've handled hard things before. Today is no different.",
  "Consistency is more powerful than intensity.",
  "The best time to study was yesterday. The next best time is now.",
  "Difficult roads often lead to beautiful destinations.",
  "Your effort today is your grade tomorrow.",
  "Be patient with yourself. Learning takes time.",
  "Progress, not perfection.",
  "Every expert was once a beginner.",
];

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/* ── Public entry point ─────────────────────────────────────── */

export async function init(user) {
  renderGreetingShell();
  fetchUsername(user);

  await Promise.all([
    renderStreak(user),
    renderDueSoon(user),
    fetchNotesCount(user),
    fetchDoubtsCount(user),
    fetchTasksDone(user),
    fetchEarnings(user), // 👈 ADD THIS LINE ONLY
  ]);
}

/* ============================================================
   GREETING SHELL  (no network — instant)
   ============================================================ */

function renderGreetingShell() {
  const now = new Date();
  const hour = now.getHours();
  const greeting =
    hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  const dateEl = document.getElementById("homeDate");
  if (dateEl) {
    dateEl.textContent = `${DAYS[now.getDay()]}, ${now.getDate()} ${MONTHS[now.getMonth()]} ${now.getFullYear()}`;
  }

  const welcomeEl = document.getElementById("welcomeText");
  if (welcomeEl) welcomeEl.textContent = `${greeting}!`;

  const affEl = document.getElementById("homeAffirmation");
  if (affEl) {
    const dayOfYear = Math.floor(
      (now - new Date(now.getFullYear(), 0, 0)) / 86_400_000,
    );
    affEl.textContent = `"${AFFIRMATIONS[dayOfYear % AFFIRMATIONS.length]}"`;
  }
}

/* ============================================================
   USERNAME FETCH
   ============================================================ */

function fetchUsername(user) {
  const welcomeEl = document.getElementById("welcomeText");
  if (!welcomeEl) return;

  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  window.supabaseClient
    .from("profiles")
    .select("username")
    .eq("id", user.id)
    .single()
    .then(({ data }) => {
      if (data?.username) {
        welcomeEl.textContent = `${greeting}, ${data.username}!`;
      }
    });
}

/* ============================================================
   STREAK
   ============================================================ */

async function renderStreak(user) {
  const countEl = document.getElementById("homeStreakCount");
  const weekEl = document.getElementById("homeStreakWeek");
  if (!countEl || !weekEl) return;

  const today = new Date();
  const sevenAgo = new Date(today);
  sevenAgo.setDate(today.getDate() - 6);

  // REPLACE "user_activity" with your actual table name.
  // Needs columns: user_id (uuid), activity_date (date)
  const { data: activityRows } = await window.supabaseClient
    .from("user_activity")
    .select("activity_date")
    .eq("user_id", user.id)
    .gte("activity_date", sevenAgo.toISOString().split("T")[0])
    .lte("activity_date", today.toISOString().split("T")[0]);

  const activeDates = new Set((activityRows || []).map((r) => r.activity_date));

  // Count consecutive days ending today
  let streak = 0;
  const cursor = new Date(today);
  while (true) {
    const key = cursor.toISOString().split("T")[0];
    if (activeDates.has(key)) {
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    } else break;
  }

  countEl.textContent = streak;

  // Weekly dots
  weekEl.innerHTML = "";
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const key = d.toISOString().split("T")[0];
    const isToday = i === 0;
    const isDone = activeDates.has(key) && !isToday;

    const wrap = document.createElement("div");
    wrap.className = "home-streak-day";

    const dot = document.createElement("div");
    dot.className =
      "home-streak-dot" + (isToday ? " today" : isDone ? " done" : "");

    const lbl = document.createElement("span");
    lbl.className = "home-streak-daylabel";
    lbl.textContent = DAYS[d.getDay()][0];

    wrap.appendChild(dot);
    wrap.appendChild(lbl);
    weekEl.appendChild(wrap);
  }
}

/* ============================================================
   DUE SOON — KANBAN
   Reads from kanban_boards (same table kanban.js writes to).
   Collects ALL tasks with deadlines across ALL boards,
   sorts by urgency, and renders them.
   ============================================================ */

/**
 * Returns days until a YYYY-MM-DD date string.
 * Negative = overdue.
 */
function daysUntil(dateStr) {
  if (!dateStr) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr + "T00:00:00");
  return Math.round((target - today) / 86_400_000);
}

/**
 * Maps daysUntil value to a urgency tier.
 * Mirrors the logic in kanban.js exactly.
 */
function urgencyTier(days) {
  if (days === null) return null;
  if (days < 0)
    return { cls: "red", label: `Overdue ${Math.abs(days)}d`, order: 0 };
  if (days === 0) return { cls: "red", label: "Due today", order: 1 };
  if (days <= 3) return { cls: "red", label: `${days}d left`, order: 2 };
  if (days <= 6) return { cls: "orange", label: `${days}d left`, order: 3 };
  if (days <= 9) return { cls: "green", label: `${days}d left`, order: 4 };
  return { cls: "neutral", label: `${days}d left`, order: 5 };
}

function formatDateShort(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

async function renderDueSoon(user) {
  const listEl = document.getElementById("homeDueSoonList");
  const subEl = document.getElementById("homeDueSoonSub");
  if (!listEl) return;

  // Fetch all boards for this user
  const { data: boards, error } = await window.supabaseClient
    .from("kanban_boards")
    .select("name, data")
    .eq("user_id", user.id);

  // Clear skeleton loader
  listEl.innerHTML = "";

  if (error || !boards || boards.length === 0) {
    listEl.innerHTML = `
      <div class="home-duesoon-empty">
        <span class="home-duesoon-empty-icon">📋</span>
        <p>No boards yet.<br>Create one in the Kanban board.</p>
      </div>`;
    return;
  }

  // Flatten all tasks that have a deadline from all boards & columns
  const allTasks = [];

  boards.forEach((board) => {
    const columns = board.data; // array of { title, tasks: [{text, deadline}] }
    if (!Array.isArray(columns)) return;

    columns.forEach((col) => {
      if (!Array.isArray(col.tasks)) return;

      col.tasks.forEach((task) => {
        // Support legacy string tasks (same guard as kanban.js)
        const taskObj =
          typeof task === "string" ? { text: task, deadline: null } : task;

        if (!taskObj.deadline) return; // skip tasks with no deadline

        const days = daysUntil(taskObj.deadline);
        const tier = urgencyTier(days);
        if (!tier) return;

        // Only show tasks that aren't ridiculously far away (>14 days = skip)
        // Adjust this threshold to taste
        if (days > 14) return;

        allTasks.push({
          text: taskObj.text,
          deadline: taskObj.deadline,
          board: board.name,
          col: col.title,
          days,
          tier,
        });
      });
    });
  });

  if (allTasks.length === 0) {
    listEl.innerHTML = `
      <div class="home-duesoon-empty">
        <span class="home-duesoon-empty-icon">✅</span>
        <p>No upcoming deadlines.<br>You're all caught up!</p>
      </div>`;
    if (subEl) subEl.textContent = "across all boards";
    return;
  }

  // Sort: most urgent first (order ASC), then by actual date
  allTasks.sort((a, b) =>
    a.tier.order !== b.tier.order
      ? a.tier.order - b.tier.order
      : new Date(a.deadline) - new Date(b.deadline),
  );

  // Update subtitle with total count
  if (subEl) {
    const boardCount = new Set(allTasks.map((t) => t.board)).size;
    subEl.textContent = `${allTasks.length} task${allTasks.length !== 1 ? "s" : ""} across ${boardCount} board${boardCount !== 1 ? "s" : ""}`;
  }

  // Render task rows
  allTasks.forEach((task) => {
    const row = document.createElement("div");
    row.className = "home-task-row";

    row.innerHTML = `
      <div class="home-task-urgency ${task.tier.cls}"></div>
      <div class="home-task-body">
        <span class="home-task-text">${escapeHtml(task.text)}</span>
        <div class="home-task-meta">
          <span class="home-task-board" title="${escapeHtml(task.board)}">${escapeHtml(task.board)}</span>
          <span class="home-task-separator">·</span>
          <span>${escapeHtml(task.col)}</span>
        </div>
      </div>
      <span class="home-task-due ${task.tier.cls}">${formatDateShort(task.deadline)} · ${task.tier.label}</span>
    `;

    listEl.appendChild(row);
  });
}

/* ============================================================
   STATS THIS WEEK
   Uncomment and wire up once your tables are ready.
   Each function sets the tile value and removes the shimmer.
   ============================================================ */

async function fetchStats(user) {
  const weekStart = getWeekStart(); // returns ISO date string

  // ── Notes saved this week ─────────────────────────────────
  // Adjust table/column names to match your schema
  window.supabaseClient
    .from("notes")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .gte("created_at", weekStart)
    .then(({ count }) => setStat("statNotes", count ?? 0));

  // ── Tasks completed this week ─────────────────────────────
  // This depends on your kanban schema. If you track completion
  // via a "done" column name or a separate flag, adjust below.
  // Example: count tasks moved to any column named "Done"/"Completed"
  window.supabaseClient
    .from("kanban_boards")
    .select("data")
    .eq("user_id", user.id)
    .then(({ data: boards }) => {
      let count = 0;
      (boards || []).forEach((b) => {
        (b.data || []).forEach((col) => {
          const name = (col.title || "").toLowerCase();
          if (name === "done" || name === "completed" || name === "finished") {
            count += (col.tasks || []).length;
          }
        });
      });
      setStat("statTasks", count);
    });

  // ── Earnings this week ────────────────────────────────────
  // Adjust to your shop/orders table and amount column
  window.supabaseClient
    .from("orders")
    .select("amount")
    .eq("seller_id", user.id)
    .gte("created_at", weekStart)
    .then(({ data: rows }) => {
      const total = (rows || []).reduce((s, r) => s + (r.amount || 0), 0);
      setStat("statEarnings", "₹" + total.toLocaleString("en-IN"));
    });

  // ── Doubts posted this week ───────────────────────────────
  window.supabaseClient
    .from("doubts")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .gte("created_at", weekStart)
    .then(({ count }) => setStat("statDoubts", count ?? 0));
}

function getWeekStart() {
  const d = new Date();
  const day = d.getDay(); // 0 = Sun
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function setStat(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = value;
  // Remove shimmer from parent tile
  el.closest(".home-stat-tile")?.classList.add("loaded");
}

async function fetchNotesCount(user) {
  try {
    const { count, error } = await window.supabaseClient
      .from("notes")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id);

    if (error) throw error;

    const el = document.getElementById("statNotes");
    if (el) {
      el.textContent = count ?? 0;

      // remove shimmer
      const tile = el.closest(".home-stat-tile");
      if (tile) tile.classList.add("loaded");
    }
  } catch (err) {
    console.error("Error fetching notes count:", err);
  }
}

async function fetchDoubtsCount(user) {
  try {
    const { count, error } = await window.supabaseClient
      .from("questions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id);

    if (error) throw error;

    const el = document.getElementById("statDoubts");
    if (el) {
      el.textContent = count ?? 0;

      // remove shimmer
      const tile = el.closest(".home-stat-tile");
      if (tile) tile.classList.add("loaded");
    }
  } catch (err) {
    console.error("Error fetching doubts count:", err);
  }
}

async function fetchTasksDone(user) {
  try {
    const { data: boards, error } = await window.supabaseClient
      .from("kanban_boards")
      .select("data")
      .eq("user_id", user.id);

    if (error) throw error;

    let count = 0;

    (boards || []).forEach((board) => {
      (board.data || []).forEach((col) => {
        (col.tasks || []).forEach((task) => {
          // Handle old + new structure safely
          const t = typeof task === "string" ? { text: task } : task;

          if (t.completed === true) {
            count++;
          }
        });
      });
    });

    const el = document.getElementById("statTasks");
    if (el) {
      el.textContent = count;

      // remove shimmer
      const tile = el.closest(".home-stat-tile");
      if (tile) tile.classList.add("loaded");
    }
  } catch (err) {
    console.error("Error fetching tasks done:", err);
  }
}

async function fetchEarnings(user) {
  try {
    // 1. Get all products listed by this user
    const { data: myProducts, error: prodError } = await window.supabaseClient
      .from("products")
      .select("id")
      .eq("seller_id", user.id);

    if (prodError) throw prodError;

    if (!myProducts || myProducts.length === 0) {
      updateEarningsUI(0);
      return;
    }

    const ids = myProducts.map((p) => p.id);

    // 2. Get all purchases of those products
    const { data: sales, error: salesError } = await window.supabaseClient
      .from("purchases")
      .select("price")
      .in("product_id", ids);

    if (salesError) throw salesError;

    // 3. Calculate total earnings
    const total = (sales || []).reduce(
      (sum, item) => sum + Number(item.price || 0),
      0,
    );

    updateEarningsUI(total);
  } catch (err) {
    console.error("Error fetching earnings:", err);
  }
}

// helper (keeps UI clean)
function updateEarningsUI(amount) {
  const el = document.getElementById("statEarnings");
  if (el) {
    el.textContent = `₹${amount.toLocaleString("en-IN")}`;

    const tile = el.closest(".home-stat-tile");
    if (tile) tile.classList.add("loaded");
  }
}

/* ============================================================
   UTILITY
   ============================================================ */

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
