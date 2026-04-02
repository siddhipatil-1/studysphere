/**
 * group.js — Study Group Finder (Supabase edition)
 *
 * Uses window.supabaseClient (initialised in /js/supabaseClient.js)
 */

// ─────────────────────────────────────────────
//  CLIENT REFERENCE
// ─────────────────────────────────────────────

const sb = window.supabaseClient;
let searchQuery = "";

// ─────────────────────────────────────────────
//  AUTH
// ─────────────────────────────────────────────

async function getCurrentUser() {
  const {
    data: { user },
    error,
  } = await sb.auth.getUser();
  if (error || !user) return null;

  const { data: profile } = await sb
    .from("profiles")
    .select("username")
    .eq("id", user.id)
    .single();

  return {
    id: user.id,
    username: profile?.username || user.email,
  };
}

// ─────────────────────────────────────────────
//  DB ADAPTER — study_groups + group_members
//
//  getGroups() and getGroup() do TWO separate queries instead of a
//  nested select. The nested-select syntax requires a Supabase foreign-key
//  relationship to be explicitly declared in the dashboard. If that FK is
//  missing the join silently returns an empty members array — which is why
//  groups appear to load but show no members and owner actions break.
//  Two flat queries avoid that requirement entirely.
// ─────────────────────────────────────────────

const db = {
  async getGroups() {
    const { data: groups, error: gErr } = await sb
      .from("study_groups")
      .select("*")
      .order("created_at", { ascending: false });
    if (gErr) return { data: null, error: gErr };
    if (!groups || groups.length === 0) return { data: [], error: null };

    const groupIds = groups.map((g) => g.id);
    const { data: members, error: mErr } = await sb
      .from("group_members")
      .select("group_id, user_id, username, status")
      .in("group_id", groupIds);
    if (mErr) return { data: null, error: mErr };

    return {
      data: groups.map((g) =>
        shapeGroup({
          ...g,
          members: (members || []).filter((m) => m.group_id === g.id),
        }),
      ),
      error: null,
    };
  },

  async getGroup(id) {
    const { data: g, error: gErr } = await sb
      .from("study_groups")
      .select("*")
      .eq("id", id)
      .single();
    if (gErr) return { data: null, error: gErr };

    const { data: members, error: mErr } = await sb
      .from("group_members")
      .select("group_id, user_id, username, status")
      .eq("group_id", id);
    if (mErr) return { data: null, error: mErr };

    return { data: shapeGroup({ ...g, members: members || [] }), error: null };
  },

  async insertGroup({
    subject,
    title,
    time,
    meetingLink,
    maxCapacity,
    description,
    owner_id,
    owner_username,
  }) {
    const { data, error } = await sb
      .from("study_groups")
      .insert({
        subject,
        title,
        time,
        meeting_link: meetingLink || null,
        max_capacity: maxCapacity,
        description: description || "",
        owner_id,
        owner_username,
      })
      .select()
      .single();
    if (error) return { data: null, error };
    return { data, error: null };
  },

  async updateGroup(id, updates) {
    const keyMap = {
      subject: "subject",
      title: "title",
      time: "time",
      meetingLink: "meeting_link",
      maxCapacity: "max_capacity",
      description: "description",
    };
    const dbUpdates = {};
    for (const [k, v] of Object.entries(updates)) {
      if (keyMap[k]) dbUpdates[keyMap[k]] = v;
    }
    const { data, error } = await sb
      .from("study_groups")
      .update(dbUpdates)
      .eq("id", id)
      .select()
      .single();
    if (error) return { data: null, error };
    return { data, error: null };
  },

  async deleteGroup(id) {
    const { error } = await sb.from("study_groups").delete().eq("id", id);
    return { error };
  },

  async addMember(groupId, userId, username, status = "pending") {
    const { error } = await sb
      .from("group_members")
      .upsert(
        { group_id: groupId, user_id: userId, username, status },
        { onConflict: "group_id,user_id" },
      );
    return { error };
  },

  async approveMember(groupId, userId) {
    const { error } = await sb
      .from("group_members")
      .update({ status: "joined" })
      .eq("group_id", groupId)
      .eq("user_id", userId);
    return { error };
  },

  async removeMember(groupId, userId) {
    const { error } = await sb
      .from("group_members")
      .delete()
      .eq("group_id", groupId)
      .eq("user_id", userId);
    return { error };
  },
};

