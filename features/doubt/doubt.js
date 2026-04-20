

// ─────────────────────────────────────────────
//  TAXONOMY  (stream → branch → subject)
// ─────────────────────────────────────────────

const TAXONOMY = {
  Science: {
    branches: [
      "Computer Engineering / IT",
      "Mechanical Engineering",
      "Electrical Engineering",
      "Electronics & Telecommunication (EXTC)",
      "Civil Engineering",
      "Chemical Engineering",
      "Biotechnology",
      "Mathematics",
      "Physics",
      "Chemistry",
    ],
    subjects: {
      "Computer Engineering / IT": [
        "Data Structures",
        "Algorithms",
        "Operating Systems",
        "Database Management Systems (DBMS)",
        "Computer Networks",
        "Theory of Computation",
        "Compiler Design",
        "Software Engineering",
        "Artificial Intelligence",
        "Machine Learning",
        "Cyber Security",
        "Web Development",
        "Mobile App Development",
      ],
      "Mechanical Engineering": [
        "Thermodynamics",
        "Fluid Mechanics",
        "Strength of Materials",
        "Theory of Machines",
        "Manufacturing Processes",
        "Heat Transfer",
      ],
      "Electrical Engineering": [
        "Circuit Theory",
        "Control Systems",
        "Power Systems",
        "Signals and Systems",
        "Analog Electronics",
        "Digital Electronics",
        "Microprocessors",
        "Communication Systems",
      ],
      "Electronics & Telecommunication (EXTC)": [
        "Circuit Theory",
        "Control Systems",
        "Signals and Systems",
        "Analog Electronics",
        "Digital Electronics",
        "Microprocessors",
        "Communication Systems",
      ],
      "Civil Engineering": [
        "Structural Engineering",
        "Geotechnical Engineering",
        "Transportation Engineering",
        "Environmental Engineering",
        "Surveying",
      ],
      "Chemical Engineering": [
        "Thermodynamics",
        "Fluid Mechanics",
        "Heat Transfer",
        "Organic Chemistry",
        "Physical Chemistry",
      ],
      Biotechnology: [
        "Organic Chemistry",
        "Physical Chemistry",
        "Probability",
        "Linear Algebra",
      ],
      Mathematics: ["Linear Algebra", "Calculus", "Probability"],
      Physics: ["Quantum Physics", "Signals and Systems", "Calculus"],
      Chemistry: ["Organic Chemistry", "Physical Chemistry"],
    },
  },
  Commerce: {
    branches: [
      "B.Com",
      "BBA",
      "Accounting & Finance",
      "Banking & Insurance",
      "Economics",
    ],
    subjects: {
      "B.Com": [
        "Financial Accounting",
        "Cost Accounting",
        "Business Law",
        "Economics",
        "Taxation",
        "Auditing",
        "Financial Management",
        "Business Statistics",
      ],
      BBA: [
        "Marketing",
        "Human Resource Management",
        "Financial Management",
        "Business Law",
        "Economics",
        "Business Statistics",
      ],
      "Accounting & Finance": [
        "Financial Accounting",
        "Cost Accounting",
        "Auditing",
        "Taxation",
        "Financial Management",
      ],
      "Banking & Insurance": [
        "Financial Accounting",
        "Economics",
        "Financial Management",
        "Business Statistics",
      ],
      Economics: ["Economics", "Business Statistics", "Financial Management"],
    },
  },
  Arts: {
    branches: [
      "BA",
      "Psychology",
      "Sociology",
      "Political Science",
      "History",
      "English Literature",
      "Philosophy",
      "Mass Communication",
    ],
    subjects: {
      BA: [
        "Indian History",
        "World History",
        "Political Theory",
        "Public Administration",
        "Literature Analysis",
      ],
      Psychology: ["Psychology Basics", "Cognitive Psychology"],
      Sociology: ["Sociology Theories"],
      "Political Science": ["Political Theory", "Public Administration"],
      History: ["Indian History", "World History"],
      "English Literature": ["Literature Analysis"],
      Philosophy: ["Political Theory"],
      "Mass Communication": ["Journalism", "Media Studies"],
    },
  },
};

