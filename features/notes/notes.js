

/* ------------------------------------------------------------------ */
/* CONFIG                                                              */
/* ------------------------------------------------------------------ */

const LS_KEY = "notes_app_v1";

/* ------------------------------------------------------------------ */
/* [STORAGE LAYER] — swap these functions for Supabase equivalents    */
/* ------------------------------------------------------------------ */

/**
 * Load all folders and notes from storage.
 * Returns false if no data exists (new user).
 * @returns {Promise<boolean>}
 */
async function loadNotesData() {
  try {
    // Fetch both tables at once for efficiency
    const [foldersRes, notesRes] = await Promise.all([
      window.supabase.from("note_folders").select("*"),
      window.supabase.from("notes").select("*"),
    ]);

    if (foldersRes.error) throw foldersRes.error;
    if (notesRes.error) throw notesRes.error;

    appState.folders = foldersRes.data || [];
    appState.notes = notesRes.data || [];

    // Return true if we have folders, false if it's a fresh account
    return appState.folders.length > 0;
  } catch (err) {
    console.error("Supabase Load Error:", err);
    return false;
  }
}

/**
 * Insert a folder into Supabase.
 */
async function insertFolder({ name, parent_id }) {
  const { data, error } = await window.supabase
    .from("note_folders")
    .insert([
      {
        name,
        parent_id: parent_id,
        user_id: currentUser.id,
      },
    ])
    .select()
    .single();

  if (error) {
    console.error("Error creating folder:", error);
    return null;
  }

  appState.folders.push(data);
  return data;
}

/**
 * Update a folder name in Supabase.
 */
async function updateFolder(id, name) {
  const { error } = await window.supabase
    .from("note_folders")
    .update({ name })
    .eq("id", id);

  if (error) {
    console.error("Error updating folder:", error);
    return;
  }

  const f = appState.folders.find((f) => f.id === id);
  if (f) f.name = name;
}

/**
 * Delete folders by IDs.
 * @param {string[]} ids
 */
/**
 * Delete folders by IDs.
 */
async function deleteFolders(ids) {
  // We only need to delete the top-level folder being removed;
  // Supabase's CASCADE handles the children automatically.
  const { error } = await window.supabase
    .from("note_folders")
    .delete()
    .in("id", ids);

  if (error) {
    console.error("Error deleting folders:", error);
    return;
  }

  appState.folders = appState.folders.filter((f) => !ids.includes(f.id));
  appState.notes = appState.notes.filter((n) => !ids.includes(n.folder_id));
}

/**
 * Insert a note into storage.
 * @param {{ folder_id, type, title, content }} note
 * @returns {Promise<Object>} note object with id
 */
/**
 * Insert a note into Supabase.
 */
async function insertNote(note) {
  const { data, error } = await window.supabase
    .from("notes")
    .insert([
      {
        folder_id: note.folder_id,
        type: note.type,
        title: note.title,
        content: note.content,
        user_id: currentUser.id,
      },
    ])
    .select()
    .single();

  if (error) {
    console.error("Error creating note:", error);
    return null;
  }

  appState.notes.push(data);
  return data;
}

/**
 * Delete a note record from Supabase.
 */
async function deleteNoteRecord(id) {
  const { error } = await window.supabase.from("notes").delete().eq("id", id);

  if (error) {
    console.error("Error deleting note:", error);
    return;
  }

  appState.notes = appState.notes.filter((n) => n.id !== id);
}



/*
 * Upload a file to Supabase Storage.
 */
async function uploadNoteFile(file) {
  try {
    const fileExt = file.name.split(".").pop();
    const fileName = `${Date.now()}.${fileExt}`;
    const filePath = `${currentUser.id}/${fileName}`; // Organized by User ID folder

    const { data, error } = await window.supabase.storage
      .from("notes_files")
      .upload(filePath, file);

    if (error) throw error;

    // Get the Public URL
    const {
      data: { publicUrl },
    } = window.supabase.storage.from("notes_files").getPublicUrl(filePath);

    return publicUrl;
  } catch (err) {
    console.error("Upload failed:", err);
    return null;
  }
}

/**
 * Delete a file from Supabase Storage.
 */
async function deleteNoteFile(fileUrl) {
  try {
    // Extract the path from the URL (everything after /notes_files/)
    const path = fileUrl.split("/notes_files/")[1];
    if (!path) return;

    const { error } = await window.supabase.storage
      .from("notes_files")
      .remove([path]);

    if (error) throw error;
  } catch (err) {
    console.error("Delete file failed:", err);
  }
}