// ─────────────────────────────────────────────
//  BROADCAST HELPERS
// ─────────────────────────────────────────────

function broadcastMembersChanged() {
  if (window._sgMembersChannel) {
    window._sgMembersChannel.send({
      type: "broadcast",
      event: "members_changed",
      payload: {},
    });
  }
}

function broadcastNotifTo(userId, event, payload) {
  const ch = sb.channel(`user_notif_send_${userId}_${Date.now()}`);
  ch.subscribe((status) => {
    if (status === "SUBSCRIBED") {
      ch.send({ type: "broadcast", event, payload });
    }
    setTimeout(() => {
      try {
        sb.removeChannel(ch);
      } catch (_) {}
    }, 3000);
  });
}

// ─────────────────────────────────────────────
//  CRYPTO LAYER  (AES-GCM-256, Web Crypto API)
// ─────────────────────────────────────────────

const CHAT_SALT = "MyMajorProject101";

const Crypto = (() => {
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const keyCache = new Map();

  async function deriveKey(groupId) {
    if (keyCache.has(groupId)) return keyCache.get(groupId);
    const base = await crypto.subtle.importKey(
      "raw",
      enc.encode(groupId + CHAT_SALT),
      { name: "PBKDF2" },
      false,
      ["deriveKey"],
    );
    const key = await crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: enc.encode("group_messages"),
        iterations: 100_000,
        hash: "SHA-256",
      },
      base,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
    keyCache.set(groupId, key);
    return key;
  }

  async function encrypt(groupId, plaintext) {
    const key = await deriveKey(groupId);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      enc.encode(plaintext),
    );
    const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
    return `${b64(iv.buffer)}:${b64(ct)}`;
  }

  async function decrypt(groupId, payload) {
    try {
      const [ivB64, ctB64] = payload.split(":");
      if (!ivB64 || !ctB64) return payload;
      const from64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
      const key = await deriveKey(groupId);
      const plain = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: from64(ivB64) },
        key,
        from64(ctB64),
      );
      return dec.decode(plain);
    } catch {
      return "[encrypted message]";
    }
  }

  return { encrypt, decrypt };
})();

// ─────────────────────────────────────────────
//  DB ADAPTER — group_messages (encrypted)
// ─────────────────────────────────────────────

const chatDb = {
  async getMessages(groupId) {
    const { data, error } = await sb
      .from("group_messages")
      .select("*")
      .eq("group_id", groupId)
      .order("created_at", { ascending: true })
      .limit(200);
    if (error) return { data: [], error };

    const rows = await Promise.all(
      (data || []).map(async (msg) => {
        if (msg.is_system) return msg;
        return { ...msg, text: await Crypto.decrypt(groupId, msg.text) };
      }),
    );
    return { data: rows, error: null };
  },

  async addMessage(groupId, { username, text, is_system }) {
    const stored = is_system ? text : await Crypto.encrypt(groupId, text);
    const { data, error } = await sb
      .from("group_messages")
      .insert({
        group_id: groupId,
        username,
        text: stored,
        is_system: is_system || false,
      })
      .select()
      .single();
    if (error) return { data: null, error };
    return { data: { ...data, text }, error: null };
  },

  async decryptRow(groupId, row) {
    if (row.is_system) return row;
    return { ...row, text: await Crypto.decrypt(groupId, row.text) };
  },
};

// ─────────────────────────────────────────────
//  SHAPE helper — raw DB row → UI-friendly object
// ─────────────────────────────────────────────

function shapeGroup(g) {
  if (!g) return null;
  const all = g.members || [];
  return {
    id: g.id,
    created_at: g.created_at,
    subject: g.subject,
    title: g.title,
    time: g.time,
    meetingLink: g.meeting_link,
    maxCapacity: g.max_capacity,
    description: g.description || "",
    owner_id: g.owner_id,
    owner: g.owner_username,
    joinedUsers: all
      .filter((m) => m.status === "joined")
      .map((m) => m.username),
    pendingUsers: all
      .filter((m) => m.status === "pending")
      .map((m) => m.username),
    joinedIds: all.filter((m) => m.status === "joined").map((m) => m.user_id),
    pendingIds: all.filter((m) => m.status === "pending").map((m) => m.user_id),
    allMembers: all,
  };
}

// ─────────────────────────────────────────────
//  INIT
// ─────────────────────────────────────────────

