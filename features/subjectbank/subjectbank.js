const ADMIN_EMAILS = ["siddhipatil.0308@gmail.com", "1207siddhi@gmail.com"];
const EMAILJS_SERVICE_ID = "service_pi8020v";
const EMAILJS_TEMPLATE_ID = "template_ia9tqsh";
const EMAILJS_PUBLIC_KEY = "-VydCduYmtXKz5HP4";

// ─────────────────────────────────────────────
//  SUPABASE DATA ADAPTER
// ─────────────────────────────────────────────

const db = {
  // Inside the const db = { ... } object in subjectbank.js
  async globalSearchResources(query) {
    const { data, error } = await window.supabaseClient
      .from("sb_resources")
      .select("*")
      .ilike("title", `%${query}%`) // Case-insensitive search
      .order("created_at", { ascending: false });
    return { data: data || [], error };
  },

  async getResources(pathKey) {
    const { data, error } = await window.supabaseClient
      .from("sb_resources")
      .select("*")
      .eq("path_key", pathKey)
      .order("created_at", { ascending: true });
    return { data: data || [], error };
  },

  async saveResource(pathKey, resource) {
    if (resource._file) {
      const file = resource._file;
      const ext = file.name.split(".").pop();
      const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error: uploadError } = await window.supabaseClient.storage
        .from("sb-files")
        .upload(fileName, file);
      if (uploadError) return { data: null, error: uploadError };
      const { data: urlData } = window.supabaseClient.storage
        .from("sb-files")
        .getPublicUrl(fileName);
      resource.content = urlData.publicUrl;
      delete resource._file;
    }
    const { data, error } = await window.supabaseClient
      .from("sb_resources")
      .insert({
        path_key: pathKey,
        title: resource.title,
        type: resource.type,
        content: resource.content,
        owner_id: resource.owner_id,
        owner_email: resource.owner_email,
      })
      .select()
      .single();
    return { data, error };
  },

  async deleteResource(resourceId) {
    const { error } = await window.supabaseClient
      .from("sb_resources")
      .delete()
      .eq("id", resourceId);
    return { error };
  },

  async getResourceCountsForPath(pathPrefix) {
    const { data, error } = await window.supabaseClient
      .from("sb_resources")
      .select("owner_id")
      .like("path_key", `${pathPrefix}%`);
    if (error || !data) return { total: 0, contributors: 0 };
    const contributors = new Set(data.map((r) => r.owner_id)).size;
    return { total: data.length, contributors };
  },

  async getUniversities() {
    const { data, error } = await window.supabaseClient
      .from("sb_universities")
      .select("name")
      .order("name");
    return { data: (data || []).map((r) => r.name), error };
  },

  async addUniversity(name) {
    const { error } = await window.supabaseClient
      .from("sb_universities")
      .insert({ name });
    return { error };
  },

  async deleteUniversity(name) {
    const { error } = await window.supabaseClient
      .from("sb_universities")
      .delete()
      .eq("name", name);
    return { error };
  },

  async getCourses() {
    const { data, error } = await window.supabaseClient
      .from("sb_courses")
      .select("name")
      .order("name");
    return { data: (data || []).map((r) => r.name), error };
  },

  async addCourse(name) {
    const { error } = await window.supabaseClient
      .from("sb_courses")
      .insert({ name });
    return { error };
  },

  async deleteCourse(name) {
    const { error } = await window.supabaseClient
      .from("sb_courses")
      .delete()
      .eq("name", name);
    return { error };
  },

  async getBranches(courseName) {
    const { data, error } = await window.supabaseClient
      .from("sb_branches")
      .select("name")
      .eq("course_name", courseName)
      .order("name");
    return { data: (data || []).map((r) => r.name), error };
  },

  async addBranch(courseName, name) {
    const { error } = await window.supabaseClient
      .from("sb_branches")
      .insert({ course_name: courseName, name });
    return { error };
  },

  async deleteBranch(courseName, name) {
    const { error } = await window.supabaseClient
      .from("sb_branches")
      .delete()
      .eq("course_name", courseName)
      .eq("name", name);
    return { error };
  },

  async getSemesters() {
    const { data, error } = await window.supabaseClient
      .from("sb_semesters")
      .select("number")
      .order("number");
    return { data: (data || []).map((r) => r.number), error };
  },

  async addSemester(number) {
    const { error } = await window.supabaseClient
      .from("sb_semesters")
      .insert({ number });
    return { error };
  },

  async deleteSemester(number) {
    const { error } = await window.supabaseClient
      .from("sb_semesters")
      .delete()
      .eq("number", number);
    return { error };
  },

  async getSubjects(semPathKey) {
    const { data, error } = await window.supabaseClient
      .from("sb_subjects")
      .select("name")
      .eq("path_key", semPathKey)
      .order("name");
    return { data: (data || []).map((r) => r.name), error };
  },

  async addSubject(semPathKey, name) {
    const { error } = await window.supabaseClient
      .from("sb_subjects")
      .insert({ path_key: semPathKey, name });
    return { error };
  },

  async deleteSubject(semPathKey, name) {
    const { error } = await window.supabaseClient
      .from("sb_subjects")
      .delete()
      .eq("path_key", semPathKey)
      .eq("name", name);
    return { error };
  },

  // FIX 3 — fetch usernames from profiles table
  async getUsernames(userIds) {
    if (!userIds || userIds.length === 0) return {};
    const { data, error } = await window.supabaseClient
      .from("profiles")
      .select("id, username")
      .in("id", userIds);
    if (error || !data) return {};
    const map = {};
    data.forEach((row) => {
      map[row.id] = row.username || null;
    });
    return map;
  },
};

// ─────────────────────────────────────────────
//  AUTH
// ─────────────────────────────────────────────