/**
 * Seed a default folder for new users.
 */
async function createDefaultFolder() {
  await insertFolder({ name: "General", parent_id: null });
}

/* ------------------------------------------------------------------ */
/* STATE                                                               */
/* ------------------------------------------------------------------ */

let appState = {
  folders: [],
  notes: [],
};

let currentfolder_id = null;
let editingfolder_id = null;
let currentFilter = "all";
let editingNoteId = null;
let currentUser = null;
let searchQuery = "";
/* ------------------------------------------------------------------ */
/* DOM CACHE                                                           */
/* ------------------------------------------------------------------ */

let foldersGrid, notesGrid, breadcrumbPath, addFolderBtn, addNoteBtn, overlay;

function cacheDom() {
  foldersGrid = document.getElementById("folders-display");
  notesGrid = document.getElementById("notes-display");
  breadcrumbPath = document.getElementById("breadcrumb-path");
  addFolderBtn = document.getElementById("add-folder-btn");
  addNoteBtn = document.getElementById("add-note-btn");
  overlay = document.getElementById("modal-overlay");
}

/* ------------------------------------------------------------------ */
/* RENDER                                                             */
/* ------------------------------------------------------------------ */

function render() {
  renderBreadcrumbs();
  renderFolders();
  renderNotes();
  addNoteBtn.style.display = currentfolder_id ? "flex" : "none";
  if (window.lucide) lucide.createIcons();
}

function renderBreadcrumbs() {
  breadcrumbPath.innerHTML = "";

  const root = document.createElement("span");
  root.className = "breadcrumb-item";
  root.textContent = "Collections";
  root.onclick = () => navigateTo(null);
  breadcrumbPath.appendChild(root);

  if (!currentfolder_id) return;

  const path = [];
  let folder = appState.folders.find((f) => f.id === currentfolder_id);

  while (folder) {
    path.unshift(folder);
    folder = appState.folders.find((f) => f.id === folder.parent_id);
  }

  path.forEach((f) => {
    const sep = document.createElement("span");
    sep.className = "breadcrumb-separator";
    sep.innerHTML = `<i data-lucide="chevron-right"></i>`;

    const item = document.createElement("span");
    item.className = "breadcrumb-item";
    item.textContent = f.name;
    item.onclick = () => navigateTo(f.id);

    breadcrumbPath.append(sep, item);
  });
}

function renderFolders() {
  foldersGrid.innerHTML = "";

  const folders = appState.folders.filter(
    (f) => f.parent_id === currentfolder_id,
  );

  if (!folders.length) {
    foldersGrid.innerHTML = '<p class="empty-state">No folders here yet.</p>';
    return;
  }

  folders.forEach((folder) => {
    const noteCount = appState.notes.filter(
      (n) => n.folder_id === folder.id,
    ).length;

    const card = document.createElement("div");
    card.className = "folder-card";
    card.innerHTML = `
      <i data-lucide="folder" class="folder-icon"></i>
      <span class="folder-name">${folder.name}</span>
      <div class="folder-menu">
        <button class="icon-btn edit-folder" title="Rename">
          <i data-lucide="pencil"></i>
        </button>
        <button class="icon-btn delete-folder" title="Delete">
          <i data-lucide="trash-2"></i>
        </button>
      </div>
    `;

    card.onclick = (e) => {
      if (e.target.closest(".icon-btn")) return;
      navigateTo(folder.id);
    };

    card.querySelector(".edit-folder").onclick = (e) => {
      e.stopPropagation();
      openFolderModal(folder.id);
    };

    card.querySelector(".delete-folder").onclick = (e) => {
      e.stopPropagation();
      deleteFolder(folder.id);
    };

    foldersGrid.appendChild(card);
  });
}