const STREAM_META = {
  Science: {
    color: "var(--stream-science)",
    bg: "var(--stream-science-bg)",
    emoji: "",
  },
  Commerce: {
    color: "var(--stream-commerce)",
    bg: "var(--stream-commerce-bg)",
    emoji: "",
  },
  Arts: {
    color: "var(--stream-arts)",
    bg: "var(--stream-arts-bg)",
    emoji: "",
  },
};

// ─────────────────────────────────────────────
//  SUPABASE ADAPTER
// ─────────────────────────────────────────────

async function getCurrentUser() {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("username")
    .eq("id", user.id)
    .single();

  return {
    id: user.id,
    username: profile?.username || null,
  };
}

const db = {
  // ── Questions ──────────────────────────────────────────────────────────

  async getQuestions() {
    const { data, error } = await supabase.from("questions").select(`
        *,
        answers!answers_question_id_fkey(count),
        votes!votes_question_id_fkey(value)
      `);

    if (error) return { data: null, error };

    const enriched = (data || []).map((q) => ({
      ...q,
      votes: q.votes.reduce((s, v) => s + v.value, 0),
      answers_count: q.answers[0]?.count || 0,
    }));

    enriched.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return { data: enriched, error: null };
  },

  async insertQuestion({
    title,
    body,
    stream,
    branch,
    subject,
    user_id,
    username,
    image_url,
  }) {
    return supabase.from("questions").insert({
      title,
      body,
      stream,
      branch,
      subject,
      user_id,
      username,
      image_url: image_url || null,
    });
  },

  async deleteQuestion(id) {
    return supabase.from("questions").delete().eq("id", id);
  },

  async setAcceptedAnswer(questionId, currentAcceptedId, answerId) {
    const newVal = currentAcceptedId === answerId ? null : answerId;
    return supabase
      .from("questions")
      .update({ accepted_answer_id: newVal })
      .eq("id", questionId);
  },

  // ── Answers ────────────────────────────────────────────────────────────

  async getAnswers(questionId) {
    const { data, error } = await supabase
      .from("answers")
      .select(
        `
        *,
        votes!votes_answer_id_fkey(value)
      `,
      )
      .eq("question_id", questionId)
      .order("created_at", { ascending: false });

    if (error) return { data: null, error };

    const enriched = (data || []).map((a) => ({
      ...a,
      votes: a.votes.reduce((s, v) => s + v.value, 0),
    }));

    return { data: enriched, error: null };
  },

  async insertAnswer({ question_id, body, user_id, username }) {
    return supabase
      .from("answers")
      .insert({ question_id, body, user_id, username });
  },

  async deleteAnswer(id) {
    return supabase.from("answers").delete().eq("id", id);
  },

  // ── Votes ──────────────────────────────────────────────────────────────

  async upsertVote({ user_id, question_id, answer_id, value }) {
    const matchCol = question_id ? "question_id" : "answer_id";
    const matchVal = question_id || answer_id;

    const { data: existing } = await supabase
      .from("votes")
      .select("id, value")
      .eq("user_id", user_id)
      .eq(matchCol, matchVal)
      .maybeSingle();

    if (!existing) {
      return supabase
        .from("votes")
        .insert({ user_id, question_id, answer_id, value });
    } else if (existing.value === value) {
      return supabase.from("votes").delete().eq("id", existing.id);
    } else {
      return supabase.from("votes").update({ value }).eq("id", existing.id);
    }
  },
};

// ─────────────────────────────────────────────
//  APP STATE
// ─────────────────────────────────────────────

let questions = [];
let currentSortAnswersBy = "top";
let currentListView = "recent";
let filterStream = null;
let filterBranch = null;
let filterSubject = null;
let searchQuery = "";
let currentUser = null;

// Tracks which question thread is currently open (for realtime refresh)
let currentThreadId = null;

// ─────────────────────────────────────────────
//  LOAD QUESTIONS
// ─────────────────────────────────────────────

