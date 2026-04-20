

/* ------------------------------------------------------------------ */
/* CONFIG                                                              */
/* ------------------------------------------------------------------ */

// localStorage key used to track which notifications have already been
const NOTIF_SENT_KEY = "kanban_notif_sent_v1"; // { "taskText|deadline": "YYYY-MM-DD" }

/* ------------------------------------------------------------------ */
/* [SUPABASE STORAGE LAYER]                                            */
/* ------------------------------------------------------------------ */

async function loadBoards() {
  const { data, error } = await window.supabase
    .from("kanban_boards")
    .select("*");

  if (error) {
    console.error("Supabase Load Error:", error);
    return null;
  }

  if (!data || data.length === 0) return null;

  const boardsObj = {};
  data.forEach((board) => {
    boardsObj[board.name] = board.data;
  });
  return boardsObj;
}

async function saveBoard(boardName, boardData) {
  const { error } = await window.supabase.from("kanban_boards").upsert(
    {
      user_id: window.currentUser.id,
      name: boardName,
      data: boardData,
    },
    { onConflict: "user_id, name" },
  );

  if (error) console.error("Failed to save board:", boardName, error);
}

async function deleteBoard(boardName) {
  const { error } = await window.supabase
    .from("kanban_boards")
    .delete()
    .eq("user_id", window.currentUser.id)
    .eq("name", boardName);

  if (error) console.error("Failed to delete board:", boardName, error);
}

async function renameBoard(oldName, newName, boardData) {
  await deleteBoard(oldName);
  await saveBoard(newName, boardData);
}

/* ------------------------------------------------------------------ */
/* DEFAULT DATA                                                        */
/* ------------------------------------------------------------------ */

function makeDefaultColumns() {
  return [
    { title: "To-Be", tasks: [] },
    { title: "In-Process", tasks: [] },
    { title: "Done", tasks: [] },
  ];
}

async function createDefault() {
  const defaultName = "My First Project";
  const defaultCols = makeDefaultColumns();
  window.kanbanData = { [defaultName]: defaultCols };
  window.activeFolder = defaultName;
  await saveBoard(defaultName, defaultCols);
}

/* ------------------------------------------------------------------ */
/* GLOBAL STATE                                                        */
/* ------------------------------------------------------------------ */

window.kanbanData = {};
window.activeFolder = null;

let folderToEdit = null;
let deadlineCardMeta = null; // { colIndex, taskIndex }

/* ------------------------------------------------------------------ */
/* DEADLINE HELPERS                                                    */
/* ------------------------------------------------------------------ */

/**
 * Returns days remaining from today to dateStr (YYYY-MM-DD).
 * Negative = overdue.
 */
function daysUntil(dateStr) {
  if (!dateStr) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr + "T00:00:00");
  return Math.round((target - today) / 86400000);
}

/**
 * Returns CSS class + label for a deadline.
 */
function deadlineStatus(dateStr) {
  const days = daysUntil(dateStr);
  if (days === null) return null;

  if (days < 0) {
    return {
      cls: "red",
      label: `Overdue by ${Math.abs(days)}d`,
      cardCls: "deadline-red",
    };
  } else if (days <= 3) {
    return {
      cls: "red",
      label: days === 0 ? "Due today!" : `${days}d left`,
      cardCls: "deadline-red",
    };
  } else if (days <= 6) {
    return {
      cls: "orange",
      label: `${days}d left`,
      cardCls: "deadline-orange",
    };
  } else if (days <= 9) {
    return { cls: "green", label: `${days}d left`, cardCls: "deadline-green" };
  } else {
    return { cls: "neutral", label: `${days}d left`, cardCls: "" };
  }
}

function formatDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/* ------------------------------------------------------------------ */
/* DEADLINE NOTIFICATIONS                                              */
/* ------------------------------------------------------------------ */