function renderNotes() {
  notesGrid.innerHTML = "";

  if (!currentfolder_id && !searchQuery) {
    notesGrid.innerHTML =
      '<p class="empty-state">Select a folder to view notes.</p>';
    return;
  }

  let notes;

  //  GLOBAL SEARCH MODE
  if (searchQuery) {
    const q = searchQuery.toLowerCase();

    notes = appState.notes
      .filter((n) => {
        const title = (n.title || "").toLowerCase();
        const content = (n.content || "").toLowerCase();

        return title.includes(q) || content.includes(q);
      })
      .sort((a, b) => {
        const aTitle = (a.title || "").toLowerCase();
        const bTitle = (b.title || "").toLowerCase();

        // 🔥 PRIORITY: title match first
        const aScore = aTitle.includes(q) ? 2 : 1;
        const bScore = bTitle.includes(q) ? 2 : 1;

        return bScore - aScore;
      });
  } else {
    notes = appState.notes.filter((n) => n.folder_id === currentfolder_id);
  }

  // APPLY FILTER
  if (currentFilter !== "all") {
    notes = notes.filter((n) => n.type === currentFilter);
  }

  if (!notes.length) {
    notesGrid.innerHTML =
      '<p class="empty-state">No notes in this folder yet.</p>';
    return;
  }

  notes.forEach((note) => {
    const card = document.createElement("div");
    card.className = "note-card";

    let body = "";

    if (note.type === "text") {
      body = `<div class="note-text">
  ${highlight(escapeHtml(note.content || ""), searchQuery)}
</div>`;
    }

    if (note.type === "image") {
      body = `<img src="${note.content}" class="note-img" alt="${note.title}" loading="lazy" />`;
    }

    if (note.type === "pdf") {
      body = `
        <iframe src="${note.content}" class="pdf-preview" title="${note.title}"></iframe>
        <button class="secondary-btn" style="margin-top:8px;" onclick="window.open('${note.content}')">Open PDF</button>
      `;
    }

    if (note.type === "youtube") {
      const id = extractYoutubeId(note.content);
      body = `
        <div class="video-container">
          <iframe src="https://www.youtube.com/embed/${id}" allowfullscreen title="${note.title}"></iframe>
        </div>
      `;
    }

    if (note.type === "url") {
      let data;
      try {
        data = JSON.parse(note.content);
      } catch {
        return;
      }
      body = `
        <div class="url-preview" onclick="window.open('${data.url}', '_blank')">
          <img src="${data.favicon}" alt="favicon" />
          <div>
            <h4>${data.title}</h4>
            <p>${data.description}</p>
          </div>
        </div>
      `;
    }

    card.innerHTML = `
  <div class="note-header">
    <div style="display:flex;flex-direction:column;">
      <div style="display:flex;align-items:center;gap:6px;overflow:hidden;">
        <span class="note-type-tag ${note.type}">${note.type}</span>
        <span class="note-title">
          ${highlight(note.title || "", searchQuery)}
        </span>
      </div>

      ${
        searchQuery
          ? `<span class="note-path">${getFolderPath(note.folder_id)}</span>`
          : ""
      }
    </div>

    <button class="icon-btn delete-note" title="Delete note">
      <i data-lucide="trash-2"></i>
    </button>
  </div>
  <div class="note-body">${body}</div>
`;

    card.querySelector(".delete-note").onclick = () => deleteNote(note.id);

    card.addEventListener("click", (e) => {
      if (e.target.closest(".delete-note")) return;
      openViewModal(note);
    });

    notesGrid.appendChild(card);
  });
}

function getFolderPath(folderId) {
  let path = [];
  let current = appState.folders.find((f) => f.id === folderId);

  while (current) {
    path.unshift(current.name);
    current = appState.folders.find((f) => f.id === current.parent_id);
  }

  return path.join(" / ");
}
/* ------------------------------------------------------------------ */
/* ACTIONS                                                            */
/* ------------------------------------------------------------------ */

function navigateTo(id) {
  currentfolder_id = id;
  render();
}

async function deleteNote(id) {
  const note = appState.notes.find((n) => n.id === id);
  if (!note) return;

  if (note.type === "image" || note.type === "pdf") {
    await deleteNoteFile(note.content);
  }

  await deleteNoteRecord(id);
  render();
}

async function deleteFolder(id) {
  if (!confirm("Delete this folder and all its contents?")) return;

  // We only need to pass the ID of the parent.
  // The 'deleteFolders' function we wrote earlier handles the Supabase call.
  await deleteFolders([id]);

  // If we were inside the folder we just deleted, go back to root
  if (currentfolder_id === id) {
    navigateTo(null);
  } else {
    render();
  }
}

/* ------------------------------------------------------------------ */
/* MODALS                                                             */
/* ------------------------------------------------------------------ */

function closeModals() {
  overlay.classList.add("hidden");

  document
    .querySelectorAll(".modal-content")
    .forEach((m) => m.classList.add("hidden"));

  editingfolder_id = null;
  editingNoteId = null;
}