async function loadQuestionsFromDB() {
  const { data, error } = await db.getQuestions();
  if (error) {
    console.error(error);
    return;
  }

  questions = data.map((q) => ({
    id: q.id,
    user_id: q.user_id,
    title: q.title,
    author: q.username || "Unknown",
    stream: q.stream || "",
    branch: q.branch || "",
    subject: q.subject || "",
    timestamp: new Date(q.created_at),
    votes: q.votes || 0,
    answers_count: q.answers_count || 0,
    description: q.body,
    image: q.image_url,
    accepted_answer_id: q.accepted_answer_id || null,
    answers: [],
  }));

  applyFiltersAndRender();
}

// ─────────────────────────────────────────────
//  REALTIME
// ─────────────────────────────────────────────

function setupRealtime() {
  if (window.doubtRealtimeInitialized) return;
  window.doubtRealtimeInitialized = true;

  supabase
    .channel("doubt-forum")

    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "questions" },
      async () => {
        await loadQuestionsFromDB();
      },
    )

    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "questions" },
      async () => {
        await loadQuestionsFromDB();
        if (currentThreadId) await window.showThread(currentThreadId);
      },
    )

    .on(
      "postgres_changes",
      { event: "DELETE", schema: "public", table: "questions" },
      async () => {
        await loadQuestionsFromDB();
        window.showListView();
      },
    )

    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "answers" },
      async (payload) => {
        await loadQuestionsFromDB();

        // Re-fetch questions so the local array is up-to-date before the check
        const question = questions.find(
          (q) => q.id === payload.new.question_id,
        );

        // NOTIFICATION: only if it's YOUR question and someone else answered
        if (
          question &&
          currentUser &&
          question.user_id === currentUser.id &&
          payload.new.user_id !== currentUser.id
        ) {
          if (typeof window.addNotification === "function") {
            window.addNotification({
              source: "doubt",
              title: "New Answer on Your Question",
              message: `${payload.new.username || "Someone"} answered "${question.title}"`,
            });
          }
        }

        if (currentThreadId && payload.new.question_id === currentThreadId) {
          await window.showThread(currentThreadId);
        }
      },
    )

    .on(
      "postgres_changes",
      { event: "DELETE", schema: "public", table: "answers" },
      async () => {
        await loadQuestionsFromDB();
        if (currentThreadId) await window.showThread(currentThreadId);
      },
    )

    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "votes" },
      async () => {
        await loadQuestionsFromDB();
        if (currentThreadId) await window.showThread(currentThreadId);
      },
    )

    .subscribe();
}

// ─────────────────────────────────────────────
//  FILTER PANEL  (stream → branch → subject)
// ─────────────────────────────────────────────