async function getCurrentUser() {
  const { data, error } = await window.supabaseClient.auth.getUser();
  if (error || !data?.user) return { id: "guest", email: "guest@example.com" };
  return { id: data.user.id, email: data.user.email };
}

function isAdmin(email) {
  return ADMIN_EMAILS.includes(email);
}

// ─────────────────────────────────────────────
//  FILTER STATE
// ─────────────────────────────────────────────

const filterState = {
  university: null,
  course: null,
  branch: null,
  semester: null,
  subject: null,

  toPath() {
    const parts = [];
    if (this.university) parts.push(this.university);
    if (this.course) parts.push(this.course);
    if (this.branch) parts.push(this.branch);
    if (this.semester !== null) parts.push(`Semester ${this.semester}`);
    if (this.subject) parts.push(this.subject);
    return parts;
  },

  hasAny() {
    return !!(
      this.university ||
      this.course ||
      this.branch ||
      this.semester !== null ||
      this.subject
    );
  },

  reset() {
    this.university = null;
    this.course = null;
    this.branch = null;
    this.semester = null;
    this.subject = null;
  },

  summaryLabel() {
    const parts = this.toPath();
    return parts.length === 0 ? null : parts.join(" › ");
  },
};

// ─────────────────────────────────────────────
//  MAIN MODULE
// ─────────────────────────────────────────────

