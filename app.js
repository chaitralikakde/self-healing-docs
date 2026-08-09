const API_BASE = "https://apistage-2db1-3000.prg1.zerops.app";

// tabs
document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`${btn.dataset.tab}-view`).classList.add("active");
    if (btn.dataset.tab === "dash") {
      enterDashboard();
    } else {
      leaveDashboard();
    }
  });
});

// tiny markdown renderer: headers, code fences, paragraphs
function renderMarkdown(md) {
  const escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const lines = md.split("\n");
  let html = "";
  let inCode = false;
  let paragraph = [];

  const flushParagraph = () => {
    if (paragraph.length) {
      html += `<p>${escapeHtml(paragraph.join(" "))}</p>`;
      paragraph = [];
    }
  };

  for (const line of lines) {
    if (line.startsWith("```")) {
      if (!inCode) {
        flushParagraph();
        html += "<pre><code>";
      } else {
        html += "</code></pre>";
      }
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      html += escapeHtml(line) + "\n";
      continue;
    }
    if (/^#\s+/.test(line)) {
      flushParagraph();
      html += `<h1>${escapeHtml(line.replace(/^#\s+/, ""))}</h1>`;
      continue;
    }
    if (/^##\s+/.test(line)) {
      flushParagraph();
      html += `<h2>${escapeHtml(line.replace(/^##\s+/, ""))}</h2>`;
      continue;
    }
    if (line.trim() === "") {
      flushParagraph();
      continue;
    }
    paragraph.push(line.trim());
  }
  flushParagraph();
  return html;
}

// docs
const docListEl = document.getElementById("doc-list");
const docContentEl = document.getElementById("doc-content");

async function loadDocList() {
  try {
    const res = await fetch(`${API_BASE}/docs`);
    const { docs } = await res.json();
    docListEl.innerHTML = "";
    docs.forEach((doc, i) => {
      const btn = document.createElement("button");
      btn.textContent = doc.title;
      btn.addEventListener("click", () => selectDoc(doc.slug, btn));
      docListEl.appendChild(btn);
      if (i === 0) selectDoc(doc.slug, btn);
    });
  } catch (err) {
    docListEl.innerHTML = `<p class="muted">Couldn't load docs.</p>`;
  }
}

async function selectDoc(slug, btn) {
  document.querySelectorAll(".doc-list button").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  docContentEl.innerHTML = `<p class="muted">Loading…</p>`;
  try {
    const res = await fetch(`${API_BASE}/docs/${slug}`);
    const doc = await res.json();
    docContentEl.innerHTML = renderMarkdown(doc.content);
  } catch (err) {
    docContentEl.innerHTML = `<p class="muted">Couldn't load this page.</p>`;
  }
}

loadDocList();

// chat
const chatLog = document.getElementById("chat-log");
const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-input");

function addMessage(role, text) {
  const el = document.createElement("div");
  el.className = `msg ${role}`;
  el.textContent = text;
  chatLog.appendChild(el);
  chatLog.scrollTop = chatLog.scrollHeight;
  return el;
}

chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const question = chatInput.value.trim();
  if (!question) return;

  document.querySelector(".chat-empty")?.remove();
  addMessage("question", question);
  chatInput.value = "";
  const submitBtn = chatForm.querySelector("button");
  submitBtn.disabled = true;

  const answerEl = addMessage("answer", "Thinking…");

  try {
    const res = await fetch(`${API_BASE}/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
    });
    const data = await res.json();

    answerEl.textContent = data.answer || "No answer returned.";

    const meta = document.createElement("div");
    meta.className = "msg-meta";
    const pct = Math.round((data.confidence || 0) * 100);
    const sources = (data.sources || []).map((s) => s.title).join(", ");
    meta.innerHTML = `<span class="confidence-badge">confidence ${pct}%</span>${sources ? ` · sources: ${sources}` : ""}`;
    answerEl.appendChild(meta);
  } catch (err) {
    answerEl.textContent = "Something went wrong reaching the API.";
  } finally {
    submitBtn.disabled = false;
  }
});

// maintainer dashboard
const gapListEl = document.getElementById("gap-list");
const gapDetailEl = document.getElementById("gap-detail");
const activityFeedEl = document.getElementById("activity-feed");

let dashLoaded = false;
let activityTimer = null;

function timeAgo(iso) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso)) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

async function loadGapList() {
  try {
    const res = await fetch(`${API_BASE}/gaps`);
    const { gaps } = await res.json();
    gapListEl.innerHTML = "";
    if (gaps.length === 0) {
      gapListEl.innerHTML = `<p class="muted">No gaps detected yet.</p>`;
      return;
    }
    gaps.forEach((gap, i) => {
      const btn = document.createElement("button");
      btn.className = "gap-card";
      const pct = Math.round((gap.avg_confidence || 0) * 100);
      btn.innerHTML = `
        <div class="q">${gap.canonical_question}</div>
        <span class="status-badge status-${gap.status}">${gap.status}</span>
        <span class="msg-meta">asked ${gap.ask_count}x · confidence ${pct}%</span>
      `;
      btn.addEventListener("click", () => selectGap(gap.id, btn));
      gapListEl.appendChild(btn);
      if (i === 0) selectGap(gap.id, btn);
    });
  } catch (err) {
    gapListEl.innerHTML = `<p class="muted">Couldn't load gaps.</p>`;
  }
}

async function selectGap(id, btn) {
  document.querySelectorAll(".gap-card").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  gapDetailEl.innerHTML = `<p class="muted">Loading…</p>`;
  try {
    const res = await fetch(`${API_BASE}/gaps/${id}`);
    const { gap, questions, draft, action } = await res.json();

    let html = `<h2>Gap</h2><p>${gap.canonical_question}</p>`;

    html += `<h2>Real questions that triggered this (${questions.length})</h2><ul>`;
    questions.forEach((q) => (html += `<li>${q.raw_question}</li>`));
    html += `</ul>`;

    if (draft) {
      const pct = Math.round((draft.writer_confidence || 0) * 100);
      html += `<h2>Writer's draft (confidence ${pct}%)</h2><div class="draft-content">${draft.proposed_content
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")}</div>`;
    } else {
      html += `<h2>Writer's draft</h2><p class="muted">Not drafted yet.</p>`;
    }

    if (action) {
      html += `<h2>Reviewer's decision</h2><p>Routed as <strong>${action.action_type}</strong>${
        action.status === "mocked" ? " (mock — no GitHub token configured)" : ""
      }</p><a class="route-link" href="${action.external_url}" target="_blank" rel="noopener">${action.external_url}</a>`;
    } else {
      html += `<h2>Reviewer's decision</h2><p class="muted">Not routed yet.</p>`;
    }

    gapDetailEl.innerHTML = html;
  } catch (err) {
    gapDetailEl.innerHTML = `<p class="muted">Couldn't load this gap.</p>`;
  }
}

async function loadActivity() {
  try {
    const res = await fetch(`${API_BASE}/activity?limit=20`);
    const { events } = await res.json();
    if (events.length === 0) {
      activityFeedEl.innerHTML = `<li class="muted">No activity yet — ask some questions.</li>`;
      return;
    }
    activityFeedEl.innerHTML = events
      .map((e) => {
        let label;
        if (e.type === "gap_detected") label = `Gap detected: "${e.question}"`;
        else if (e.type === "draft_written")
          label = `Draft written for "${e.question}" (confidence ${Math.round((e.writerConfidence || 0) * 100)}%)`;
        else label = `Routed as ${e.actionType} for "${e.question}"`;
        return `<li><span class="time">${timeAgo(e.at)}</span>${label}</li>`;
      })
      .join("");
  } catch (err) {
    activityFeedEl.innerHTML = `<li class="muted">Couldn't load activity.</li>`;
  }
}

function enterDashboard() {
  if (!dashLoaded) {
    dashLoaded = true;
    loadGapList();
  }
  loadActivity();
  activityTimer = setInterval(loadActivity, 5000);
}

function leaveDashboard() {
  if (activityTimer) {
    clearInterval(activityTimer);
    activityTimer = null;
  }
}