function renderFilterPanel() {
  const panel = document.getElementById("filter-panel");
  if (!panel) return;

  let html = "";

  // Row 1: Stream
  html += `<div class="filter-row">
    <span class="filter-row-label">Stream</span>
    <div class="filter-chips">
      <button class="chip-btn chip-all ${!filterStream ? "active" : ""}"
        onclick="window.setFilter('stream', null)">All</button>`;
  Object.keys(TAXONOMY).forEach((s) => {
    const m = STREAM_META[s];
    html += `<button class="chip-btn chip-stream ${filterStream === s ? "active" : ""}"
      data-stream="${s}"
      onclick="window.setFilter('stream', '${s}')">${m.emoji} ${s}</button>`;
  });
  html += `</div></div>`;

  // Row 2: Branch (only when stream selected)
  if (filterStream && TAXONOMY[filterStream]) {
    html += `<div class="filter-row filter-row--sub">
      <span class="filter-row-label">Branch</span>
      <div class="filter-chips">
        <button class="chip-btn chip-branch ${!filterBranch ? "active" : ""}"
          onclick="window.setFilter('branch', null)">All</button>`;
    TAXONOMY[filterStream].branches.forEach((b) => {
      const bEsc = b.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
      html += `<button class="chip-btn chip-branch ${filterBranch === b ? "active" : ""}"
        onclick="window.setFilter('branch', '${bEsc}')">${escapeHtml(b)}</button>`;
    });
    html += `</div></div>`;
  }

  // Row 3: Subject (only when branch selected)
  if (filterStream && filterBranch) {
    const subjects = TAXONOMY[filterStream].subjects[filterBranch] || [];
    if (subjects.length > 0) {
      html += `<div class="filter-row filter-row--sub2">
        <span class="filter-row-label">Subject</span>
        <div class="filter-chips">
          <button class="chip-btn chip-subject ${!filterSubject ? "active" : ""}"
            onclick="window.setFilter('subject', null)">All</button>`;
      subjects.forEach((s) => {
        const sEsc = s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
        html += `<button class="chip-btn chip-subject ${filterSubject === s ? "active" : ""}"
          onclick="window.setFilter('subject', '${sEsc}')">${escapeHtml(s)}</button>`;
      });
      html += `</div></div>`;
    }
  }

  panel.innerHTML = html;

  // Apply stream colour to the active stream chip
  panel.querySelectorAll(".chip-stream[data-stream]").forEach((btn) => {
    const s = btn.dataset.stream;
    if (btn.classList.contains("active")) {
      btn.style.background = `var(--stream-${s.toLowerCase()}-bg)`;
      btn.style.color = `var(--stream-${s.toLowerCase()})`;
      btn.style.borderColor = `var(--stream-${s.toLowerCase()})`;
    }
  });
}

window.setFilter = function (level, value) {
  if (level === "stream") {
    filterStream = value;
    filterBranch = null;
    filterSubject = null;
  }
  if (level === "branch") {
    filterBranch = value;
    filterSubject = null;
  }
  if (level === "subject") {
    filterSubject = value;
  }
  renderFilterPanel();
  applyFiltersAndRender();
};

// ─────────────────────────────────────────────
//  APPLY FILTERS + SORT → RENDER
// ─────────────────────────────────────────────

function applyFiltersAndRender() {
  let filtered = [...questions];
  if (searchQuery) {
    const q = searchQuery;

    filtered = filtered
      .filter((item) => {
        const title = (item.title || "").toLowerCase();
        const desc = (item.description || "").toLowerCase();
        return title.includes(q) || desc.includes(q);
      })
      .sort((a, b) => {
        const aTitle = (a.title || "").toLowerCase();
        const bTitle = (b.title || "").toLowerCase();
        const aScore = aTitle.includes(q) ? 2 : 1;
        const bScore = bTitle.includes(q) ? 2 : 1;
        return bScore - aScore;
      });
  }

  if (filterStream)
    filtered = filtered.filter((q) => q.stream === filterStream);
  if (filterBranch)
    filtered = filtered.filter((q) => q.branch === filterBranch);
  if (filterSubject)
    filtered = filtered.filter((q) => q.subject === filterSubject);

  if (currentListView === "recent")
    filtered.sort((a, b) => b.timestamp - a.timestamp);
  else if (currentListView === "top")
    filtered.sort((a, b) => b.votes - a.votes);
  else if (currentListView === "unanswered")
    filtered = filtered.filter((q) => q.answers_count === 0);

  renderQuestions(filtered);
}

// ─────────────────────────────────────────────
//  TAG PILL HELPERS
// ─────────────────────────────────────────────

function buildTagPills(q) {
  let pills = "";
  if (q.stream) {
    const s = q.stream.toLowerCase();
    pills += `<span class="tag-pill tag-stream tag-stream--${s}">${STREAM_META[q.stream]?.emoji || ""} ${escapeHtml(q.stream)}</span>`;
  }
  if (q.branch)
    pills += `<span class="tag-pill tag-branch">${escapeHtml(q.branch)}</span>`;
  if (q.subject)
    pills += `<span class="tag-pill tag-subject">${escapeHtml(q.subject)}</span>`;
  return pills;
}

// ─────────────────────────────────────────────
//  RENDER QUESTION LIST
// ─────────────────────────────────────────────