function checkDeadlineNotifications() {
  if (typeof window.addNotification !== "function") return;

  const todayStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  let sentLog = {};

  try {
    sentLog = JSON.parse(localStorage.getItem(NOTIF_SENT_KEY) || "{}");
  } catch {
    sentLog = {};
  }

  // Prune entries older than today to keep localStorage tidy
  Object.keys(sentLog).forEach((k) => {
    if (sentLog[k] !== todayStr) delete sentLog[k];
  });

  Object.entries(window.kanbanData).forEach(([boardName, columns]) => {
    if (!Array.isArray(columns)) return;

    columns.forEach((col) => {
      if (!Array.isArray(col.tasks)) return;

      col.tasks.forEach((task) => {
        if (!task || !task.deadline || task.completed) return;

        const days = daysUntil(task.deadline);
        if (days === null) return;

        // Only fire for ≤3 days remaining OR overdue
        if (days > 3) return;

        // Unique key per task per day
        const notifKey = `${boardName}|${task.text}|${task.deadline}`;

        // Already sent today → skip
        if (sentLog[notifKey] === todayStr) return;

        // Build the message
        let title, message;
        if (days < 0) {
          const over = Math.abs(days);
          title = "⚠️ Task Overdue";
          message = `"${task.text}" in [${boardName}] is overdue by ${over} day${over === 1 ? "" : "s"}.`;
        } else if (days === 0) {
          title = "🔴 Due Today!";
          message = `"${task.text}" in [${boardName}] is due today!`;
        } else {
          title = `🔔 Deadline in ${days} Day${days === 1 ? "" : "s"}`;
          message = `"${task.text}" in [${boardName}] is due in ${days} day${days === 1 ? "" : "s"}.`;
        }

        window.addNotification({ source: "kanban", title, message });

        // Mark as sent for today
        sentLog[notifKey] = todayStr;
      });
    });
  });

  // Persist updated log
  try {
    localStorage.setItem(NOTIF_SENT_KEY, JSON.stringify(sentLog));
  } catch {
    // quota exceeded — non-critical
  }
}

/* ------------------------------------------------------------------ */
/* STATE NORMALIZATION                                                 */
/* ------------------------------------------------------------------ */

function normalizeState() {
  const keys = Object.keys(window.kanbanData);
  if (!keys.length) {
    window.kanbanData = { "Default Project": makeDefaultColumns() };
    window.activeFolder = "Default Project";
    saveBoard("Default Project", window.kanbanData["Default Project"]);
    return;
  }
  if (!window.kanbanData[window.activeFolder]) {
    window.activeFolder = keys[0];
  }
}

/* ------------------------------------------------------------------ */
/* DOM WAIT                                                            */
/* ------------------------------------------------------------------ */

function waitForKanbanDOM() {
  return new Promise((resolve) => {
    const check = () => {
      if (
        document.getElementById("folder-list") &&
        document.getElementById("columns-container") &&
        document.getElementById("open-folder-modal")
      ) {
        resolve();
      } else {
        requestAnimationFrame(check);
      }
    };
    check();
  });
}

/* ------------------------------------------------------------------ */
/* SAVE WRAPPER                                                        */
/* ------------------------------------------------------------------ */

function saveActiveBoard() {
  const boardName = window.activeFolder;
  const boardData = window.kanbanData[boardName];
  if (!boardName || !boardData) return;
  saveBoard(boardName, boardData);
}

/* ------------------------------------------------------------------ */
/* RENDER UI                                                           */
/* ------------------------------------------------------------------ */