export async function init() {
  console.log("Group init running");

  const container = document.querySelector(".finder-container");
  if (!container) return;

  // ── Tear down ALL channels from any previous init call ────────────────────
  // When your SPA navigates away and back, init() is called again on a
  // brand-new DOM. We must destroy old channels first so we can create
  // fresh ones bound to the new DOM nodes without Supabase complaining.
  if (window._sgGroupsChannel) {
    try {
      sb.removeChannel(window._sgGroupsChannel);
    } catch (_) {}
    window._sgGroupsChannel = null;
  }
  if (window._sgMembersChannel) {
    try {
      sb.removeChannel(window._sgMembersChannel);
    } catch (_) {}
    window._sgMembersChannel = null;
  }
  if (window._sgPersonalChannel) {
    try {
      sb.removeChannel(window._sgPersonalChannel);
    } catch (_) {}
    window._sgPersonalChannel = null;
  }
  if (window._sgBgChatChannels) {
    for (const [, ch] of window._sgBgChatChannels) {
      try {
        sb.removeChannel(ch);
      } catch (_) {}
    }
  }
  window._sgBgChatChannels = new Map();

  // ── DOM refs — always queried fresh so we're bound to the new DOM ─────────
  const cardGrid = container.querySelector("#cardGrid");
  const modal = container.querySelector("#createModal");
  const closeModalBtn = container.querySelector("#closeModalBtn");
  const createEntryForm = container.querySelector("#createEntryForm");
  const modalTitle = container.querySelector("#modalTitle");
  const modalSubtitle = container.querySelector("#modalSubtitle");
  const filterTabs = container.querySelectorAll(".tab-btn[data-filter]");
  const chatDrawer = container.querySelector("#chatDrawer");
  const chatGroupTitle = container.querySelector("#chatGroupTitle");
  const chatMessages = container.querySelector("#chatMessages");
  const chatForm = container.querySelector("#chatForm");
  const chatInput = container.querySelector("#chatInput");
  const closeChatBtn = container.querySelector("#closeChatBtn");

  // ── Local state ───────────────────────────────────────────────────────────
  let currentFilter = "all";
  let currentUser = null;
  let editId = null;
  let activeChatGroupId = null;
  let renderedCount = 0;
  let chatChannel = null;

  const bgChatChannels = window._sgBgChatChannels;

  // ── Auth ──────────────────────────────────────────────────────────────────
  currentUser = await getCurrentUser();
  if (!currentUser) {
    cardGrid.innerHTML = `
      <div class="empty-state">
        <i data-lucide="lock"></i>
        <p>Please sign in to use Study Groups.</p>
      </div>`;
    requestAnimationFrame(() => {
      if (window.lucide) window.lucide.createIcons();
    });
    return;
  }

  // ── Background chat listener ───────────────────────────────────────────────
  function ensureBgChatChannel(groupId, groupTitle) {
    if (bgChatChannels.has(groupId)) return;

    const ch = sb
      .channel(`bg_chat_${groupId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "group_messages",
          filter: `group_id=eq.${groupId}`,
        },
        async (payload) => {
          const row = payload.new;
          if (row.is_system) return;
          if (row.username === currentUser.username) return;
          if (activeChatGroupId === groupId) return;
          if (typeof window.addNotification === "function") {
            window.addNotification({
              source: "group",
              title: `💬 New message in ${groupTitle}`,
              message: `${row.username}: [new message]`,
            });
          }
        },
      )
      .subscribe();

    bgChatChannels.set(groupId, ch);
  }

  function teardownBgChatChannel(groupId) {
    const ch = bgChatChannels.get(groupId);
    if (ch) {
      try {
        sb.removeChannel(ch);
      } catch (_) {}
      bgChatChannels.delete(groupId);
    }
  }

  // ── Personal notification channel ─────────────────────────────────────────
  window._sgPersonalChannel = sb
    .channel(`user_notif_${currentUser.id}`)
    .on("broadcast", { event: "join_request" }, (payload) => {
      if (typeof window.addNotification !== "function") return;
      const { groupTitle, requesterUsername } = payload.payload || {};
      window.addNotification({
        source: "group",
        title: "📥 New Join Request",
        message: `${requesterUsername} wants to join "${groupTitle}"`,
      });
    })
    .on("broadcast", { event: "member_status" }, (payload) => {
      if (typeof window.addNotification !== "function") return;
      const { groupTitle, status } = payload.payload || {};
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

  // ── Render ────────────────────────────────────────────────────────────────
  async function render() {
    if (!cardGrid) return;

    const { data: groups, error } = await db.getGroups();
    if (error) {
      console.error("getGroups:", error.message);
      cardGrid.innerHTML = `
        <div class="empty-state">
          <i data-lucide="wifi-off"></i>
          <p>Could not load groups. Check your connection.</p>
        </div>`;
      requestAnimationFrame(() => {
        if (window.lucide) window.lucide.createIcons();
      });
      return;
    }

    let filtered = [...(groups || [])];

    // Search
    if (searchQuery) {
      const q = searchQuery;
      filtered = filtered
        .filter(
          (g) =>
            (g.title || "").toLowerCase().includes(q) ||
            (g.subject || "").toLowerCase().includes(q),
        )
        .sort((a, b) => {
          const aScore = (a.title || "").toLowerCase().includes(q) ? 2 : 1;
          const bScore = (b.title || "").toLowerCase().includes(q) ? 2 : 1;
          return bScore - aScore;
        });
    }

    // Filter tabs
    if (currentFilter === "mine") {
      filtered = filtered.filter(
        (g) =>
          g.owner_id === currentUser.id || g.joinedIds.includes(currentUser.id),
      );
    } else if (currentFilter === "open") {
      filtered = filtered.filter((g) => g.joinedUsers.length < g.maxCapacity);
    }

    cardGrid.innerHTML = "";

    if (filtered.length === 0) {
      cardGrid.innerHTML = `
        <div class="empty-state">
          <i data-lucide="users"></i>
          <p>No groups here yet.<br>
            <strong style="cursor:pointer" onclick="window.openCreateModal()">Create the first one!</strong>
          </p>
        </div>`;
      requestAnimationFrame(() => {
        if (window.lucide) window.lucide.createIcons();
      });
      return;
    }

    const myGroupIds = new Set();

    filtered.forEach((group) => {
      const members = group.joinedUsers.length;
      const max = group.maxCapacity || 1;
      const progress = Math.min((members / max) * 100, 100);
      const isFull = members >= max;
      const isOwner = group.owner_id === currentUser.id;
      const isJoined = group.joinedIds.includes(currentUser.id);
      const isPending = group.pendingIds.includes(currentUser.id);
      const isMember = isOwner || isJoined;

      if (isMember) {
        myGroupIds.add(group.id);
        ensureBgChatChannel(group.id, group.title);
      }

      let joinLabel = "Request to Join",
        joinIcon = "log-in",
        joinDisabled = false;
      if (isOwner) {
        joinLabel = "You're the Host";
        joinIcon = "crown";
        joinDisabled = true;
      } else if (isJoined) {
        joinLabel = "Joined";
        joinIcon = "check";
        joinDisabled = true;
      } else if (isPending) {
        joinLabel = "Pending Approval";
        joinIcon = "clock";
        joinDisabled = true;
      } else if (isFull) {
        joinLabel = "Group Full";
        joinIcon = "lock";
        joinDisabled = true;
      }

      const participantsHtml =
        group.joinedUsers.length > 0
          ? `<div class="participants-section">
            <button class="participants-toggle" onclick="window.toggleParticipants(this)">
              <i data-lucide="chevron-right"></i> Participants (${members})
            </button>
            <div class="participants-list">
              ${group.joinedUsers
                .map((uname, i) => {
                  const uid = group.joinedIds[i];
                  return `<div class="participant-row">
                  <span>${escapeHtml(uname)}${uname === group.owner ? ' <span class="owner-badge">Host</span>' : ""}</span>
                  ${
                    isOwner && uid !== currentUser.id
                      ? `<button class="btn-remove" data-action="remove" data-group="${group.id}" data-uid="${uid}">Remove</button>`
                      : ""
                  }
                </div>`;
                })
                .join("")}
            </div>
          </div>`
          : "";

      const pendingHtml =
        isOwner && group.pendingUsers.length > 0
          ? `<div class="pending-section">
            <div class="pending-section-title"><i data-lucide="bell"></i> Pending Requests</div>
            ${group.pendingUsers
              .map((uname, i) => {
                const uid = group.pendingIds[i];
                return `<div class="pending-row">
                <span>${escapeHtml(uname)}</span>
                <div class="pending-actions">
                  <button class="btn-approve" data-action="approve" data-group="${group.id}" data-uid="${uid}" data-uname="${escapeHtml(uname)}" data-grouptitle="${escapeHtml(group.title)}">Approve</button>
                  <button class="btn-reject"  data-action="reject"  data-group="${group.id}" data-uid="${uid}" data-uname="${escapeHtml(uname)}" data-grouptitle="${escapeHtml(group.title)}">Reject</button>
                </div>
              </div>`;
              })
              .join("")}
          </div>`
          : "";

      const meetingRow =
        isMember && group.meetingLink
          ? `<div class="detail-row"><i data-lucide="video"></i><a href="${escapeHtml(group.meetingLink)}" target="_blank" rel="noopener">Join Meeting</a></div>`
          : "";

      const descRow = group.description
        ? `<div class="detail-row detail-desc"><i data-lucide="align-left"></i><span>${escapeHtml(group.description)}</span></div>`
        : "";

      const chatBtn = isMember
        ? `<button class="btn-chat" data-action="chat" data-id="${group.id}" data-title="${escapeHtml(group.title)}"><i data-lucide="message-circle"></i> Chat</button>`
        : "";

      const ownerActions = isOwner
        ? `<div class="owner-action-row">
            <button class="btn-edit"   data-action="edit"   data-id="${group.id}"><i data-lucide="pencil"></i> Edit</button>
            <button class="btn-delete" data-action="delete" data-id="${group.id}"><i data-lucide="trash-2"></i> Delete</button>
          </div>`
        : "";

      const leaveBtn =
        isJoined && !isOwner
          ? `<button class="btn-leave" data-action="leave" data-id="${group.id}"><i data-lucide="log-out"></i> Leave</button>`
          : "";

      const card = document.createElement("div");
      card.className = "group-card";
      card.innerHTML = `
        <span class="card-subject-pill"><i data-lucide="book-open"></i> ${escapeHtml(group.subject)}</span>
        <h3 class="card-title">${escapeHtml(group.title)}</h3>
        <div class="card-details">
          <div class="detail-row"><i data-lucide="user"></i><span>${escapeHtml(group.owner)}</span></div>
          <div class="detail-row"><i data-lucide="clock"></i><span>${escapeHtml(group.time)}</span></div>
          <div class="detail-row"><i data-lucide="users"></i><span>${members} / ${max} members</span></div>
          ${descRow}${meetingRow}
        </div>
        ${pendingHtml}${participantsHtml}
        <div class="capacity-row">
          <div class="capacity-label">
            <span>Capacity</span>
            <span>${isFull ? "Full" : `${max - members} spot${max - members === 1 ? "" : "s"} left`}</span>
          </div>
          <div class="progress-track">
            <div class="progress-fill ${isFull ? "full" : ""}" style="width:${progress}%"></div>
          </div>
        </div>
        <div class="card-actions">
          <button class="btn-join" data-action="join" data-id="${group.id}" data-title="${escapeHtml(group.title)}" ${joinDisabled ? "disabled" : ""}>
            <i data-lucide="${joinIcon}"></i> ${joinLabel}
          </button>
          ${chatBtn}${leaveBtn}${ownerActions}
        </div>`;

      cardGrid.appendChild(card);
    });

    // Tear down bg listeners for groups we've left
    for (const [gid] of bgChatChannels) {
      if (!myGroupIds.has(gid)) teardownBgChatChannel(gid);
    }

    requestAnimationFrame(() => {
      if (window.lucide) window.lucide.createIcons();
    });
  }

  window.groupRender = render;

  // ── Card event delegation ─────────────────────────────────────────────────
  cardGrid.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;

    if (action === "join") {
      const groupId = btn.dataset.id;
      const groupTitle = btn.dataset.title || "";
      await db.addMember(
        groupId,
        currentUser.id,
        currentUser.username,
        "pending",
      );
      await chatDb.addMessage(groupId, {
        username: "System",
        text: `${currentUser.username} requested to join.`,
        is_system: true,
      });
      const { data: group } = await db.getGroup(groupId);
      if (group && group.owner_id !== currentUser.id) {
        broadcastNotifTo(group.owner_id, "join_request", {
          groupTitle: group.title,
          requesterUsername: currentUser.username,
        });
      }
      broadcastMembersChanged();
      render();
    }

    if (action === "approve") {
      const groupId = btn.dataset.group;
      const userId = btn.dataset.uid;
      const uname = btn.dataset.uname;
      const groupTitle = btn.dataset.grouptitle || "";
      await db.approveMember(groupId, userId);
      await chatDb.addMessage(groupId, {
        username: "System",
        text: `${uname} joined the group. Welcome! 🎉`,
        is_system: true,
      });
      broadcastNotifTo(userId, "member_status", {
        groupTitle,
        status: "approved",
      });
      broadcastMembersChanged();
      render();
    }

    if (action === "reject") {
      const groupId = btn.dataset.group;
      const userId = btn.dataset.uid;
      const groupTitle = btn.dataset.grouptitle || "";
      await db.removeMember(groupId, userId);
      broadcastNotifTo(userId, "member_status", {
        groupTitle,
        status: "rejected",
      });
      broadcastMembersChanged();
      render();
    }

    if (action === "leave") {
      if (!confirm("Leave this group?")) return;
      const id = btn.dataset.id;
      await db.removeMember(id, currentUser.id);
      await chatDb.addMessage(id, {
        username: "System",
        text: `${currentUser.username} left the group.`,
        is_system: true,
      });
      if (activeChatGroupId === id) closeChat();
      teardownBgChatChannel(id);
      broadcastMembersChanged();
      render();
    }

    if (action === "remove") {
      const groupId = btn.dataset.group;
      const userId = btn.dataset.uid;
      const { data: group } = await db.getGroup(groupId);
      if (!group || group.owner_id !== currentUser.id) return;
      await db.removeMember(groupId, userId);
      broadcastMembersChanged();
      render();
    }

    if (action === "edit") {
      const id = btn.dataset.id;
      const { data: group } = await db.getGroup(id);
      if (!group) return;
      editId = id;
      container.querySelector("#inputSubject").value = group.subject;
      container.querySelector("#inputTitle").value = group.title;
      container.querySelector("#inputTime").value = group.time;
      container.querySelector("#inputMeetingLink").value =
        group.meetingLink || "";
      container.querySelector("#inputMax").value = group.maxCapacity;
      container.querySelector("#inputDescription").value =
        group.description || "";
      modalTitle.textContent = "Edit Study Group";
      if (modalSubtitle)
        modalSubtitle.textContent = "Update your group details below.";
      modal.classList.add("active");
    }

    if (action === "delete") {
      const id = btn.dataset.id;
      const { data: group } = await db.getGroup(id);
      if (!group || group.owner_id !== currentUser.id) return;
      if (!confirm(`Delete "${group.title}"? This cannot be undone.`)) return;
      await db.deleteGroup(id);
      if (activeChatGroupId === id) closeChat();
      render();
    }

    if (action === "chat") {
      openChat(btn.dataset.id, btn.dataset.title);
    }
  });

  // ── Form submit ───────────────────────────────────────────────────────────
  createEntryForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const groupData = {
      subject: container.querySelector("#inputSubject").value.trim(),
      title: container.querySelector("#inputTitle").value.trim(),
      time: container.querySelector("#inputTime").value.trim(),
      meetingLink: container.querySelector("#inputMeetingLink").value.trim(),
      maxCapacity: parseInt(container.querySelector("#inputMax").value),
      description: container.querySelector("#inputDescription").value.trim(),
    };

    if (editId) {
      const { error } = await db.updateGroup(editId, groupData);
      if (error) {
        console.error("updateGroup:", error.message);
        return;
      }
      editId = null;
    } else {
      const { data: newGroup, error } = await db.insertGroup({
        ...groupData,
        owner_id: currentUser.id,
        owner_username: currentUser.username,
      });
      if (error) {
        console.error("insertGroup:", error.message);
        return;
      }
      await db.addMember(
        newGroup.id,
        currentUser.id,
        currentUser.username,
        "joined",
      );
      await chatDb.addMessage(newGroup.id, {
        username: "System",
        text: `Group created by ${currentUser.username}. Welcome! 👋`,
        is_system: true,
      });
    }

    modal.classList.remove("active");
    createEntryForm.reset();
    render();
  });

  // ── Filter tabs ───────────────────────────────────────────────────────────
  filterTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      filterTabs.forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      currentFilter = tab.dataset.filter;
      render();
    });
  });

  // ── Modal open/close ──────────────────────────────────────────────────────
  window.openCreateModal = function () {
    editId = null;
    createEntryForm.reset();
    modalTitle.textContent = "Create Study Group";
    if (modalSubtitle)
      modalSubtitle.textContent = "Fill in the details to start a new group.";
    modal.classList.add("active");
  };

  container
    .querySelector("#createGroupBtn")
    .addEventListener("click", window.openCreateModal);
  closeModalBtn.addEventListener("click", () =>
    modal.classList.remove("active"),
  );
  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.classList.remove("active");
  });

  // ── Participants toggle ───────────────────────────────────────────────────
  window.toggleParticipants = function (btn) {
    const list = btn.nextElementSibling;
    list.classList.toggle("open");
    const icon = btn.querySelector("[data-lucide]");
    if (icon) {
      icon.setAttribute(
        "data-lucide",
        list.classList.contains("open") ? "chevron-down" : "chevron-right",
      );
      requestAnimationFrame(() => {
        if (window.lucide) window.lucide.createIcons();
      });
    }
  };

  // ── Chat ──────────────────────────────────────────────────────────────────
  async function openChat(groupId, groupTitle) {
    if (chatChannel) {
      try {
        await sb.removeChannel(chatChannel);
      } catch (_) {}
      chatChannel = null;
    }
    activeChatGroupId = groupId;
    chatGroupTitle.textContent = groupTitle;
    await loadMessages(groupId);
    chatDrawer.classList.add("open");
    chatInput.focus();

    chatChannel = sb
      .channel(`group_chat_${groupId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "group_messages",
          filter: `group_id=eq.${groupId}`,
        },
        async (payload) => {
          if (
            payload.new.username === currentUser.username &&
            !payload.new.is_system
          )
            return;
          const msg = await chatDb.decryptRow(activeChatGroupId, payload.new);
          appendMessageDOM(msg);
          renderedCount++;
          scrollChatBottom();
        },
      )
      .subscribe();

    render();
  }

  function closeChat() {
    chatDrawer.classList.remove("open");
    if (chatChannel) {
      try {
        sb.removeChannel(chatChannel);
      } catch (_) {}
      chatChannel = null;
    }
    activeChatGroupId = null;
  }

  async function loadMessages(groupId) {
    const { data: messages, error } = await chatDb.getMessages(groupId);
    if (error) {
      console.error("loadMessages:", error.message);
      return;
    }
    chatMessages.innerHTML = "";
    renderedCount = 0;
    messages.forEach((msg) => {
      appendMessageDOM(msg);
      renderedCount++;
    });
    scrollChatBottom();
  }

  function appendMessageDOM(msg) {
    const isMe = msg.username === currentUser.username;
    const isSystem = msg.is_system;
    const time = new Date(msg.created_at).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });

    if (isSystem) {
      const el = document.createElement("div");
      el.className = "chat-system";
      el.textContent = msg.text;
      chatMessages.appendChild(el);
      return;
    }
    const el = document.createElement("div");
    el.className = `chat-bubble-wrap ${isMe ? "me" : "other"}`;
    el.innerHTML = `
      ${!isMe ? `<span class="chat-username">${escapeHtml(msg.username)}</span>` : ""}
      <div class="chat-bubble">
        <span class="chat-text">${escapeHtml(msg.text)}</span>
        <span class="chat-time">${time}</span>
      </div>`;
    chatMessages.appendChild(el);
  }

  function scrollChatBottom() {
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  chatForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (!text || !activeChatGroupId) return;
    chatInput.value = "";

    appendMessageDOM({
      id: "optimistic",
      created_at: new Date().toISOString(),
      username: currentUser.username,
      text,
      is_system: false,
    });
    renderedCount++;
    scrollChatBottom();

    const { error } = await chatDb.addMessage(activeChatGroupId, {
      username: currentUser.username,
      text,
      is_system: false,
    });
    if (error) console.error("sendMessage:", error.message);
  });

  closeChatBtn.addEventListener("click", closeChat);

  // ── Realtime — group-level and member changes ─────────────────────────────
  window._sgGroupsChannel = sb
    .channel("study_groups_global")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "study_groups" },
      () => render(),
    )
    .subscribe();

  window._sgMembersChannel = sb
    .channel("group_activity")
    .on("broadcast", { event: "members_changed" }, () => render())
    .subscribe();

  // ── Boot ──────────────────────────────────────────────────────────────────
  render();
}

// ─────────────────────────────────────────────
//  UTILS
// ─────────────────────────────────────────────

export function search(query) {
  searchQuery = query.toLowerCase().trim();
  if (window.groupRender) window.groupRender();
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