function renderQuestions(data = questions) {
  const container = document.getElementById("questions-container");
  if (!container) return;
  container.innerHTML = "";

  if (data.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <i data-lucide="message-circle-question"></i>
        <p>No questions here yet. Be the first to ask!</p>
      </div>`;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  data.forEach((q) => {
    const card = document.createElement("div");
    card.className = "question-card";
    card.onclick = () => window.showThread(q.id);

    const answerBox =
      q.answers_count > 0
        ? `<div class="stat-box answers">
           <i data-lucide="message-square"></i>
           <span class="stat-num">${q.answers_count}</span>
           <span class="stat-label">${q.answers_count === 1 ? "Answer" : "Answers"}</span>
         </div>`
        : `<div class="stat-box unanswered">
           <i data-lucide="help-circle"></i>
           <span class="stat-label">Unanswered</span>
         </div>`;

    const solvedBadge = q.accepted_answer_id
      ? `<div class="stat-box solved"><i data-lucide="check-circle-2"></i><span class="stat-label">Solved</span></div>`
      : "";

    card.innerHTML = `
      <div class="vote-container" onclick="event.stopPropagation()">
        <button class="vote-btn" onclick="window.vote('${q.id}',1,'q')">
          <i data-lucide="chevron-up"></i>
        </button>
        <span class="vote-count">${q.votes}</span>
        <button class="vote-btn" onclick="window.vote('${q.id}',-1,'q')">
          <i data-lucide="chevron-down"></i>
        </button>
      </div>
      <div class="card-body">
        <div class="question-title">${escapeHtml(q.title)}</div>
        <div class="tag-row">${buildTagPills(q)}</div>
        <div class="meta-row">
          <div class="meta-item"><i data-lucide="user"></i> ${escapeHtml(q.author)}</div>
          <div class="meta-item"><i data-lucide="clock"></i> ${formatTime(q.timestamp)}</div>
        </div>
        <div class="stats-row">${answerBox}${solvedBadge}</div>
      </div>`;

    container.appendChild(card);
  });

  if (window.lucide) window.lucide.createIcons();
}

// ─────────────────────────────────────────────
//  MODAL — cascading selects
// ─────────────────────────────────────────────

window.openModal = function () {
  const streamSel = document.getElementById("q-stream");
  if (streamSel) streamSel.value = "";
  updateBranchOptions();
  document.getElementById("askModal").style.display = "flex";
};

window.closeModal = function () {
  document.getElementById("askModal").style.display = "none";
};

window.updateBranchOptions = function () {
  const stream = document.getElementById("q-stream").value;
  const branchSel = document.getElementById("q-branch");
  const subjectSel = document.getElementById("q-subject");

  branchSel.innerHTML = `<option value="">-- Select Branch --</option>`;
  subjectSel.innerHTML = `<option value="">-- Select Subject --</option>`;
  branchSel.disabled = !stream;
  subjectSel.disabled = true;

  if (stream && TAXONOMY[stream]) {
    TAXONOMY[stream].branches.forEach((b) => {
      branchSel.innerHTML += `<option value="${escapeHtml(b)}">${escapeHtml(b)}</option>`;
    });
  }
};

window.updateSubjectOptions = function () {
  const stream = document.getElementById("q-stream").value;
  const branch = document.getElementById("q-branch").value;
  const subjectSel = document.getElementById("q-subject");

  subjectSel.innerHTML = `<option value="">-- Select Subject --</option>`;
  subjectSel.disabled = !branch;

  if (stream && branch && TAXONOMY[stream]?.subjects[branch]) {
    TAXONOMY[stream].subjects[branch].forEach((s) => {
      subjectSel.innerHTML += `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`;
    });
  }
};

// ─────────────────────────────────────────────
//  SUBMIT QUESTION
// ─────────────────────────────────────────────

window.submitQuestion = async function () {
  const title = document.getElementById("q-title").value.trim();
  const stream = document.getElementById("q-stream").value;
  const branch = document.getElementById("q-branch").value;
  const subject = document.getElementById("q-subject").value;
  const desc = document.getElementById("q-desc").value.trim();
  const file = document.getElementById("q-file").files[0];

  if (!title || !stream || !branch || !subject || !desc) {
    alert("Please fill in all fields including stream, branch, and subject.");
    return;
  }

  const user = await getCurrentUser();
  if (!user) {
    alert("You must be logged in to post a question.");
    return;
  }
  if (!user.username) {
    alert("Please set a username in your profile before posting.");
    return;
  }

  // Upload image to Supabase Storage
  let image_url = null;
  if (file) {
    const ext = file.name.split(".").pop();
    const path = `${user.id}/${Date.now()}.${ext}`;
    const { error: uploadError } = await supabase.storage
      .from("doubt-images")
      .upload(path, file, { upsert: false });
    if (!uploadError) {
      const { data: urlData } = supabase.storage
        .from("doubt-images")
        .getPublicUrl(path);
      image_url = urlData.publicUrl;
    } else {
      console.warn("Image upload failed:", uploadError.message);
    }
  }

  const { error } = await db.insertQuestion({
    title,
    body: desc,
    stream,
    branch,
    subject,
    user_id: user.id,
    username: user.username,
    image_url,
  });

  if (error) {
    console.error(error);
    return;
  }

  window.closeModal();
  document.getElementById("q-title").value = "";
  document.getElementById("q-desc").value = "";
  document.getElementById("q-file").value = "";
  await loadQuestionsFromDB();
};

// ─────────────────────────────────────────────
//  VOTING
// ─────────────────────────────────────────────

window.vote = async function (id, value, type, parentQ = null) {
  const user = await getCurrentUser();
  if (!user) {
    alert("You must be logged in to vote.");
    return;
  }

  await db.upsertVote({
    user_id: user.id,
    question_id: type === "q" ? id : null,
    answer_id: type === "a" ? id : null,
    value,
  });

  if (type === "q") {
    await loadQuestionsFromDB();
    window.sortQuestions(currentListView);
  } else {
    await window.showThread(parentQ);
  }
};

// ─────────────────────────────────────────────
//  LOAD ANSWERS
// ─────────────────────────────────────────────

async function loadAnswersFromDB(questionId) {
  const { data, error } = await db.getAnswers(questionId);
  if (error) {
    console.error(error);
    return [];
  }
  return data.map((a) => ({
    id: a.id,
    user_id: a.user_id,
    author: a.username || "Unknown",
    text: a.body,
    votes: a.votes || 0,
    timestamp: new Date(a.created_at),
    img: a.image_url,
  }));
}

// ─────────────────────────────────────────────
//  THREAD VIEW
// ─────────────────────────────────────────────

window.showThread = async function (id) {
  const q = questions.find((x) => x.id === id);
  if (!q) return;

  currentThreadId = id;

  const user = await getCurrentUser();
  q.answers = await loadAnswersFromDB(id);

  document.getElementById("list-view").style.display = "none";
  document.getElementById("thread-view").style.display = "block";

  let sortedAnswers = [...q.answers];
  if (currentSortAnswersBy === "top")
    sortedAnswers.sort((a, b) => b.votes - a.votes);
  else sortedAnswers.sort((a, b) => b.timestamp - a.timestamp);

  // Accepted answer always floats to top
  if (q.accepted_answer_id) {
    sortedAnswers.sort((a, b) => {
      if (a.id === q.accepted_answer_id) return -1;
      if (b.id === q.accepted_answer_id) return 1;
      return 0;
    });
  }

  const canDeleteQuestion = user && user.id === q.user_id;
  const isQuestionOwner = user && user.id === q.user_id;
  const imgPlaceholderId = q.image ? `q-img-${q.id}` : null;
  const content = document.getElementById("thread-content");

  content.innerHTML = `
  <div class="thread-scroll-area">
  <div class="thread-card">
    <div style="display:flex;gap:18px">
      <div class="vote-container">
        <button class="vote-btn" onclick="window.vote('${q.id}',1,'q')">
          <i data-lucide="chevron-up"></i>
        </button>
        <span class="vote-count">${q.votes}</span>
        <button class="vote-btn" onclick="window.vote('${q.id}',-1,'q')">
          <i data-lucide="chevron-down"></i>
        </button>
      </div>
      <div style="flex:1;min-width:0">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:10px">
          <h1 class="question-title" style="margin:0;font-size:22px">${escapeHtml(q.title)}</h1>
          ${
            canDeleteQuestion
              ? `<button class="btn-delete" onclick="window.deleteQuestion('${q.id}')">
                 <i data-lucide="trash-2"></i> Delete
               </button>`
              : ""
          }
        </div>
        <div class="tag-row" style="margin-bottom:12px">${buildTagPills(q)}</div>
        <div class="meta-row">
          <div class="meta-item"><i data-lucide="user"></i> ${escapeHtml(q.author)}</div>
          <div class="meta-item"><i data-lucide="clock"></i> ${formatTime(q.timestamp)}</div>
        </div>
        <div class="q-description">${escapeHtml(q.description)}</div>
        ${imgPlaceholderId ? `<img id="${imgPlaceholderId}" class="q-image" alt="Question attachment">` : ""}
      </div>
    </div>
  </div>

  <div class="answer-header-row">
    <h3>${q.answers.length} ${q.answers.length === 1 ? "Answer" : "Answers"}</h3>
    <div class="filter-tabs">
      <button class="tab-btn ${currentSortAnswersBy === "top" ? "active" : ""}"
        onclick="window.sortAnswers('${q.id}','top')">Top Rated</button>
      <button class="tab-btn ${currentSortAnswersBy === "newest" ? "active" : ""}"
        onclick="window.sortAnswers('${q.id}','newest')">Newest</button>
    </div>
  </div>

  <div id="answers-list">
    ${
      sortedAnswers.length === 0
        ? `<div class="empty-state">
           <i data-lucide="message-circle"></i>
           <p>No answers yet — be the first to help!</p>
         </div>`
        : sortedAnswers
            .map((ans) => {
              const canDelete = user && user.id === ans.user_id;
              const isAccepted = ans.id === q.accepted_answer_id;
              return `
<div class="answer-card ${isAccepted ? "answer-accepted" : ""}">
  <div class="vote-container">
    <button class="vote-btn" onclick="window.vote('${ans.id}',1,'a','${q.id}')">
      <i data-lucide="chevron-up"></i>
    </button>
    <span class="vote-count">${ans.votes}</span>
    <button class="vote-btn" onclick="window.vote('${ans.id}',-1,'a','${q.id}')">
      <i data-lucide="chevron-down"></i>
    </button>
  </div>
  <div style="flex:1;min-width:0">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
      <div class="meta-row" style="margin-bottom:0">
        <span class="meta-item" style="font-weight:600;color:var(--ink2)">${escapeHtml(ans.author)}</span>
        <span class="meta-item" style="color:var(--ink4)">
          <i data-lucide="clock"></i>${formatTime(ans.timestamp)}
        </span>
        ${isAccepted ? `<span class="accepted-badge"><i data-lucide="check-circle-2"></i> Best Answer</span>` : ""}
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        ${
          isQuestionOwner
            ? `
          <button class="btn-accept ${isAccepted ? "btn-accept--active" : ""}"
            onclick="window.toggleAcceptAnswer('${q.id}','${ans.id}')">
            <i data-lucide="${isAccepted ? "x-circle" : "check-circle-2"}"></i>
            ${isAccepted ? "Unmark" : "Mark Best"}
          </button>`
            : ""
        }
        ${
          canDelete
            ? `
          <button class="btn-delete" onclick="window.deleteAnswer('${ans.id}','${q.id}')">
            <i data-lucide="trash-2"></i> Delete
          </button>`
            : ""
        }
      </div>
    </div>
    <p style="margin:0;line-height:1.7;color:var(--ink2);font-size:15px">${escapeHtml(ans.text)}</p>
  </div>
</div>`;
            })
            .join("")
    }
  </div>

  </div>
  </div>

  <div class="post-answer-box">
    <h4>Post your answer</h4>
    <textarea id="ans-text" rows="4" placeholder="Share your knowledge…"></textarea>
    <button class="btn-ask" onclick="window.submitAnswer('${q.id}')">
      <i data-lucide="send"></i> Post Answer
    </button>
  </div>`;

  if (imgPlaceholderId && q.image) {
    const imgEl = document.getElementById(imgPlaceholderId);
    if (imgEl) imgEl.src = q.image;
  }

  if (window.lucide) window.lucide.createIcons();
};

// ─────────────────────────────────────────────
//  MARK BEST ANSWER
// ─────────────────────────────────────────────

window.toggleAcceptAnswer = async function (questionId, answerId) {
  const q = questions.find((x) => x.id === questionId);
  if (!q) return;

  const { error } = await db.setAcceptedAnswer(
    questionId,
    q.accepted_answer_id,
    answerId,
  );
  if (error) {
    console.error(error);
    return;
  }

  q.accepted_answer_id = q.accepted_answer_id === answerId ? null : answerId;

  await window.showThread(questionId);
};

// ─────────────────────────────────────────────
//  ANSWERS
// ─────────────────────────────────────────────

window.sortAnswers = function (qId, type) {
  currentSortAnswersBy = type;
  window.showThread(qId);
};

window.submitAnswer = async function (qId) {
  const text = document.getElementById("ans-text").value.trim();
  if (!text) {
    alert("Please write an answer.");
    return;
  }

  const user = await getCurrentUser();
  if (!user) {
    alert("You must be logged in to post an answer.");
    return;
  }
  if (!user.username) {
    alert("Please set a username in your profile before posting.");
    return;
  }

  const { error } = await db.insertAnswer({
    question_id: qId,
    body: text,
    user_id: user.id,
    username: user.username,
  });

  if (error) {
    console.error(error);
    return;
  }

  document.getElementById("ans-text").value = "";
  await loadQuestionsFromDB();
  await window.showThread(qId);
};

window.deleteAnswer = async function (answerId, questionId) {
  if (!confirm("Delete this answer?")) return;
  const { error } = await db.deleteAnswer(answerId);
  if (error) {
    console.error(error);
    return;
  }
  await loadQuestionsFromDB();
  await window.showThread(questionId);
};

// ─────────────────────────────────────────────
//  SORTING & NAVIGATION
// ─────────────────────────────────────────────

window.sortQuestions = function (type) {
  currentListView = type;
  document
    .querySelectorAll("#list-view .tab-btn")
    .forEach((b) => b.classList.remove("active"));
  const activeTab = document.getElementById(`sort-${type}-btn`);
  if (activeTab) activeTab.classList.add("active");
  applyFiltersAndRender();
};

window.deleteQuestion = async function (id) {
  if (!confirm("Delete this question and all its answers?")) return;
  const { error } = await db.deleteQuestion(id);
  if (error) {
    console.error(error);
    return;
  }
  await loadQuestionsFromDB();
  window.showListView();
};

window.showListView = function () {
  currentThreadId = null;
  document.getElementById("list-view").style.display = "block";
  document.getElementById("thread-view").style.display = "none";
  applyFiltersAndRender();
};

// ─────────────────────────────────────────────
//  UTILS
// ─────────────────────────────────────────────

function formatTime(date) {
  const seconds = Math.floor((new Date() - date) / 1000);
  if (seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes + "m ago";
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + "h ago";
  const days = Math.floor(hours / 24);
  if (days < 30) return days + "d ago";
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function escapeHtml(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ─────────────────────────────────────────────
//  INIT
// ─────────────────────────────────────────────
export function search(query) {
  searchQuery = query.toLowerCase().trim();
  applyFiltersAndRender();
}

export async function init() {
  currentUser = await getCurrentUser();
  renderFilterPanel();
  await loadQuestionsFromDB();
  window.sortQuestions("recent");
  setupRealtime();
}