const sb = {
  // Add this inside the sb = { ... } object in subjectbank.js
  // Inside the sb = { ... } object in subjectbank.js
  // Inside the sb = { ... } object in subjectbank.js
  // Inside the sb = { ... } object in subjectbank.js
  async performSearch(query) {
    const grid = document.getElementById("sb-main-grid");

    // 1. If query is cleared, go back to the normal folder view
    if (!query) {
      this.render();
      return;
    }

    // 2. Show loading state in the grid
    grid.innerHTML = `<div class="sb-empty"><i data-lucide="loader"></i><p>Searching everywhere...</p></div>`;
    if (window.lucide) window.lucide.createIcons();

    // 3. Fetch matches from Supabase across all paths
    const { data: results, error } = await db.globalSearchResources(query);

    if (error) {
      grid.innerHTML = `<div class="sb-empty"><p>Error searching: ${error.message}</p></div>`;
      return;
    }

    // 4. Update Header for search context
    document.getElementById("sb-current-title").textContent = "Search Results";
    document.getElementById("sb-header-sub").textContent =
      `Found ${results.length} matches for "${query}"`;

    // 5. Render the results
    grid.innerHTML = "";
    grid.className = "resource-list"; // Use the resource list layout

    if (results.length === 0) {
      grid.innerHTML = `<div class="sb-empty"><i data-lucide="search-x"></i><p>No matches found for "${escapeHtml(query)}"</p></div>`;
    } else {
      // Re-use your existing resource rendering logic for each result
      results.forEach((res) => {
        const card = document.createElement("div");
        card.className = "sb-card resource-card"; // Added resource-card for styling

        // Highlight the title
        const originalText = res.title;
        const index = originalText.toLowerCase().indexOf(query.toLowerCase());
        let highlightedTitle = escapeHtml(originalText);

        if (index !== -1) {
          const before = originalText.substring(0, index);
          const match = originalText.substring(index, index + query.length);
          const after = originalText.substring(index + query.length);
          highlightedTitle = `${escapeHtml(before)}<span class="search-highlight">${escapeHtml(match)}</span>${escapeHtml(after)}`;
        }

        // Generate card HTML (Matches your existing renderResources style)
        card.innerHTML = `
          <div class="sb-card-top">
            <span class="sb-badge">${res.type.toUpperCase()}</span>
            <span class="sb-time">${res.path_key.split("/").pop()}</span> 
          </div>
          <div class="sb-card-title">${highlightedTitle}</div>
          <p style="font-size: 11px; color: var(--ink3); margin-top: 4px;">In: ${res.path_key}</p>
          <button class="sb-btn-view" onclick="window.open('${res.content}', '_blank')">
            <i data-lucide="external-link"></i> View Resource
          </button>
        `;
        grid.appendChild(card);
      });
    }

    if (window.lucide) window.lucide.createIcons();
  },

  currentPath: [],
  currentUser: null,
  activeAdminTab: "universities",

  // FIX 1 — render lock: prevents two concurrent renders from both
  // appending cards to the grid, which caused duplicate university folders.
  _rendering: false,
  _pendingRender: false,

  async init() {
    this.currentUser = await getCurrentUser();

    await new Promise((resolve) => {
      const script = document.createElement("script");
      script.src =
        "https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js";
      script.onload = () => {
        window.emailjs.init(EMAILJS_PUBLIC_KEY);
        resolve();
      };
      script.onerror = () => resolve();
      document.head.appendChild(script);
    });

    this._filterDraft = {
      university: null,
      course: null,
      branch: null,
      semester: null,
      subject: null,
    };

    await this.render();
    this.renderFilterBar();
    this.renderTopActionButton();
    this.setupRequestModalClose();
  },

  // ── Navigation ────────────────────────────

  navigate(value) {
    const idx = this.currentPath.indexOf(value);
    if (idx !== -1) {
      this.currentPath = this.currentPath.slice(0, idx + 1);
    } else {
      this.currentPath.push(value);
    }
    this.render();
  },

  navigateToRoot() {
    this.currentPath = [];
    this.render();
  },
  navigateToIndex(idx) {
    this.currentPath = this.currentPath.slice(0, idx + 1);
    this.render();
  },
  jumpToPath(pathArray) {
    this.currentPath = [...pathArray];
    this.render();
  },
  getPathString() {
    return this.currentPath.join("/");
  },

  // ── Render (with lock) ────────────────────

  async render() {
    // If already rendering, mark a pending re-render and return.
    // This collapses any number of rapid calls into at most one queued render.
    if (this._rendering) {
      this._pendingRender = true;
      return;
    }
    this._rendering = true;
    this._pendingRender = false;
    try {
      await this._doRender();
    } finally {
      this._rendering = false;
      if (this._pendingRender) {
        this._pendingRender = false;
        await this.render();
      }
    }
  },

  async _doRender() {
    this.renderBreadcrumbs();
    const depth = this.currentPath.length;

    const addBtn = document.getElementById("sb-add-btn");
    if (addBtn) addBtn.style.display = depth === 5 ? "flex" : "none";

    const depthLabels = [
      "University",
      "Course",
      "Branch",
      "Semester",
      "Subject",
      "Resources",
    ];
    const headerSub = document.getElementById("sb-header-sub");
    if (headerSub)
      headerSub.textContent = depthLabels[depth]
        ? `Browse by ${depthLabels[depth]}`
        : "";

    const title = document.getElementById("sb-current-title");
    if (title)
      title.textContent =
        depth === 0 ? "Subject Bank" : this.currentPath[depth - 1];

    if (depth < 5) {
      await this.renderFolders(depth);
    } else {
      await this.renderResources();
    }
  },

  renderBreadcrumbs() {
    const bc = document.getElementById("sb-breadcrumbs");
    if (!bc) return;
    let html = `<span class="bc-item ${this.currentPath.length === 0 ? "bc-current" : ""}" onclick="sb.navigateToRoot()">
      <i data-lucide="home"></i> Universities
    </span>`;
    this.currentPath.forEach((p, i) => {
      html += `<span class="bc-sep"><i data-lucide="chevron-right"></i></span>`;
      const isCurrent = i === this.currentPath.length - 1;
      html += `<span class="bc-item ${isCurrent ? "bc-current" : ""}" onclick="sb.navigateToIndex(${i})">${escapeHtml(p)}</span>`;
    });
    bc.innerHTML = html;
    if (window.lucide) window.lucide.createIcons();
  },

  // ── Filter Bar ────────────────────────────

  renderFilterBar() {
    const bar = document.getElementById("sb-filter-bar");
    if (!bar) return;
    const hasFilter = filterState.hasAny();
    const label = filterState.summaryLabel();
    bar.innerHTML = `
      <button class="btn-filter ${hasFilter ? "has-filter" : ""}" onclick="sb.openFilterModal()">
        <i data-lucide="sliders-horizontal"></i>
        ${hasFilter ? "Filter Active" : "Filter / Jump To"}
      </button>
      ${
        hasFilter
          ? `
        <span class="filter-active-pill">
          <i data-lucide="map-pin" style="width:12px;height:12px;color:var(--rust)"></i>
          ${escapeHtml(label)}
          <button class="pill-clear" onclick="sb.clearFilter()" title="Clear filter">
            <i data-lucide="x"></i>
          </button>
        </span>`
          : ""
      }
    `;
    if (window.lucide) window.lucide.createIcons();
  },

  renderTopActionButton() {
    const container = document.getElementById("sb-header-actions");
    if (!container) {
      setTimeout(() => this.renderTopActionButton(), 100);
      return;
    }
    const oldBtn = document.getElementById("dynamic-top-btn");
    if (oldBtn) oldBtn.remove();
    const isUserAdmin = isAdmin(this.currentUser?.email);
    const btn = document.createElement("button");
    btn.id = "dynamic-top-btn";
    if (isUserAdmin) {
      btn.className = "btn-admin";
      btn.innerHTML = `<i data-lucide="settings-2"></i> Modify`;
      btn.onclick = () => this.openAdminPanel();
    } else {
      btn.className = "request-btn";
      btn.innerHTML = `Request Admin`;
      btn.onclick = () => {
        const modal = document.getElementById("request-modal");
        if (modal) modal.classList.add("active");
      };
    }
    container.prepend(btn);
    if (window.lucide) window.lucide.createIcons();
  },

  setupRequestModalClose() {
    const modal = document.getElementById("request-modal");
    const closeBtn = document.getElementById("close-modal");
    const form = document.getElementById("request-form");
    if (!modal) return;
    if (closeBtn) closeBtn.onclick = () => modal.classList.remove("active");
    modal.addEventListener("click", (e) => {
      if (e.target === modal) modal.classList.remove("active");
    });
    if (form) {
      form.onsubmit = async (e) => {
        e.preventDefault();
        const submitBtn = form.querySelector("button[type='submit']");
        submitBtn.textContent = "Sending…";
        submitBtn.disabled = true;
        const data = Object.fromEntries(new FormData(form));
        try {
          await window.emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
            from_name: this.currentUser?.email || "Unknown User",
            from_email: this.currentUser?.email || "unknown@example.com",
            university: data.university || "—",
            course: data.course || "—",
            branch: data.branch || "—",
            details: data.details || "—",
          });
          submitBtn.textContent = "Sent!";
          setTimeout(() => {
            modal.classList.remove("active");
            form.reset();
            submitBtn.textContent = "Send Request";
            submitBtn.disabled = false;
          }, 1500);
        } catch (err) {
          console.error("EmailJS error:", err);
          submitBtn.textContent = "Failed — try again";
          submitBtn.disabled = false;
        }
      };
    }
  },

  clearFilter() {
    filterState.reset();
    this.renderFilterBar();
  },

  // ── Filter Modal ─────────────────────────

  async openFilterModal() {
    document.getElementById("sb-filter-modal").classList.add("active");
    this._filterDraft = {
      university: filterState.university,
      course: filterState.course,
      branch: filterState.branch,
      semester: filterState.semester,
      subject: filterState.subject,
    };
    await this.renderFilterModal();
  },

  closeFilterModal() {
    document.getElementById("sb-filter-modal").classList.remove("active");
  },

  async renderFilterModal() {
    const { data: universities } = await db.getUniversities();
    this._renderFilterSection("university", universities, null, true);

    const hasUni = !!this._filterDraft.university;
    const { data: courses } = hasUni ? await db.getCourses() : { data: [] };
    this._renderFilterSection("course", courses, "university", false);

    const hasCourse = !!this._filterDraft.course;
    const { data: branches } =
      hasUni && hasCourse
        ? await db.getBranches(this._filterDraft.course)
        : { data: [] };
    this._renderFilterSection("branch", branches, "course", false);

    const hasBranch = !!this._filterDraft.branch;
    const { data: sems } = hasBranch ? await db.getSemesters() : { data: [] };
    this._renderFilterSection("semester", sems, "branch", false, true);

    const hasSem = this._filterDraft.semester !== null;
    const semPath = hasSem
      ? [
          this._filterDraft.university,
          this._filterDraft.course,
          this._filterDraft.branch,
          `Semester ${this._filterDraft.semester}`,
        ].join("/")
      : null;
    const { data: subjects } =
      hasSem && semPath ? await db.getSubjects(semPath) : { data: [] };
    this._renderFilterSection("subject", subjects, "semester", false);

    this._updateFilterSummary();
    if (window.lucide) window.lucide.createIcons();
  },

  _renderFilterSection(
    field,
    options,
    dependsOn,
    required,
    isSemester = false,
  ) {
    const searchEl = document.getElementById(`filter-search-${field}`);
    const listEl = document.getElementById(`filter-options-${field}`);
    const selectedEl = document.getElementById(`filter-selected-${field}`);
    const sectionEl = document.getElementById(`filter-section-${field}`);
    if (!listEl) return;
    const parentFilled = dependsOn === null || !!this._filterDraft[dependsOn];
    if (sectionEl) sectionEl.classList.toggle("disabled", !parentFilled);
    const query = searchEl ? searchEl.value.toLowerCase().trim() : "";
    const currentVal = this._filterDraft[field];
    const displayOptions = options.filter((o) => {
      const label = isSemester ? `Semester ${o}` : String(o);
      return label.toLowerCase().includes(query);
    });
    if (displayOptions.length === 0) {
      listEl.innerHTML = `<div class="filter-option-empty">${options.length === 0 ? "Select a parent field first" : "No matches found"}</div>`;
    } else {
      listEl.innerHTML = displayOptions
        .map((o) => {
          const val = isSemester ? o : String(o);
          const label = isSemester ? `Semester ${o}` : String(o);
          const isSelected = isSemester
            ? this._filterDraft.semester === o
            : this._filterDraft[field] === val;
          return `<div class="filter-option ${isSelected ? "selected" : ""}"
          onclick="sb._selectFilterOption('${field}', ${isSemester ? o : `'${escapeAttr(String(o))}'`}, ${isSemester})">
          ${escapeHtml(label)}</div>`;
        })
        .join("");
    }
    if (selectedEl) {
      const selLabel =
        isSemester && currentVal !== null
          ? `Semester ${currentVal}`
          : currentVal
            ? escapeHtml(String(currentVal))
            : null;
      selectedEl.innerHTML = selLabel
        ? `<span class="filter-selected-value">${selLabel}
            <button onclick="sb._clearFilterField('${field}')" title="Clear"><i data-lucide="x"></i></button>
           </span>`
        : "";
    }
  },

  _selectFilterOption(field, value, isSemester) {
    this._filterDraft[field] = value;
    const order = ["university", "course", "branch", "semester", "subject"];
    const idx = order.indexOf(field);
    order.slice(idx + 1).forEach((f) => {
      this._filterDraft[f] = null;
    });
    order.slice(idx + 1).forEach((f) => {
      const el = document.getElementById(`filter-search-${f}`);
      if (el) el.value = "";
    });
    this.renderFilterModal();
  },

  _clearFilterField(field) {
    const order = ["university", "course", "branch", "semester", "subject"];
    const idx = order.indexOf(field);
    order.slice(idx).forEach((f) => {
      this._filterDraft[f] = null;
    });
    this.renderFilterModal();
  },

  async _filterSearchChanged(field) {
    const order = ["university", "course", "branch", "semester", "subject"];
    const isSemester = field === "semester";
    let data = [];
    if (field === "university") ({ data } = await db.getUniversities());
    else if (field === "course")
      ({ data } = this._filterDraft.university
        ? await db.getCourses()
        : { data: [] });
    else if (field === "branch")
      ({ data } = this._filterDraft.course
        ? await db.getBranches(this._filterDraft.course)
        : { data: [] });
    else if (field === "semester")
      ({ data } = this._filterDraft.branch
        ? await db.getSemesters()
        : { data: [] });
    else if (field === "subject") {
      if (this._filterDraft.semester !== null) {
        const semPath = [
          this._filterDraft.university,
          this._filterDraft.course,
          this._filterDraft.branch,
          `Semester ${this._filterDraft.semester}`,
        ].join("/");
        ({ data } = await db.getSubjects(semPath));
      }
    }
    const dependsOn = order[order.indexOf(field) - 1] || null;
    this._renderFilterSection(
      field,
      data,
      dependsOn,
      field === "university",
      isSemester,
    );
    if (window.lucide) window.lucide.createIcons();
  },

  _updateFilterSummary() {
    const el = document.getElementById("filter-modal-summary");
    if (!el) return;
    const parts = [];
    if (this._filterDraft.university) parts.push(this._filterDraft.university);
    if (this._filterDraft.course) parts.push(this._filterDraft.course);
    if (this._filterDraft.branch) parts.push(this._filterDraft.branch);
    if (this._filterDraft.semester !== null)
      parts.push(`Semester ${this._filterDraft.semester}`);
    if (this._filterDraft.subject) parts.push(this._filterDraft.subject);
    el.textContent = parts.length
      ? `Will navigate to: ${parts.join(" › ")}`
      : "Select a university to begin";
  },

  applyFilter() {
    if (!this._filterDraft.university) {
      const el = document.getElementById("filter-section-university");
      if (el) {
        el.style.outline = "2px solid var(--rust)";
        setTimeout(() => (el.style.outline = ""), 1200);
      }
      return;
    }
    Object.assign(filterState, this._filterDraft);
    this.closeFilterModal();
    this.jumpToPath(filterState.toPath());
    this.renderFilterBar();
  },

  resetFilterModal() {
    this._filterDraft = {
      university: null,
      course: null,
      branch: null,
      semester: null,
      subject: null,
    };
    document
      .querySelectorAll("[id^='filter-search-']")
      .forEach((el) => (el.value = ""));
    this.renderFilterModal();
  },

  // ── Folder Rendering ──────────────────────

  async renderFolders(depth) {
    const grid = document.getElementById("sb-main-grid");
    grid.className = "sb-grid";
    // FIX 1 — clear immediately so stale cards are never visible alongside new ones
    grid.innerHTML = `<div class="sb-empty"><i data-lucide="loader"></i><p>Loading…</p></div>`;
    if (window.lucide) window.lucide.createIcons();

    let items = [];
    let badgeType = "";

    if (depth === 0) {
      ({ data: items } = await db.getUniversities());
      badgeType = "University";
    } else if (depth === 1) {
      ({ data: items } = await db.getCourses());
      badgeType = "Course";
    } else if (depth === 2) {
      ({ data: items } = await db.getBranches(this.currentPath[1]));
      badgeType = "Branch";
    } else if (depth === 3) {
      const { data: sems } = await db.getSemesters();
      items = sems.map((s) => `Semester ${s}`);
      badgeType = "Semester";
    } else if (depth === 4) {
      ({ data: items } = await db.getSubjects(this.getPathString()));
      badgeType = "Subject";
    }

    // FIX 1 — wipe grid clean after await before appending anything
    grid.innerHTML = "";

    if (items.length === 0) {
      grid.innerHTML = `<div class="sb-empty"><i data-lucide="folder-open"></i><p>Nothing here yet.</p></div>`;
      if (window.lucide) window.lucide.createIcons();
      return;
    }

    const counts = await Promise.all(
      items.map((name) =>
        db.getResourceCountsForPath(
          [...this.currentPath, String(name)].join("/"),
        ),
      ),
    );

    items.forEach((name, i) => {
      const { total, contributors } = counts[i];
      const card = document.createElement("div");
      card.className = "sb-card";
      card.onclick = () => this.navigate(String(name));
      const timeStr =
        total > 0 ? `${total} resource${total !== 1 ? "s" : ""}` : "Empty";
      card.innerHTML = `
        <div class="sb-card-top">
          <span class="sb-badge">${badgeType}</span>
          <span class="sb-time"><i data-lucide="layers"></i> ${timeStr}</span>
        </div>
        <div class="sb-card-title">${escapeHtml(String(name))}</div>
        <div class="sb-stats-box">
          <div class="sb-stat-item">
            <span class="sb-stat-value">${contributors}</span>
            <span class="sb-stat-label">Contributors</span>
          </div>
          <div class="sb-stat-item">
            <span class="sb-stat-value">${total}</span>
            <span class="sb-stat-label">Resources</span>
          </div>
        </div>
        <button class="sb-btn-view"><i data-lucide="folder-open"></i> Open Folder</button>`;
      grid.appendChild(card);
    });
    if (window.lucide) window.lucide.createIcons();
  },

  // ── Resource Rendering ────────────────────

  async renderResources() {
    const grid = document.getElementById("sb-main-grid");
    grid.className = "resource-list";
    // FIX 2 — show loading spinner
    grid.innerHTML = `<div class="sb-empty"><i data-lucide="loader"></i><p>Loading…</p></div>`;
    if (window.lucide) window.lucide.createIcons();

    const pathKey = this.getPathString();
    const { data: resources } = await db.getResources(pathKey);

    // FIX 2 — clear loading spinner unconditionally after await
    grid.innerHTML = "";

    if (resources.length === 0) {
      grid.innerHTML = `<div class="sb-empty"><i data-lucide="file-plus"></i><p>No resources yet.<br>Be the first to contribute!</p></div>`;
      if (window.lucide) window.lucide.createIcons();
      return;
    }

    // FIX 3 — batch-fetch usernames for all contributors
    const uniqueIds = [
      ...new Set(resources.map((r) => r.owner_id).filter(Boolean)),
    ];
    const usernameMap = await db.getUsernames(uniqueIds);

    resources.forEach((res, index) => {
      const isOwner = res.owner_id === this.currentUser?.id;
      const typeMap = {
        text: { icon: "file-text", label: "Notes" },
        image: { icon: "image", label: "Image" },
        pdf: { icon: "file", label: "PDF" },
        youtube: { icon: "youtube", label: "Video" },
        link: { icon: "link", label: "Link" },
      };
      const typeInfo = typeMap[res.type] || { icon: "file", label: res.type };

      let previewHtml = "";
      if (res.type === "image") {
        previewHtml = `<div class="resource-preview"><img src="${res.content}" alt="${escapeHtml(res.title)}"></div>`;
      } else if (res.type === "pdf") {
        previewHtml = `<div class="resource-preview"><div class="resource-type-icon"><i data-lucide="file"></i><span>PDF Document</span></div></div>`;
      } else if (res.type === "youtube") {
        const id = this.getYTId(res.content);
        previewHtml = id
          ? `<div class="resource-preview"><iframe src="https://www.youtube.com/embed/${id}?controls=0" scrolling="no" title="${escapeHtml(res.title)}"></iframe></div>`
          : `<div class="resource-preview"><div class="resource-type-icon"><i data-lucide="youtube"></i><span>YouTube Video</span></div></div>`;
      } else if (res.type === "link") {
        try {
          const domain = new URL(res.content).hostname;
          previewHtml = `<div class="resource-preview"><div class="link-preview">
            <img src="https://www.google.com/s2/favicons?domain=${domain}&sz=64" class="link-favicon" alt="">
            <div class="link-details">
              <span class="link-title">${escapeHtml(res.title)}</span>
              <span class="link-url">${domain}</span>
            </div>
          </div></div>`;
        } catch {
          previewHtml = `<div class="resource-preview"><div class="resource-type-icon"><i data-lucide="link"></i><span>Link</span></div></div>`;
        }
      } else {
        previewHtml = `<div class="resource-preview"><div class="resource-type-icon"><i data-lucide="file-text"></i><span>${escapeHtml(res.content.substring(0, 60))}…</span></div></div>`;
      }

      // FIX 3 — username > email > "Unknown"
      const displayName = isOwner
        ? "You"
        : escapeHtml(usernameMap[res.owner_id] || res.owner_email || "Unknown");

      const rCard = document.createElement("div");
      rCard.className = "resource-card";
      rCard.innerHTML = `
        ${previewHtml}
        <div class="resource-meta">
          <strong>${escapeHtml(res.title)}</strong>
          <span class="resource-type-pill">
            <i data-lucide="${typeInfo.icon}"></i> ${typeInfo.label}
          </span>
          <br>
          <small>by ${displayName}</small>
        </div>
        <div class="resource-actions">
          <button class="btn-sm btn-view" onclick="sb.viewResource(${index})">
            <i data-lucide="eye"></i> Open
          </button>
          ${
            isOwner
              ? `<button class="btn-sm btn-del" onclick="sb.deleteResource('${res.id}')">
            <i data-lucide="trash-2"></i> Delete
          </button>`
              : ""
          }
        </div>`;
      grid.appendChild(rCard);
    });
    if (window.lucide) window.lucide.createIcons();
  },

  // ── Resource Form ─────────────────────────

  toggleForm() {
    const form = document.getElementById("sb-form-container");
    const isOpen = form.style.display === "block";
    form.style.display = isOpen ? "none" : "block";
    if (!isOpen && window.lucide) window.lucide.createIcons();
  },

  handleTypeChange() {
    const type = document.getElementById("res-type").value;
    document.getElementById("field-text").style.display =
      type === "text" ? "block" : "none";
    document.getElementById("field-file").style.display =
      type === "image" || type === "pdf" ? "block" : "none";
    document.getElementById("field-url").style.display =
      type === "youtube" || type === "link" ? "block" : "none";
    const fileInput = document.getElementById("res-file-input");
    if (type === "image") fileInput.accept = "image/*";
    else if (type === "pdf") fileInput.accept = "application/pdf";
  },

  async saveResource() {
    const title = document.getElementById("res-title").value.trim();
    const type = document.getElementById("res-type").value;
    if (!title) {
      alert("Title is required.");
      return;
    }
    let content = "";
    let _file = null;
    if (type === "text") {
      content = document.getElementById("res-text-content").value;
    } else if (type === "youtube" || type === "link") {
      content = document.getElementById("res-url-input").value.trim();
      if (!content.startsWith("http")) {
        alert("Please enter a valid URL (starting with http).");
        return;
      }
    } else {
      const file = document.getElementById("res-file-input").files[0];
      if (!file) {
        alert("Please select a file.");
        return;
      }
      _file = file;
      content = "";
    }
    const pathKey = this.getPathString();
    const { error } = await db.saveResource(pathKey, {
      title,
      type,
      content,
      _file,
      owner_id: this.currentUser?.id || null,
      owner_email: this.currentUser?.email || "guest",
    });
    if (error) {
      alert("Failed to save resource: " + error.message);
      return;
    }
    this.toggleForm();
    document.getElementById("res-title").value = "";
    document.getElementById("res-text-content").value = "";
    document.getElementById("res-url-input").value = "";
    document.getElementById("res-file-input").value = "";
    await this.render();
  },

  async deleteResource(resourceId) {
    if (!confirm("Delete this resource?")) return;
    const { error } = await db.deleteResource(resourceId);
    if (error) {
      console.error(error);
      return;
    }
    await this.render();
  },

  async viewResource(index) {
    const { data: resources } = await db.getResources(this.getPathString());
    const res = resources[index];
    if (!res) return;
    const modal = document.getElementById("sb-modal-overlay");
    const body = document.getElementById("modal-body");
    document.getElementById("modal-title").textContent = res.title;
    body.innerHTML = "";
    if (res.type === "text") {
      body.innerHTML = `<div style="background:white;padding:28px;border-radius:12px;font-size:1rem;line-height:1.8;white-space:pre-wrap;color:var(--ink2);border:1px solid var(--e8);min-height:40vh;">${escapeHtml(res.content)}</div>`;
    } else if (res.type === "image") {
      body.innerHTML = `<img src="${res.content}" style="max-width:100%;max-height:75vh;display:block;margin:auto;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,0.15);">`;
    } else if (res.type === "pdf") {
      body.innerHTML = `<iframe src="${res.content}" style="width:100%;height:75vh;border-radius:12px;border:none;"></iframe>`;
    } else if (res.type === "youtube") {
      const id = this.getYTId(res.content);
      body.innerHTML = `<div class="yt-container"><iframe src="https://www.youtube.com/embed/${id}?autoplay=1" allow="autoplay;encrypted-media" allowfullscreen></iframe></div>`;
    } else if (res.type === "link") {
      try {
        const domain = new URL(res.content).hostname;
        body.innerHTML = `<div style="text-align:center;padding:60px;background:white;border-radius:12px;border:1px solid var(--e8);">
          <img src="https://www.google.com/s2/favicons?domain=${domain}&sz=128" style="width:56px;margin-bottom:16px;border-radius:8px;">
          <h2 style="font-family:Lora,serif;color:var(--ink);margin:0 0 8px">${escapeHtml(res.title)}</h2>
          <p style="color:var(--ink4);margin-bottom:24px;">${domain}</p>
          <a href="${res.content}" target="_blank" style="background:var(--rust);color:white;padding:12px 28px;border-radius:var(--r);text-decoration:none;font-weight:600;font-family:'DM Sans',sans-serif;">Visit Website</a>
        </div>`;
      } catch {
        body.innerHTML = `<p>Could not load link preview.</p>`;
      }
    }
    modal.style.display = "flex";
    if (window.lucide) window.lucide.createIcons();
  },

  closeModal() {
    document.getElementById("sb-modal-overlay").style.display = "none";
    document.getElementById("modal-body").innerHTML = "";
  },

  // ── Admin Panel ───────────────────────────

  openAdminPanel() {
    document.getElementById("sb-admin-modal").classList.add("active");
    this.renderAdminPanel();
  },

  closeAdminPanel() {
    document.getElementById("sb-admin-modal").classList.remove("active");
  },

  switchAdminTab(tab) {
    this.activeAdminTab = tab;
    document
      .querySelectorAll(".admin-tab")
      .forEach((t) => t.classList.toggle("active", t.dataset.tab === tab));
    document
      .querySelectorAll(".admin-section")
      .forEach((s) => s.classList.toggle("active", s.dataset.section === tab));
    this.renderAdminPanel();
  },

  async renderAdminPanel() {
    const [unis, courses, sems] = await Promise.all([
      db.getUniversities(),
      db.getCourses(),
      db.getSemesters(),
    ]);
    this.renderAdminList("universities", unis.data);
    this.renderAdminList("courses", courses.data);
    this.renderSemesterAdmin(sems.data);
    await this.renderBranchAdmin();
    await this.populateSubjectAdminDropdowns();
  },

  renderAdminList(section, items) {
    const listEl = document.getElementById(`admin-list-${section}`);
    if (!listEl) return;
    listEl.innerHTML = items
      .map(
        (item) => `
      <div class="admin-list-item">
        <span>${escapeHtml(String(item))}</span>
        <button onclick="sb.deleteAdminItem('${section}', '${escapeAttr(String(item))}')" title="Remove">
          <i data-lucide="x"></i>
        </button>
      </div>`,
      )
      .join("");
    if (window.lucide) window.lucide.createIcons();
  },

  renderSemesterAdmin(sems) {
    const listEl = document.getElementById("admin-list-semesters");
    if (!listEl) return;
    listEl.innerHTML = sems
      .map(
        (s) => `
      <div class="admin-list-item">
        <span>Semester ${s}</span>
        <button onclick="sb.deleteAdminItem('semesters', '${s}')"><i data-lucide="x"></i></button>
      </div>`,
      )
      .join("");
    if (window.lucide) window.lucide.createIcons();
  },

  async renderBranchAdmin() {
    const container = document.getElementById("admin-branch-sections");
    if (!container) return;
    const { data: courses } = await db.getCourses();
    const branchResults = await Promise.all(
      courses.map((c) => db.getBranches(c)),
    );
    container.innerHTML = courses
      .map((course, i) => {
        const branches = branchResults[i].data || [];
        return `
        <div class="branch-map-group">
          <div class="branch-map-label"><i data-lucide="book-open"></i> ${escapeHtml(course)}</div>
          <div class="admin-list" id="branch-list-${escapeCssId(course)}">
            ${branches
              .map(
                (b) => `
              <div class="admin-list-item">
                <span>${escapeHtml(b)}</span>
                <button onclick="sb.deleteBranch('${escapeAttr(course)}', '${escapeAttr(b)}')">
                  <i data-lucide="x"></i>
                </button>
              </div>`,
              )
              .join("")}
          </div>
          <div class="admin-add-row" style="margin-top:6px">
            <input type="text" id="new-branch-${escapeCssId(course)}" placeholder="Add branch…" />
            <button class="btn-primary" style="padding:8px 14px" onclick="sb.addBranch('${escapeAttr(course)}')">
              <i data-lucide="plus"></i>
            </button>
          </div>
        </div>`;
      })
      .join("");
    if (window.lucide) window.lucide.createIcons();
  },

  // ── Subject Admin ─────────────────────────

  async populateSubjectAdminDropdowns() {
    const uniSel = document.getElementById("admin-subject-uni");
    const courseSel = document.getElementById("admin-subject-course");
    const branchSel = document.getElementById("admin-subject-branch");
    const semSel = document.getElementById("admin-subject-sem");
    if (!uniSel) return;

    const [{ data: unis }, { data: courses }, { data: sems }] =
      await Promise.all([
        db.getUniversities(),
        db.getCourses(),
        db.getSemesters(),
      ]);

    uniSel.innerHTML =
      `<option value="">— University —</option>` +
      unis
        .map(
          (u) => `<option value="${escapeAttr(u)}">${escapeHtml(u)}</option>`,
        )
        .join("");
    courseSel.innerHTML =
      `<option value="">— Course —</option>` +
      courses
        .map(
          (c) => `<option value="${escapeAttr(c)}">${escapeHtml(c)}</option>`,
        )
        .join("");
    semSel.innerHTML =
      `<option value="">— Semester —</option>` +
      sems.map((s) => `<option value="${s}">Semester ${s}</option>`).join("");
    branchSel.innerHTML = `<option value="">— Branch —</option>`;

    courseSel.onchange = async () => {
      branchSel.innerHTML = `<option value="">— Branch —</option>`;
      if (courseSel.value) {
        const { data: branches } = await db.getBranches(courseSel.value);
        branchSel.innerHTML += branches
          .map(
            (b) => `<option value="${escapeAttr(b)}">${escapeHtml(b)}</option>`,
          )
          .join("");
      }
      await this.loadSubjectAdminPath();
    };
    uniSel.onchange = () => this.loadSubjectAdminPath();
    branchSel.onchange = () => this.loadSubjectAdminPath();
    semSel.onchange = () => this.loadSubjectAdminPath();

    const container = document.getElementById("admin-subject-list-container");
    if (container) container.style.display = "none";
  },

  async loadSubjectAdminPath() {
    const uni = document.getElementById("admin-subject-uni")?.value;
    const course = document.getElementById("admin-subject-course")?.value;
    const branch = document.getElementById("admin-subject-branch")?.value;
    const sem = document.getElementById("admin-subject-sem")?.value;
    const container = document.getElementById("admin-subject-list-container");
    const listEl = document.getElementById("admin-list-subjects");
    if (!container || !listEl) return;
    if (!uni || !course || !branch || !sem) {
      container.style.display = "none";
      return;
    }

    const semPathKey = `${uni}/${course}/${branch}/Semester ${sem}`;
    const { data: subjects } = await db.getSubjects(semPathKey);

    listEl.innerHTML =
      subjects.length === 0
        ? `<div style="font-size:12px;color:var(--ink4);padding:8px;font-style:italic;">No subjects yet for this path.</div>`
        : subjects
            .map(
              (s) => `
          <div class="admin-list-item">
            <span>${escapeHtml(s)}</span>
            <button onclick="sb.deleteSubjectItem('${escapeAttr(semPathKey)}', '${escapeAttr(s)}')">
              <i data-lucide="x"></i>
            </button>
          </div>`,
            )
            .join("");

    container.style.display = "block";
    if (window.lucide) window.lucide.createIcons();
  },

  async addSubjectItem() {
    const uni = document.getElementById("admin-subject-uni")?.value;
    const course = document.getElementById("admin-subject-course")?.value;
    const branch = document.getElementById("admin-subject-branch")?.value;
    const sem = document.getElementById("admin-subject-sem")?.value;
    const input = document.getElementById("admin-input-subjects");
    if (!uni || !course || !branch || !sem) {
      alert("Please select a full path first.");
      return;
    }
    const val = input?.value.trim();
    if (!val) return;
    const semPathKey = `${uni}/${course}/${branch}/Semester ${sem}`;
    const { error } = await db.addSubject(semPathKey, val);
    if (error) {
      alert("Error: " + error.message);
      return;
    }
    if (input) input.value = "";
    await this.loadSubjectAdminPath();
    await this.render();
  },

  async deleteSubjectItem(semPathKey, subjectName) {
    const { error } = await db.deleteSubject(semPathKey, subjectName);
    if (error) {
      alert("Error: " + error.message);
      return;
    }
    await this.loadSubjectAdminPath();
    await this.render();
  },

  // ── Admin CRUD ────────────────────────────

  async deleteAdminItem(section, name) {
    let error = null;
    if (section === "universities")
      ({ error } = await db.deleteUniversity(name));
    else if (section === "courses") ({ error } = await db.deleteCourse(name));
    else if (section === "semesters")
      ({ error } = await db.deleteSemester(parseInt(name)));
    if (error) {
      alert("Error: " + error.message);
      return;
    }
    await this.renderAdminPanel();
    await this.render();
  },

  async addAdminItem(section) {
    const input = document.getElementById(`admin-input-${section}`);
    const val = input.value.trim();
    if (!val) return;
    let error = null;
    if (section === "universities") ({ error } = await db.addUniversity(val));
    else if (section === "courses") ({ error } = await db.addCourse(val));
    else if (section === "semesters") {
      const num = parseInt(val);
      if (!isNaN(num)) ({ error } = await db.addSemester(num));
    }
    if (error) {
      alert("Error: " + error.message);
      return;
    }
    input.value = "";
    await this.renderAdminPanel();
    await this.render();
  },

  async addBranch(course) {
    const input = document.getElementById(`new-branch-${escapeCssId(course)}`);
    if (!input) return;
    const val = input.value.trim();
    if (!val) return;
    const { error } = await db.addBranch(course, val);
    if (error) {
      alert("Error: " + error.message);
      return;
    }
    input.value = "";
    await this.renderBranchAdmin();
    await this.render();
  },

  async deleteBranch(course, branchName) {
    const { error } = await db.deleteBranch(course, branchName);
    if (error) {
      alert("Error: " + error.message);
      return;
    }
    await this.renderBranchAdmin();
    await this.render();
  },

  // ── Utilities ─────────────────────────────

  getYTId(url) {
    const match = url.match(
      /(?:youtu\.be\/|v\/|watch\?v=|embed\/)([^#&?]{11})/,
    );
    return match ? match[1] : null;
  },
};

window.sb = sb;

// ─────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttr(str) {
  return String(str).replace(/'/g, "\\'");
}
function escapeCssId(str) {
  return String(str).replace(/[^a-zA-Z0-9-_]/g, "-");
}

// Boot
setTimeout(() => {
  sb.init();
}, 100);