function renderKanbanUI() {
  normalizeState();

  const folderList = document.getElementById("folder-list");
  const columnsContainer = document.getElementById("columns-container");
  const folderTitle = document.getElementById("current-folder-name");

  if (!folderList || !columnsContainer || !folderTitle) return;

  /* ---- Folder Tabs ---- */
  folderList.innerHTML = "";

  Object.keys(window.kanbanData).forEach((name) => {
    const tab = document.createElement("div");
    tab.className = `folder-tab ${name === window.activeFolder ? "active" : ""}`;
    tab.innerHTML = `
      <span class="folder-name-text">${name}</span>
      <div class="folder-actions">
        <button class="folder-action-btn edit-folder" title="Rename"><i data-lucide="pencil"></i></button>
        <button class="folder-action-btn delete-folder" title="Delete"><i data-lucide="trash-2"></i></button>
      </div>
    `;

    tab.onclick = (e) => {
      if (e.target.closest(".folder-action-btn")) return;
      window.activeFolder = name;
      renderKanbanUI();
    };

    tab.querySelector(".edit-folder").onclick = (e) => {
      e.stopPropagation();
      folderToEdit = name;
      document.getElementById("modal-title").innerText = "Rename Board";
      document.getElementById("new-folder-input").value = name;
      document.getElementById("folder-modal").style.display = "flex";
    };

    tab.querySelector(".delete-folder").onclick = async (e) => {
      e.stopPropagation();
      if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
      await deleteBoard(name);
      delete window.kanbanData[name];
      window.activeFolder = Object.keys(window.kanbanData)[0] || null;
      renderKanbanUI();
    };

    folderList.appendChild(tab);
  });

  folderTitle.innerText = window.activeFolder || "";
  columnsContainer.innerHTML = "";

  const columns = window.kanbanData[window.activeFolder];
  if (!columns) return;

  /* ---- Columns ---- */
  columns.forEach((col, colIndex) => {
    const column = document.createElement("div");
    column.className = "kanban-column";

    column.innerHTML = `
      <div class="column-header">
        <div class="col-header-left">
          <span class="col-title" contenteditable="true">${col.title}</span>
          <span class="column-count">${col.tasks.length}</span>
        </div>
        <button class="del-col" title="Delete column"><i data-lucide="x"></i></button>
      </div>
      <div class="task-list"></div>
      <div class="add-task-area">
        <textarea class="t-input" placeholder="New task…" rows="2"></textarea>
        <button class="t-submit">Add Task</button>
      </div>
    `;

    column.querySelector(".col-title").onblur = (e) => {
      col.title = e.target.innerText.trim() || col.title;
      saveActiveBoard();
    };

    column.querySelector(".del-col").onclick = () => {
      if (
        col.tasks.length &&
        !confirm(`Delete "${col.title}" and its ${col.tasks.length} task(s)?`)
      )
        return;
      columns.splice(colIndex, 1);
      saveActiveBoard();
      renderKanbanUI();
    };

    const taskList = column.querySelector(".task-list");
    const input = column.querySelector(".t-input");

    const addTask = () => {
      const val = input.value.trim();
      if (!val) return;
      col.tasks.push({ text: val, deadline: null, completed: false });
      input.value = "";
      saveActiveBoard();
      renderKanbanUI();
    };

    column.querySelector(".t-submit").onclick = addTask;
    input.onkeydown = (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        addTask();
      }
    };

    /* ---- Tasks ---- */
    col.tasks.forEach((task, taskIndex) => {
      // Support legacy string tasks (migration-safe)
      if (typeof task === "string") {
        col.tasks[taskIndex] = { text: task, deadline: null, completed: false };
        task = col.tasks[taskIndex];
      } else if (task.completed === undefined) {
        task.completed = false;
      }

      // Completed tasks never get deadline urgency styling
      const status =
        task.deadline && !task.completed ? deadlineStatus(task.deadline) : null;

      const card = document.createElement("div");
      card.className = `kanban-card${status && status.cardCls ? " " + status.cardCls : ""}${task.completed ? " task-completed" : ""}`;
      card.draggable = true;

      // Store task index on the DOM element so syncDragPositions can read it
      card.dataset.taskIndex = taskIndex;
      card.dataset.colIndex = colIndex;

      const deadlineBadgeHTML = status
        ? `<div class="deadline-badge ${status.cls}"><i data-lucide="calendar" class="badge-icon"></i> ${formatDate(task.deadline)} · ${status.label}</div>`
        : task.deadline && task.completed
          ? `<div class="deadline-badge neutral"><i data-lucide="calendar" class="badge-icon"></i> ${formatDate(task.deadline)} · Done ✓</div>`
          : "";

      card.innerHTML = `
  <div class="c-text" contenteditable="true"${task.completed ? ' style="text-decoration:line-through;opacity:0.55;"' : ""}>${task.text}</div>
  ${deadlineBadgeHTML}
  <div class="card-actions">
    <button class="toggle-done-btn${task.completed ? " done" : ""}">
      <i data-lucide="${task.completed ? "rotate-ccw" : "check-circle"}" class="btn-icon"></i>
      ${task.completed ? "Mark Undone" : "Mark Done"}
    </button>

    <button class="set-deadline-btn">
      <i data-lucide="calendar" class="btn-icon"></i>
      ${task.deadline ? "Edit deadline" : "Set deadline"}
    </button>

    <button class="del-card">
      <i data-lucide="trash-2" class="btn-icon"></i>Delete
    </button>
  </div>
`;

      card.querySelector(".del-card").onclick = () => {
        col.tasks.splice(taskIndex, 1);
        saveActiveBoard();
        renderKanbanUI();
      };

      card.querySelector(".c-text").onblur = (e) => {
        col.tasks[taskIndex].text = e.target.innerText.trim() || task.text;
        saveActiveBoard();
      };

      card.querySelector(".set-deadline-btn").onclick = () => {
        deadlineCardMeta = { colIndex, taskIndex };
        const dlInput = document.getElementById("deadline-date-input");
        dlInput.value = task.deadline || "";
        document.getElementById("deadline-modal").style.display = "flex";
      };

      card.querySelector(".toggle-done-btn").onclick = () => {
        col.tasks[taskIndex].completed = !col.tasks[taskIndex].completed;
        saveActiveBoard();
        renderKanbanUI();
      };

      /* Drag events */
      card.addEventListener("dragstart", (e) => {
        card.classList.add("dragging");
        e.dataTransfer.effectAllowed = "move";
      });
      card.addEventListener("dragend", () => {
        card.classList.remove("dragging");
        document
          .querySelectorAll(".task-list")
          .forEach((tl) => tl.classList.remove("drag-over"));
        syncDragPositions();
      });

      taskList.appendChild(card);
    });

    /* Drop zone */
    taskList.addEventListener("dragover", (e) => {
      e.preventDefault();
      taskList.classList.add("drag-over");
      const dragging = document.querySelector(".dragging");
      if (!dragging) return;
      const siblings = [
        ...taskList.querySelectorAll(".kanban-card:not(.dragging)"),
      ];
      const next = siblings.find((s) => {
        const box = s.getBoundingClientRect();
        return e.clientY < box.top + box.height / 2;
      });
      taskList.insertBefore(dragging, next || null);
    });

    taskList.addEventListener("dragleave", (e) => {
      if (!taskList.contains(e.relatedTarget)) {
        taskList.classList.remove("drag-over");
      }
    });

    taskList.addEventListener("drop", () => {
      taskList.classList.remove("drag-over");
    });

    columnsContainer.appendChild(column);
  });

  if (window.lucide) lucide.createIcons();
}