function openFolderModal(id = null) {
  editingfolder_id = id;
  const title = document.getElementById("folder-modal-title");
  if (title) title.textContent = id ? "Rename Folder" : "Create Folder";
  overlay.classList.remove("hidden");
  document.getElementById("folder-modal").classList.remove("hidden");
  document.getElementById("folder-name-input").value = id
    ? appState.folders.find((f) => f.id === id)?.name || ""
    : "";
}

function openNoteModal(note = null) {
  overlay.classList.remove("hidden");
  document.getElementById("note-modal").classList.remove("hidden");

  const typeSelect = document.getElementById("note-type-select");
  const titleInput = document.getElementById("note-title-input");
  const textInput = document.getElementById("note-content-input");
  const ytInput = document.getElementById("note-yt-input");
  const urlInput = document.getElementById("note-url-input");

  editingNoteId = note ? note.id : null;

  if (note) {
    // 🔥 EDIT MODE
    typeSelect.value = note.type;
    titleInput.value = note.title || "";

    if (note.type === "text") {
      textInput.value = note.content || "";
    }

    if (note.type === "youtube") {
      ytInput.value = note.content || "";
    }

    if (note.type === "url") {
      try {
        const parsed = JSON.parse(note.content);
        urlInput.value = parsed.url;
      } catch {}
    }

    document.querySelector("#note-modal h2").textContent = "Edit Note";
    document.getElementById("save-note").textContent = "Save Changes";
  } else {
    // 🔥 CREATE MODE
    editingNoteId = null;
    document.querySelector("#note-modal h2").textContent = "Add Note";
    document.getElementById("save-note").textContent = "Add Note";

    titleInput.value = "";
    textInput.value = "";
    ytInput.value = "";
    urlInput.value = "";
    document.getElementById("note-file-input").value = "";
  }

  switchNoteType({ target: typeSelect });
}

function openViewModal(note) {
  overlay.classList.remove("hidden");

  const modal = document.getElementById("view-note-modal");
  modal.classList.remove("hidden");

  const title = document.getElementById("view-note-title");
  const body = document.getElementById("view-note-body");

  title.textContent = note.title;

  let contentHTML = "";

  if (note.type === "text") {
    contentHTML = `<div class="note-text">${escapeHtml(note.content)}</div>`;
  }

  if (note.type === "image") {
    contentHTML = `<img src="${note.content}" style="width:100%; border-radius:10px;" />`;
  }

  if (note.type === "pdf") {
    contentHTML = `<iframe src="${note.content}" style="width:100%; height:400px;"></iframe>`;
  }

  if (note.type === "youtube") {
    const id = extractYoutubeId(note.content);
    contentHTML = `<iframe src="https://www.youtube.com/embed/${id}" style="width:100%; height:400px;" allowfullscreen></iframe>`;
  }

  if (note.type === "url") {
    const data = JSON.parse(note.content);
    contentHTML = `
      <div onclick="window.open('${data.url}', '_blank')" style="cursor:pointer;">
        <h3>${data.title}</h3>
        <p>${data.description}</p>
      </div>
    `;
  }

  body.innerHTML = contentHTML;

  // 🔥 EDIT BUTTON
  document.getElementById("edit-note-btn").onclick = () => {
    modal.classList.add("hidden");
    openNoteModal(note);
  };

  // 🔥 CLOSE BUTTON
  document.getElementById("close-view-note").onclick = closeModals;
}

/* ------------------------------------------------------------------ */
/* EVENTS                                                             */
/* ------------------------------------------------------------------ */

function bindEvents() {
  addFolderBtn.onclick = () => openFolderModal();
  addNoteBtn.onclick = () => openNoteModal();

  document.getElementById("cancel-folder").onclick = closeModals;
  document.getElementById("cancel-note").onclick = closeModals;

  overlay.onclick = (e) => {
    if (e.target === overlay) closeModals();
  };

  document.getElementById("save-folder").onclick = saveFolder;
  document.getElementById("save-note").onclick = saveNote;

  document.getElementById("note-type-select").onchange = switchNoteType;

  document.querySelectorAll(".layout-btn").forEach((btn) => {
    btn.onclick = () => {
      const cols = btn.dataset.cols;

      // active button UI
      document
        .querySelectorAll(".layout-btn")
        .forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      // update NOTES grid
      notesGrid.className = `notes-grid cols-${cols}`;

      //  update FOLDERS grid
      foldersGrid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    };
  });
  const filter = document.getElementById("note-filter");
  if (filter) {
    filter.onchange = (e) => {
      currentFilter = e.target.value;
      renderNotes();
    };
  }
}

