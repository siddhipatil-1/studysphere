/**
 * group.js — Study Group Finder (Supabase edition)
 *
 * Uses window.supabaseClient (initialised in /js/supabaseClient.js)
 *
 * Tables required:
 *   public.profiles        — already exists  (id, username)
 *   public.study_groups    — run Step 1 SQL
 *   public.group_members   — run Step 2 SQL
 *   public.group_messages  — run Step 3 SQL
 */

// ─────────────────────────────────────────────
//  CLIENT REFERENCE
// ─────────────────────────────────────────────

const sb = window.supabaseClient;
let searchQuery = "";

// ─────────────────────────────────────────────
//  AUTH  — reads from your existing profiles table
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
// ─────────────────────────────────────────────

const db = {
  async getGroups() {
    const { data, error } = await sb
      .from("study_groups")
      .select(`*, members:group_members ( user_id, username, status )`)
      .order("created_at", { ascending: false });
    if (error) return { data: null, error };
    return { data: (data || []).map(shapeGroup), error: null };
  },

  async getGroup(id) {
    const { data, error } = await sb
      .from("study_groups")
      .select(`*, members:group_members ( user_id, username, status )`)
      .eq("id", id)
      .single();
    if (error) return { data: null, error };
    return { data: shapeGroup(data), error: null };
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
//  BROADCAST HELPER
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

/**
 * Broadcast a targeted notification to a specific user via a
 * personal Supabase Realtime channel keyed by their user ID.
 * The receiver's group.js instance is subscribed to this channel
 * and fires window.addNotification() when a message arrives.
 *
 * Channel name: "user_notif_{userId}"
 * Events:
 *   "join_request"   — sent to the group owner when someone requests to join
 *   "member_status"  — sent to the requester when approved or rejected
 *   "chat_message"   — sent to all group members when someone sends a chat
 */
function broadcastNotifTo(userId, event, payload) {
  // We create a temporary send-only channel — Supabase Realtime
  // allows any connected client to send a broadcast to any channel name.
  const ch = sb.channel(`user_notif_${userId}`);
  ch.subscribe((status) => {
    if (status === "SUBSCRIBED") {
      ch.send({ type: "broadcast", event, payload });
      // Unsubscribe after sending so we don't accumulate channels
      setTimeout(() => sb.removeChannel(ch), 2000);
    }
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
    // Full member objects needed for notification targeting
    allMembers: all,
  };
}

// ─────────────────────────────────────────────
//  INIT
// ─────────────────────────────────────────────

export async function init() {
  if (window.groupRealtimeInitialized) return;
  window.groupRealtimeInitialized = true;

  const container = document.querySelector(".finder-container");
  if (!container) return;

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

  let currentFilter = "all";
  let currentUser = null;
  let editId = null;
  let activeChatGroupId = null;
  let renderedCount = 0;
  let chatChannel = null;
  let groupsChannel = null;
  let membersChannel = null;

  // Background chat channels — one per group the user is a member of.
  // These listen for new messages even when the chat drawer is closed,
  // so we can fire a dashboard notification.
  const bgChatChannels = new Map(); // groupId → RealtimeChannel

  // ── Auth ──────────────────────────────────────────────────────────────────

  currentUser = await getCurrentUser();
  if (!currentUser) {
    cardGrid.innerHTML = `
      <div class="empty-state">
        <i data-lucide="lock"></i>
        <p>Please sign in to use Study Groups.</p>
      </div>`;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  // ─────────────────────────────────────────────
  //  BACKGROUND CHAT LISTENER
  //
  //  After render() we know which groups the current user belongs to.
  //  We subscribe one realtime channel per group (if not already subscribed).
  //  When a non-system message from someone else arrives AND the chat drawer
  //  for that group is NOT currently open → fire a dashboard notification.
  // ─────────────────────────────────────────────

  function ensureBgChatChannel(groupId, groupTitle) {
    if (bgChatChannels.has(groupId)) return; // already listening

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

          // Ignore system messages and own messages
          if (row.is_system) return;
          if (row.username === currentUser.username) return;

          // Only notify when that group's chat drawer is closed
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
      sb.removeChannel(ch);
      bgChatChannels.delete(groupId);
    }
  }

  // ─────────────────────────────────────────────
  //  PERSONAL NOTIFICATION CHANNEL
  //
  //  Listens on "user_notif_{currentUser.id}" for targeted broadcasts
  //  sent by OTHER users' browsers when they take an action that
  //  affects the current user:
  //    • "join_request"  → someone asked to join MY group
  //    • "member_status" → I was approved or rejected
  // ─────────────────────────────────────────────

  const personalNotifChannel = sb
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
      if (status === "approved") {
        window.addNotification({
          source: "group",
          title: "✅ Join Request Approved",
          message: `You were accepted into "${groupTitle}"`,
        });
      } else {
        window.addNotification({
          source: "group",
          title: "❌ Join Request Rejected",
          message: `You were not accepted into "${groupTitle}"`,
        });
      }
    })
    .subscribe();

  // ── Render cards ──────────────────────────────────────────────────────────

  async function render() {
    const { data: groups, error } = await db.getGroups();
    if (error) {
      console.error("getGroups:", error.message);
      return;
    }

    let filtered = [...groups];

    // 🔍 Search
    if (searchQuery) {
      const q = searchQuery;
      filtered = filtered
        .filter((g) => {
          const title = (g.title || "").toLowerCase();
          const subject = (g.subject || "").toLowerCase();
          return title.includes(q) || subject.includes(q);
        })
        .sort((a, b) => {
          const aTitle = (a.title || "").toLowerCase();
          const bTitle = (b.title || "").toLowerCase();
          const aScore = aTitle.includes(q) ? 2 : 1;
          const bScore = bTitle.includes(q) ? 2 : 1;
          return bScore - aScore;
        });
    }

    // 🎛 Filter
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
            <strong onclick="openCreateModal()">Create the first one!</strong>
          </p>
        </div>`;
      if (window.lucide) window.lucide.createIcons();
      return;
    }

    // Track which groups the current user is a member of so we can
    // set up background chat listeners for them.
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

      // Register background chat listener for every group I'm a member of
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
          ? `
        <div class="participants-section">
          <button class="participants-toggle" onclick="toggleParticipants(this)">
            <i data-lucide="chevron-right"></i>
            Participants (${members})
          </button>
          <div class="participants-list">
            ${group.joinedUsers
              .map((uname, i) => {
                const uid = group.joinedIds[i];
                return `
              <div class="participant-row">
                <span>
                  ${escapeHtml(uname)}
                  ${uname === group.owner ? '<span class="owner-badge">Host</span>' : ""}
                </span>
                ${
                  isOwner && uid !== currentUser.id
                    ? `
                  <button class="btn-remove"
                    data-action="remove"
                    data-group="${group.id}"
                    data-uid="${uid}">Remove</button>`
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
          ? `
        <div class="pending-section">
          <div class="pending-section-title">
            <i data-lucide="bell"></i> Pending Requests
          </div>
          ${group.pendingUsers
            .map((uname, i) => {
              const uid = group.pendingIds[i];
              return `
            <div class="pending-row">
              <span>${escapeHtml(uname)}</span>
              <div class="pending-actions">
                <button class="btn-approve"
                  data-action="approve"
                  data-group="${group.id}"
                  data-uid="${uid}"
                  data-uname="${escapeHtml(uname)}"
                  data-grouptitle="${escapeHtml(group.title)}">Approve</button>
                <button class="btn-reject"
                  data-action="reject"
                  data-group="${group.id}"
                  data-uid="${uid}"
                  data-uname="${escapeHtml(uname)}"
                  data-grouptitle="${escapeHtml(group.title)}">Reject</button>
              </div>
            </div>`;
            })
            .join("")}
        </div>`
          : "";

      const meetingRow =
        isMember && group.meetingLink
          ? `
        <div class="detail-row">
          <i data-lucide="video"></i>
          <a href="${escapeHtml(group.meetingLink)}" target="_blank" rel="noopener">Join Meeting</a>
        </div>`
          : "";

      const descRow = group.description
        ? `
        <div class="detail-row detail-desc">
          <i data-lucide="align-left"></i>
          <span>${escapeHtml(group.description)}</span>
        </div>`
        : "";

      const chatBtn = isMember
        ? `
        <button class="btn-chat" data-action="chat" data-id="${group.id}" data-title="${escapeHtml(group.title)}">
          <i data-lucide="message-circle"></i> Chat
        </button>`
        : "";

      const ownerActions = isOwner
        ? `
        <div class="owner-action-row">
          <button class="btn-edit" data-action="edit" data-id="${group.id}">
            <i data-lucide="pencil"></i> Edit
          </button>
          <button class="btn-delete" data-action="delete" data-id="${group.id}">
            <i data-lucide="trash-2"></i> Delete
          </button>
        </div>`
        : "";

      const leaveBtn =
        isJoined && !isOwner
          ? `
        <button class="btn-leave" data-action="leave" data-id="${group.id}">
          <i data-lucide="log-out"></i> Leave
        </button>`
          : "";

      const card = document.createElement("div");
      card.className = "group-card";
      card.innerHTML = `
        <span class="card-subject-pill">
          <i data-lucide="book-open"></i>
          ${escapeHtml(group.subject)}
        </span>
        <h3 class="card-title">${escapeHtml(group.title)}</h3>
        <div class="card-details">
          <div class="detail-row"><i data-lucide="user"></i><span>${escapeHtml(group.owner)}</span></div>
          <div class="detail-row"><i data-lucide="clock"></i><span>${escapeHtml(group.time)}</span></div>
          <div class="detail-row"><i data-lucide="users"></i><span>${members} / ${max} members</span></div>
          ${descRow}
          ${meetingRow}
        </div>
        ${pendingHtml}
        ${participantsHtml}
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
            <i data-lucide="${joinIcon}"></i>
            ${joinLabel}
          </button>
          ${chatBtn}
          ${leaveBtn}
          ${ownerActions}
        </div>`;

      cardGrid.appendChild(card);
    });

    // Tear down background listeners for groups we're no longer in
    for (const [gid] of bgChatChannels) {
      if (!myGroupIds.has(gid)) {
        teardownBgChatChannel(gid);
      }
    }

    if (window.lucide) window.lucide.createIcons();
  }
  window.groupRender = render;

  // ── Card event delegation ─────────────────────────────────────────────────

  cardGrid.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;

    // ── JOIN REQUEST ─────────────────────────────────────────────────────────
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

      // 🔔 Notify the group owner that someone wants to join
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

    // ── APPROVE ──────────────────────────────────────────────────────────────
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

      // 🔔 Notify the requester that they were approved
      broadcastNotifTo(userId, "member_status", {
        groupTitle,
        status: "approved",
      });

      broadcastMembersChanged();
      render();
    }

    // ── REJECT ───────────────────────────────────────────────────────────────
    if (action === "reject") {
      const groupId = btn.dataset.group;
      const userId = btn.dataset.uid;
      const groupTitle = btn.dataset.grouptitle || "";

      await db.removeMember(groupId, userId);

      // 🔔 Notify the requester that they were rejected
      broadcastNotifTo(userId, "member_status", {
        groupTitle,
        status: "rejected",
      });

      broadcastMembersChanged();
      render();
    }

    // ── LEAVE ────────────────────────────────────────────────────────────────
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

    // ── REMOVE ───────────────────────────────────────────────────────────────
    if (action === "remove") {
      const groupId = btn.dataset.group;
      const userId = btn.dataset.uid;
      const { data: group } = await db.getGroup(groupId);
      if (!group || group.owner_id !== currentUser.id) return;
      await db.removeMember(groupId, userId);
      broadcastMembersChanged();
      render();
    }

    // ── EDIT ─────────────────────────────────────────────────────────────────
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

    // ── DELETE ───────────────────────────────────────────────────────────────
    if (action === "delete") {
      const id = btn.dataset.id;
      const { data: group } = await db.getGroup(id);
      if (!group || group.owner_id !== currentUser.id) return;
      if (!confirm(`Delete "${group.title}"? This cannot be undone.`)) return;
      await db.deleteGroup(id);
      if (activeChatGroupId === id) closeChat();
    }

    // ── CHAT ─────────────────────────────────────────────────────────────────
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

  // ── Modal ─────────────────────────────────────────────────────────────────

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
      if (window.lucide) window.lucide.createIcons();
    }
  };

  // ── LIVE CHAT ─────────────────────────────────────────────────────────────

  async function openChat(groupId, groupTitle) {
    if (chatChannel) {
      await sb.removeChannel(chatChannel);
      chatChannel = null;
    }
    activeChatGroupId = groupId;
    chatGroupTitle.textContent = groupTitle;

    await loadMessages(groupId);

    chatDrawer.classList.add("open");
    chatInput.focus();

    // Supabase Realtime for messages from other users
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
      sb.removeChannel(chatChannel);
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

  // Send message — optimistic render
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

  // ── Cross-browser Realtime sync ───────────────────────────────────────────

  // Layer 1: group-level changes
  groupsChannel = sb
    .channel("study_groups_global")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "study_groups" },
      () => render(),
    )
    .subscribe();

  // Layer 2: broadcast channel — all member actions send + receive here
  membersChannel = sb
    .channel("group_activity")
    .on("broadcast", { event: "members_changed" }, () => render())
    .subscribe();

  window._sgMembersChannel = membersChannel;

  // ── Boot ──────────────────────────────────────────────────────────────────

  render();
}

// ─────────────────────────────────────────────
//  UTILS
// ─────────────────────────────────────────────

export function search(query) {
  searchQuery = query.toLowerCase().trim();

  if (window.groupRender) {
    window.groupRender();
  }
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