/* ------------------------------------------------------------------ */
/* DRAG SYNC                                                           */
/* ------------------------------------------------------------------ */

function syncDragPositions() {
  // Build a flat lookup: taskText → full task object
  // (across all cols of the active board, pre-drag state)
  const taskLookup = new Map();
  (window.kanbanData[window.activeFolder] || []).forEach((col) => {
    col.tasks.forEach((task) => {
      if (task && task.text) {
        // Key by text; last-write wins for duplicates (edge case)
        taskLookup.set(task.text, task);
      }
    });
  });

  const cols = document.querySelectorAll(".kanban-column");
  window.kanbanData[window.activeFolder] = [...cols].map((col) => ({
    title: col.querySelector(".col-title").innerText.trim(),
    tasks: [...col.querySelectorAll(".kanban-card")].map((card) => {
      const text = card.querySelector(".c-text")?.innerText.trim() || "";
      const existing = taskLookup.get(text);
      return {
        text,
        deadline: existing?.deadline ?? null,
        completed: existing?.completed ?? false,
      };
    }),
  }));

  saveActiveBoard();
}

/* ------------------------------------------------------------------ */
/* MODAL SETUP                                                         */
/* ------------------------------------------------------------------ */

function setupModals() {
  /* ---- Board / Folder modal ---- */
  const modal = document.getElementById("folder-modal");
  if (!modal) return;

  document.getElementById("open-folder-modal").onclick = () => {
    folderToEdit = null;
    document.getElementById("modal-title").innerText = "Create New Board";
    document.getElementById("new-folder-input").value = "";
    modal.style.display = "flex";
  };

  document.getElementById("close-modal").onclick = () =>
    (modal.style.display = "none");
  modal.onclick = (e) => {
    if (e.target === modal) modal.style.display = "none";
  };

  document.getElementById("confirm-folder").onclick = async () => {
    const val = document.getElementById("new-folder-input").value.trim();
    if (!val) return;

    const isRename = !!folderToEdit;
    const nameExists =
      window.kanbanData[val] && (!isRename || val !== folderToEdit);

    if (nameExists) {
      if (!confirm(`A board named "${val}" already exists. Overwrite it?`))
        return;
    }

    if (isRename) {
      const boardData = window.kanbanData[folderToEdit];
      if (val !== folderToEdit) {
        await renameBoard(folderToEdit, val, boardData);
        delete window.kanbanData[folderToEdit];
      }
      window.kanbanData[val] = boardData;
    } else {
      window.kanbanData[val] = makeDefaultColumns();
      await saveBoard(val, window.kanbanData[val]);
    }

    window.activeFolder = val;
    modal.style.display = "none";
    renderKanbanUI();
  };

  /* ---- Add Column ---- */
  document.getElementById("add-column-btn").onclick = () => {
    window.kanbanData[window.activeFolder].push({
      title: "New Column",
      tasks: [],
    });
    saveActiveBoard();
    renderKanbanUI();
  };

  /* ---- Deadline modal ---- */
  const dlModal = document.getElementById("deadline-modal");
  if (!dlModal) return;

  document.getElementById("close-deadline-modal").onclick = () =>
    (dlModal.style.display = "none");
  dlModal.onclick = (e) => {
    if (e.target === dlModal) dlModal.style.display = "none";
  };

  document.getElementById("clear-deadline").onclick = async () => {
    if (!deadlineCardMeta) return;
    const { colIndex, taskIndex } = deadlineCardMeta;
    window.kanbanData[window.activeFolder][colIndex].tasks[taskIndex].deadline =
      null;
    saveActiveBoard();
    dlModal.style.display = "none";
    renderKanbanUI();
  };

  document.getElementById("confirm-deadline").onclick = () => {
    if (!deadlineCardMeta) return;
    const val = document.getElementById("deadline-date-input").value;
    if (!val) return;
    const { colIndex, taskIndex } = deadlineCardMeta;
    window.kanbanData[window.activeFolder][colIndex].tasks[taskIndex].deadline =
      val;
    saveActiveBoard();
    dlModal.style.display = "none";
    renderKanbanUI();

    // Immediately check if this new deadline already warrants a notification
    checkDeadlineNotifications();
  };
}

/* ------------------------------------------------------------------ */
/* INIT                                                                */
/* ------------------------------------------------------------------ */

async function initKanban() {
  await waitForKanbanDOM();

  const data = await loadBoards();

  if (data) {
    window.kanbanData = data;
    window.activeFolder =
      window.activeFolder in window.kanbanData
        ? window.activeFolder
        : Object.keys(window.kanbanData)[0];
  } else {
    await createDefault();
  }

  setupModals();
  renderKanbanUI();

  // Run notification check once on load (after boards are loaded)
  checkDeadlineNotifications();
}

export async function init(user) {
  window.currentUser = user;
  await initKanban();
}