async function saveFolder() {
  const name = document.getElementById("folder-name-input").value.trim();
  if (!name) return;

  if (editingfolder_id) {
    await updateFolder(editingfolder_id, name);
  } else {
    await insertFolder({ name, parent_id: currentfolder_id });
  }

  editingfolder_id = null;
  closeModals();
  render();
}

async function saveNote() {
  const type = document.getElementById("note-type-select").value;
  const title =
    document.getElementById("note-title-input")?.value.trim() || "Untitled";

  let content = "";

  if (type === "text") {
    content = document.getElementById("note-content-input").value.trim();
  }

  if (type === "youtube") {
    content = document.getElementById("note-yt-input").value.trim();
  }

  if (type === "url") {
    const url = document.getElementById("note-url-input").value.trim();
    if (!url) return;
    content = JSON.stringify({
      url,
      title: url.replace(/^https?:\/\//, "").split("/")[0],
      description: "Click to open website",
      favicon: `https://www.google.com/s2/favicons?domain=${url}`,
    });
  }

  if (type === "image" || type === "pdf") {
    const file = document.getElementById("note-file-input").files[0];
    if (!file) return;

    const fileUrl = await uploadNoteFile(file);
    if (!fileUrl) return;

    content = fileUrl;
  }

  if (!content) return;

  if (editingNoteId) {
    // UPDATE EXISTING NOTE IN SUPABASE
    const { error } = await window.supabase
      .from("notes")
      .update({
        type,
        title,
        content,
      })
      .eq("id", editingNoteId);

    if (error) {
      console.error("Error updating note:", error);
      return;
    }

    const note = appState.notes.find((n) => n.id === editingNoteId);
    if (note) {
      note.type = type;
      note.title = title;
      note.content = content;
    }
  } else {
    // 🔥 CREATE NEW NOTE
    await insertNote({ folder_id: currentfolder_id, type, title, content });
  }

  editingNoteId = null;
  closeModals();
  render();
}

function switchNoteType(e) {
  const t = e.target.value;
  ["text", "file", "youtube", "url"].forEach((id) => {
    const el = document.getElementById(`${id}-fields`);
    if (el) el.classList.add("hidden");
  });

  const map = {
    text: "text",
    image: "file",
    pdf: "file",
    youtube: "youtube",
    url: "url",
  };
  const target = document.getElementById(`${map[t]}-fields`);
  if (target) target.classList.remove("hidden");
}

/* ------------------------------------------------------------------ */
/* HELPERS                                                            */
/* ------------------------------------------------------------------ */

function extractYoutubeId(url) {
  const r = /^.*(youtu\.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
  const m = url.match(r);
  return m && m[2].length === 11 ? m[2] : url;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function highlight(text, query) {
  if (!query) return text;

  const regex = new RegExp(`(${query})`, "gi");
  return text.replace(regex, `<mark class="search-highlight">$1</mark>`);
}

/**
 * Helper to return the correct Lucide icon name based on note type
 */
function getNoteIcon(type) {
  const icons = {
    text: "file-text",
    image: "image",
    pdf: "file-type-2",
    youtube: "youtube",
    url: "link",
  };
  return `<i data-lucide="${icons[type] || "file"}"></i>`;
}

/* ------------------------------------------------------------------ */
/* UNIVERSAL SEARCH IMPLEMENTATION (SUPABASE)                         */
/* ------------------------------------------------------------------ */

// --- In notes.js ---
export function search(query) {
  // 1. Set the global search variable used by renderNotes
  searchQuery = query.toLowerCase().trim();

  // 2. Clear current folder so it searches EVERYTHING
  currentfolder_id = null;

  // 3. Hide folder section if searching, show it if query is empty
  const folderSection = document.querySelector(".folders-section");
  if (folderSection) {
    folderSection.style.display = searchQuery.length > 0 ? "none" : "block";
  }

  // 4. Run the standard render function
  // This uses your original card-building logic (no more broken links!)
  renderNotes();
}

export async function init(user) {
  currentUser = user; // Save the user passed from dashboard.js
  cacheDom();
  bindEvents();

  const hasData = await loadNotesData();
  // If no folders found in Supabase, we'll create a default one
  if (!hasData) await createDefaultFolder();

  render();
}
