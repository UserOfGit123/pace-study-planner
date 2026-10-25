"use strict";

const STORAGE_KEY = "pace-study-planner-v1";
const DAY_MS = 86400000;
let state = loadState();
let plannerFilter = "all";
let plannerExamFilter = "all";
let activeSessionId = null;
let timerTotal = 0;
let timerRemaining = 0;
let timerInterval = null;
let timerPaused = false;
let lastModalTrigger = null;

function createId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
  return "pace-" + Date.now() + "-" + Math.random().toString(16).slice(2);
}
function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}
function dateKey(date) {
  return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
}
function dateFromKey(key) {
  const parts = String(key).split("-").map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2]);
}
function addDays(key, days) {
  const date = dateFromKey(key);
  date.setDate(date.getDate() + days);
  return dateKey(date);
}
function daysUntil(key) {
  const date = dateFromKey(key);
  const today = startOfToday();
  return Math.round((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) / DAY_MS);
}
function fmtDate(key, options) {
  if (!key) return "";
  return new Intl.DateTimeFormat("en", options || { weekday: "short", month: "short", day: "numeric" }).format(dateFromKey(key));
}
function formatMinutes(minutes) {
  const value = Math.max(0, Number(minutes) || 0);
  const hours = Math.floor(value / 60);
  const mins = value % 60;
  if (!hours) return mins + " min";
  return mins ? hours + " hr " + mins + " min" : hours + " hr";
}
function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
  });
}
function topicFrom(name, minutes, confidence) {
  return { id: createId(), name: name, estimatedMinutes: minutes, confidence: confidence };
}
function demoState() {
  const today = dateKey(startOfToday());
  const exams = [
    {
      id: createId(), title: "Data Structures", date: addDays(today, 6), dailyGoal: 120,
      topics: [
        topicFrom("Linked lists", 70, 2),
        topicFrom("Trees & traversals", 90, 1),
        topicFrom("Graph algorithms", 120, 3),
        topicFrom("Sorting methods", 60, 4)
      ], planWarning: ""
    },
    {
      id: createId(), title: "Database Systems", date: addDays(today, 13), dailyGoal: 120,
      topics: [
        topicFrom("SQL joins", 60, 3),
        topicFrom("Normalization", 75, 2),
        topicFrom("Indexing & query plans", 90, 1)
      ], planWarning: ""
    }
  ];
  const result = { version: 1, dailyGoalMinutes: 120, exams: exams, sessions: [], createdAt: new Date().toISOString() };
  exams.forEach(function (exam) { result.sessions = result.sessions.concat(buildSchedule(exam, [], result.sessions, result.dailyGoalMinutes)); });
  return result;
}
function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed && Array.isArray(parsed.exams) && Array.isArray(parsed.sessions)) { parsed.dailyGoalMinutes = Number(parsed.dailyGoalMinutes) || (parsed.exams[0] && Number(parsed.exams[0].dailyGoal)) || 120; return parsed; }
    }
  } catch (error) {
    console.warn("Pace could not read saved data.", error);
  }
  return demoState();
}
function saveAndRender() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    showToast("This browser could not save your latest changes.", "warning");
  }
  render();
}
function cycleCount(topic) {
  return Math.min(3, 1 + (Number(topic.estimatedMinutes) > 75 ? 1 : 0) + (Number(topic.confidence) <= 2 ? 1 : 0));
}
function sessionKind(index, count) {
  if (count === 1) return "Review";
  if (index === 0) return "Learn";
  if (index === count - 1) return "Review";
  return "Practice";
}
function buildSchedule(exam, completedSessions, occupiedSessions, dailyGoalOverride) {
  const days = daysUntil(exam.date);
  if (days < 0 || !exam.topics || !exam.topics.length) {
    exam.planWarning = "";
    return [];
  }
  const dayCount = Math.max(1, days);
  const dailyGoal = Math.max(45, Number(dailyGoalOverride) || Number(exam.dailyGoal) || 120);
  const completedCounts = {};
  (completedSessions || []).forEach(function (session) {
    if (session.status === "completed") completedCounts[session.topicId] = (completedCounts[session.topicId] || 0) + 1;
  });
  const requests = [];
  exam.topics.forEach(function (topic, topicIndex) {
    const count = cycleCount(topic);
    const alreadyDone = Math.min(count, completedCounts[topic.id] || 0);
    for (let index = alreadyDone; index < count; index += 1) {
      const target = count === 1 ? 0 : Math.round(index * (dayCount - 1) / (count - 1));
      const duration = Math.max(25, Math.min(60, Math.round((Number(topic.estimatedMinutes) / count) / 5) * 5));
      requests.push({ topic: topic, topicIndex: topicIndex, index: index, count: count, target: target, duration: duration });
    }
  });
  requests.sort(function (a, b) {
    return a.target - b.target || Number(a.topic.confidence) - Number(b.topic.confidence) || a.topicIndex - b.topicIndex || a.index - b.index;
  });
  const loads = Array(dayCount).fill(0);
  (occupiedSessions || []).forEach(function (session) {
    if (session.status !== "planned" && session.status !== "completed") return;
    const day = daysUntil(session.status === "completed" && session.completedAt ? dateKey(new Date(session.completedAt)) : session.scheduledDate);
    if (day >= 0 && day < dayCount) loads[day] += Number(session.duration || 0);
  });
  const sessions = [];
  let unscheduled = 0;
  requests.forEach(function (request) {
    const choices = Array.from({ length: dayCount }, function (_, index) { return index; });
    choices.sort(function (a, b) {
      return Math.abs(a - request.target) - Math.abs(b - request.target) || loads[a] - loads[b] || a - b;
    });
    const slot = choices.find(function (day) { return loads[day] + request.duration <= dailyGoal; });
    if (slot === undefined) {
      unscheduled += 1;
      return;
    }
    loads[slot] += request.duration;
    sessions.push({
      id: createId(),
      examId: exam.id,
      topicId: request.topic.id,
      topic: request.topic.name,
      subject: exam.title,
      kind: sessionKind(request.index, request.count),
      duration: request.duration,
      scheduledDate: addDays(dateKey(startOfToday()), slot),
      status: "planned",
      completedAt: null
    });
  });
  exam.planWarning = unscheduled ? "Your daily goal fits " + sessions.length + " of the suggested sessions before this exam. Increase the daily goal to fit more." : "";
  return sessions;
}
function toneForExam(examId) {
  const index = state.exams.findIndex(function (exam) { return exam.id === examId; });
  return "tone-" + (Math.max(0, index) % 5);
}
function sortedUpcomingExams() {
  return state.exams.filter(function (exam) { return daysUntil(exam.date) >= 0; }).sort(function (a, b) { return a.date.localeCompare(b.date); });
}
function sessionsForToday() {
  const today = dateKey(startOfToday());
  return state.sessions.filter(function (session) {
    return session.status === "planned" && session.scheduledDate <= today ||
      session.status === "completed" && session.completedAt && dateKey(new Date(session.completedAt)) === today;
  }).sort(function (a, b) {
    return a.status.localeCompare(b.status) || a.scheduledDate.localeCompare(b.scheduledDate) || a.subject.localeCompare(b.subject);
  });
}
function metricCard(icon, tone, value, label) {
  return '<article class="metric-card"><span class="metric-icon ' + tone + '">' + icon + '</span><div><div class="metric-value">' + escapeHtml(value) + '</div><div class="metric-label">' + escapeHtml(label) + '</div></div></article>';
}
function emptyState(icon, title, description, buttonText, action) {
  return '<div class="empty-state"><span class="empty-state-icon">' + icon + '</span><h3>' + escapeHtml(title) + '</h3><p>' + escapeHtml(description) + '</p>' +
    (buttonText ? '<button class="button button-secondary" data-action="' + action + '">' + escapeHtml(buttonText) + '</button>' : "") + '</div>';
}
function sessionMarkup(session, extraClass) {
  const tone = toneForExam(session.examId);
  const complete = session.status === "completed";
  const actions = complete
    ? '<span class="completed-label">✓ Done</span>'
    : '<button class="complete-button" data-action="mark-complete" data-session-id="' + escapeHtml(session.id) + '" aria-label="Mark ' + escapeHtml(session.topic) + ' complete">✓</button><button class="start-button" data-action="start-session" data-session-id="' + escapeHtml(session.id) + '">▶ Focus</button>';
  return '<article class="session-row ' + (complete ? "is-complete " : "") + (extraClass || "") + '">' +
    '<span class="subject-dot ' + tone + '"></span><div class="session-copy"><div class="session-title-line"><span class="session-title">' + escapeHtml(session.topic) + '</span><span class="session-kind">' + escapeHtml(session.kind) + '</span></div>' +
    '<div class="session-subject">' + escapeHtml(session.subject) + '</div></div><span class="session-duration">' + Number(session.duration) + ' min</span><div class="session-actions">' + actions + '</div></article>';
}
function renderGreeting() {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "GOOD MORNING" : hour < 17 ? "GOOD AFTERNOON" : "GOOD EVENING";
  document.getElementById("greeting-label").textContent = greeting + " · YOUR STUDY SPACE";
  document.getElementById("today-label").textContent = fmtDate(dateKey(startOfToday()), { weekday: "long", month: "long", day: "numeric" });
}
function renderMetrics() {
  const today = sessionsForToday();
  const todayMinutes = today.reduce(function (sum, session) { return sum + Number(session.duration || 0); }, 0);
  const doneToday = today.filter(function (session) { return session.status === "completed"; }).length;
  const done = state.sessions.filter(function (session) { return session.status === "completed"; });
  const weekAgo = new Date(startOfToday().getTime() - 6 * DAY_MS);
  const weekMinutes = done.filter(function (session) { return session.completedAt && new Date(session.completedAt) >= weekAgo; }).reduce(function (sum, session) { return sum + Number(session.duration || 0); }, 0);
  document.getElementById("metrics-grid").innerHTML =
    metricCard("◷", "lavender", formatMinutes(todayMinutes), "on your plan today") +
    metricCard("✓", "mint", doneToday + " session" + (doneToday === 1 ? "" : "s"), "completed today") +
    metricCard("✦", "peach", formatMinutes(weekMinutes), "focused this week");
}
function renderToday() {
  const sessions = sessionsForToday();
  document.getElementById("today-sessions").innerHTML = sessions.length
    ? sessions.map(function (session) { return sessionMarkup(session, ""); }).join("")
    : emptyState("☼", "A little room in your day", "Add an exam and Pace will suggest a few focused sessions to get you started.", "Add an exam", "open-exam-modal");
}
function weekStartKey() {
  const date = startOfToday();
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return dateKey(date);
}
function renderWeekChart() {
  const start = weekStartKey();
  const values = [];
  for (let i = 0; i < 7; i += 1) {
    const key = addDays(start, i);
    const minutes = state.sessions.filter(function (session) { return session.scheduledDate === key; }).reduce(function (sum, session) { return sum + Number(session.duration || 0); }, 0);
    values.push({ key: key, minutes: minutes });
  }
  const max = Math.max(60, ...values.map(function (value) { return value.minutes; }));
  const total = values.reduce(function (sum, value) { return sum + value.minutes; }, 0);
  document.getElementById("week-total").textContent = formatMinutes(total) + " planned";
  document.getElementById("week-chart").innerHTML = values.map(function (value) {
    const height = value.minutes ? Math.max(8, Math.round(value.minutes / max * 84)) : 4;
    const date = dateFromKey(value.key);
    const label = new Intl.DateTimeFormat("en", { weekday: "short" }).format(date);
    const todayClass = value.key === dateKey(startOfToday()) ? " is-today" : "";
    return '<div class="day-column' + todayClass + '"><div class="bar-track"><div class="bar-fill ' + (value.minutes ? "has-time" : "") + '" style="height:' + height + '%">' +
      (value.minutes ? '<span class="day-minutes">' + value.minutes + 'm</span>' : "") + '</div></div><span class="day-name">' + label + '</span></div>';
  }).join("");
}
function countdownText(days) {
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days < 0) return "Passed";
  return days + " days";
}
function renderNextExam() {
  const exam = sortedUpcomingExams()[0];
  const container = document.getElementById("next-exam-card");
  if (!exam) {
    container.innerHTML = '<p class="eyebrow">YOUR NEXT MILESTONE</p><h2>No exam on the horizon</h2><p class="next-exam-date">Add a date to start making a plan.</p><button class="exam-card-cta" data-action="open-exam-modal">＋ Add an exam</button>';
    return;
  }
  const days = daysUntil(exam.date);
  container.innerHTML = '<p class="eyebrow">COMING UP NEXT</p><h2>' + escapeHtml(exam.title) + '</h2><div class="next-exam-date">' + escapeHtml(fmtDate(exam.date, { weekday: "long", month: "long", day: "numeric" })) + '</div>' +
    '<div class="countdown-strip"><span class="countdown-big">' + (days === 0 ? "Today" : days) + '</span><span class="countdown-caption">' + (days === 0 ? "Your exam is today. You’ve got this." : days === 1 ? "One more day to feel ready." : "days to prepare, one step at a time.") + '</span></div>' +
    '<button class="exam-card-cta" data-action="open-exam-plan" data-exam-id="' + escapeHtml(exam.id) + '">See your plan <span>→</span></button>';
}
function renderUpcoming() {
  const exams = sortedUpcomingExams().slice(0, 3);
  document.getElementById("upcoming-exams").innerHTML = exams.length ? exams.map(function (exam, index) {
    const date = dateFromKey(exam.date);
    const month = new Intl.DateTimeFormat("en", { month: "short" }).format(date);
    return '<div class="upcoming-item"><span class="exam-date-tile"><small>' + month + '</small><strong>' + date.getDate() + '</strong></span><div class="upcoming-copy"><strong>' + escapeHtml(exam.title) + '</strong><small>' + escapeHtml(fmtDate(exam.date, { weekday: "short", month: "short", day: "numeric" })) + '</small></div><span class="upcoming-countdown">' + countdownText(daysUntil(exam.date)) + '</span></div>';
  }).join("") : '<p class="page-subtitle" style="padding:14px 0">Your next exam will show up here.</p>';
}
function renderDashboard() {
  renderMetrics();
  renderToday();
  renderWeekChart();
  renderNextExam();
  renderUpcoming();
}
function renderExamFilter() {
  const select = document.getElementById("exam-filter");
  const chosen = plannerExamFilter;
  select.innerHTML = '<option value="all">All exams</option>' + state.exams.map(function (exam) {
    return '<option value="' + escapeHtml(exam.id) + '">' + escapeHtml(exam.title) + '</option>';
  }).join("");
  select.value = state.exams.some(function (exam) { return exam.id === chosen; }) ? chosen : "all";
  plannerExamFilter = select.value;
}
function plannerDateLabel(key) {
  const delta = daysUntil(key);
  if (delta === 0) return "Today";
  if (delta === 1) return "Tomorrow";
  if (delta === -1) return "Yesterday";
  return fmtDate(key, { weekday: "long", month: "long", day: "numeric" });
}
function renderPlanner() {
  renderExamFilter();
  document.querySelectorAll(".filter-tab").forEach(function (button) {
    button.classList.toggle("is-selected", button.dataset.filter === plannerFilter);
  });
  let sessions = state.sessions.slice();
  if (plannerFilter !== "all") sessions = sessions.filter(function (session) { return session.status === plannerFilter; });
  if (plannerExamFilter !== "all") sessions = sessions.filter(function (session) { return session.examId === plannerExamFilter; });
  sessions.sort(function (a, b) { return a.scheduledDate.localeCompare(b.scheduledDate) || a.subject.localeCompare(b.subject) || a.topic.localeCompare(b.topic); });
  const content = document.getElementById("planner-content");
  const warnings = state.exams.filter(function (exam) { return exam.planWarning && (plannerExamFilter === "all" || exam.id === plannerExamFilter); });
  const warningMarkup = warnings.map(function (exam) { return '<div class="planner-note"><strong>' + escapeHtml(exam.title) + ':</strong> ' + escapeHtml(exam.planWarning) + '</div>'; }).join("");
  if (!sessions.length) {
    content.innerHTML = warningMarkup + emptyState("▤", "No sessions here yet", "Add an exam with a few topics and Pace will build a schedule around it.", "Add an exam", "open-exam-modal");
    return;
  }
  const groups = {};
  sessions.forEach(function (session) {
    if (!groups[session.scheduledDate]) groups[session.scheduledDate] = [];
    groups[session.scheduledDate].push(session);
  });
  const groupMarkup = Object.keys(groups).sort().map(function (key) {
    return '<section class="date-group"><header class="date-group-heading"><strong>' + escapeHtml(plannerDateLabel(key)) + '</strong><small>' + escapeHtml(fmtDate(key, { month: "short", day: "numeric" })) + '</small></header><div class="date-session-list">' +
      groups[key].map(function (session) { return sessionMarkup(session, "planner-session"); }).join("") + '</div></section>';
  }).join("");
  content.innerHTML = warningMarkup + groupMarkup;
}
function examProgress(exam) {
  const sessions = state.sessions.filter(function (session) { return session.examId === exam.id; });
  const complete = sessions.filter(function (session) { return session.status === "completed"; }).length;
  return { total: sessions.length, complete: complete, percent: sessions.length ? Math.round(complete / sessions.length * 100) : 0 };
}
function renderExams() {
  const container = document.getElementById("exam-grid");
  if (!state.exams.length) {
    container.innerHTML = emptyState("▣", "Nothing scheduled yet", "Add your next exam and a handful of topics. Your plan will take shape from there.", "Add an exam", "open-exam-modal");
    return;
  }
  container.innerHTML = state.exams.slice().sort(function (a, b) { return a.date.localeCompare(b.date); }).map(function (exam) {
    const days = daysUntil(exam.date);
    const progress = examProgress(exam);
    const chips = (exam.topics || []).slice(0, 4).map(function (topic) { return '<span class="topic-chip">' + escapeHtml(topic.name) + '</span>'; }).join("");
    const more = exam.topics.length > 4 ? '<span class="topic-chip more">+' + (exam.topics.length - 4) + ' more</span>' : "";
    const status = days < 0 ? "Exam passed" : days === 0 ? "Exam day" : countdownText(days) + " to go";
    return '<article class="exam-card"><div class="exam-card-top"><span class="exam-symbol ' + toneForExam(exam.id) + '">▣</span><div class="exam-card-heading"><h2>' + escapeHtml(exam.title) + '</h2><p>' + escapeHtml(fmtDate(exam.date, { weekday: "long", month: "long", day: "numeric", year: "numeric" })) + '</p></div><button class="exam-menu-button" data-action="delete-exam" data-exam-id="' + escapeHtml(exam.id) + '" aria-label="Remove ' + escapeHtml(exam.title) + '">···</button></div>' +
      '<div class="exam-countdown"><strong>' + escapeHtml(status) + '</strong><span>' + Number(exam.dailyGoal || 120) + ' min daily goal</span></div>' +
      '<div class="progress-track"><div class="progress-fill" style="width:' + progress.percent + '%"></div></div><div class="exam-progress-label"><span>' + progress.complete + ' of ' + progress.total + ' sessions complete</span><span>' + progress.percent + '%</span></div>' +
      '<div class="topic-chip-list">' + (chips || '<span class="topic-chip">No topics added</span>') + more + '</div>' +
      '<div class="exam-card-actions"><button class="button button-secondary" data-action="open-exam-plan" data-exam-id="' + escapeHtml(exam.id) + '">Open study plan</button><button class="delete-exam" data-action="regenerate-exam" data-exam-id="' + escapeHtml(exam.id) + '">Refresh</button></div></article>';
  }).join("");
}
function completedDates() {
  return new Set(state.sessions.filter(function (session) { return session.status === "completed" && session.completedAt; }).map(function (session) { return dateKey(new Date(session.completedAt)); }));
}
function currentStreak() {
  const dates = completedDates();
  let cursor = startOfToday();
  if (!dates.has(dateKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  let count = 0;
  while (dates.has(dateKey(cursor))) {
    count += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return count;
}
function renderInsights() {
  const done = state.sessions.filter(function (session) { return session.status === "completed"; });
  const totalMinutes = done.reduce(function (sum, session) { return sum + Number(session.duration || 0); }, 0);
  const byExam = state.exams.map(function (exam) {
    const all = state.sessions.filter(function (session) { return session.examId === exam.id; });
    const complete = all.filter(function (session) { return session.status === "completed"; }).length;
    return { exam: exam, total: all.length, complete: complete, pct: all.length ? Math.round(complete / all.length * 100) : 0 };
  });
  const recent = done.slice().sort(function (a, b) { return String(b.completedAt).localeCompare(String(a.completedAt)); }).slice(0, 6);
  const recentMarkup = recent.length ? recent.map(function (session) {
    return '<div class="recent-item"><span class="subject-dot ' + toneForExam(session.examId) + '"></span><span>' + escapeHtml(session.topic) + ' · ' + escapeHtml(session.subject) + '</span><small>' + escapeHtml(fmtDate(dateKey(new Date(session.completedAt)), { month: "short", day: "numeric" })) + '</small></div>';
  }).join("") : '<p class="insight-caption">Completed sessions will appear here as you work through your plan.</p>';
  const progressMarkup = byExam.length ? byExam.map(function (item) {
    return '<div class="subject-progress-item"><div class="subject-progress-head"><strong>' + escapeHtml(item.exam.title) + '</strong><span>' + item.complete + '/' + item.total + '</span></div><div class="progress-track"><div class="progress-fill" style="width:' + item.pct + '%"></div></div></div>';
  }).join("") : '<p class="insight-caption">Add an exam to see your subject progress.</p>';
  document.getElementById("insights-content").innerHTML =
    '<article class="insight-card"><h2>Time you’ve invested</h2><div class="insight-stat">' + escapeHtml(formatMinutes(totalMinutes)) + '</div><p class="insight-caption">A focused minute is a step toward feeling ready.</p></article>' +
    '<article class="insight-card"><h2>Your steady streak</h2><div class="insight-stat">' + currentStreak() + ' day' + (currentStreak() === 1 ? "" : "s") + '</div><p class="insight-caption">Keep showing up in small ways. It all counts.</p></article>' +
    '<article class="insight-card"><h2>Subject progress</h2><div class="subject-progress-list">' + progressMarkup + '</div></article>' +
    '<article class="insight-card"><h2>Sessions completed</h2><div class="insight-stat">' + done.length + '</div><p class="insight-caption">Every session finished is momentum earned.</p></article>' +
    '<article class="insight-card"><h2>Recent focus</h2><div class="recent-list">' + recentMarkup + '</div></article>';
}
function render() {
  renderGreeting();
  renderDashboard();
  renderPlanner();
  renderExams();
  renderInsights();
}
function showToast(message, kind) {
  const region = document.getElementById("toast-region");
  const toast = document.createElement("div");
  toast.className = "toast" + (kind ? " " + kind : "");
  toast.textContent = message;
  region.appendChild(toast);
  window.setTimeout(function () { toast.remove(); }, 3600);
}
function navigate(view) {
  document.querySelectorAll(".view").forEach(function (section) {
    const active = section.dataset.view === view;
    section.classList.toggle("is-visible", active);
    section.hidden = !active;
  });
  document.querySelectorAll(".nav-item").forEach(function (button) {
    button.classList.toggle("is-active", button.dataset.viewTarget === view);
  });
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function addTopicRow(defaultName, minutes, confidence) {
  const fields = document.getElementById("topic-fields");
  if (fields.children.length >= 10) {
    showToast("Keep it focused with up to 10 topics per exam.", "warning");
    return;
  }
  const row = document.createElement("div");
  row.className = "topic-row";
  const name = document.createElement("input");
  name.type = "text";
  name.maxLength = 70;
  name.placeholder = "Topic name";
  name.setAttribute("aria-label", "Topic name");
  name.dataset.topicName = "true";
  name.value = defaultName || "";
  const time = document.createElement("select");
  time.setAttribute("aria-label", "Estimated study time");
  time.dataset.topicMinutes = "true";
  time.innerHTML = '<option value="30">30 min</option><option value="45">45 min</option><option value="60">1 hour</option><option value="90">1.5 hr</option><option value="120">2 hours</option>';
  time.value = String(minutes || 60);
  const confidenceField = document.createElement("select");
  confidenceField.setAttribute("aria-label", "Confidence in this topic");
  confidenceField.dataset.topicConfidence = "true";
  confidenceField.innerHTML = '<option value="1">Needs work</option><option value="2">Getting there</option><option value="3">Good</option><option value="4">Confident</option><option value="5">Very confident</option>';
  confidenceField.value = String(confidence || 3);
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "topic-remove";
  remove.dataset.action = "remove-topic-row";
  remove.setAttribute("aria-label", "Remove topic");
  remove.textContent = "×";
  row.append(name, time, confidenceField, remove);
  fields.appendChild(row);
}
function openExamModal(trigger) {
  lastModalTrigger = trigger || document.activeElement;
  const form = document.getElementById("exam-form");
  form.reset();
  const dateInput = form.elements.date;
  dateInput.min = dateKey(startOfToday());
  dateInput.value = addDays(dateKey(startOfToday()), 7);
  form.elements.dailyGoal.value = String(state.dailyGoalMinutes || 120);
  document.getElementById("topic-fields").innerHTML = "";
  addTopicRow("", 60, 3);
  addTopicRow("", 60, 2);
  addTopicRow("", 60, 3);
  document.getElementById("form-error").hidden = true;
  document.getElementById("exam-modal").hidden = false;
  window.setTimeout(function () { form.elements.title.focus(); }, 30);
}
function closeExamModal() {
  document.getElementById("exam-modal").hidden = true;
  if (lastModalTrigger && typeof lastModalTrigger.focus === "function") lastModalTrigger.focus();
}
function createExam(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const title = form.elements.title.value.trim();
  const date = form.elements.date.value;
  const dailyGoal = Number(form.elements.dailyGoal.value);
  const topics = Array.from(document.querySelectorAll(".topic-row")).map(function (row) {
    return {
      id: createId(),
      name: row.querySelector("[data-topic-name]").value.trim(),
      estimatedMinutes: Number(row.querySelector("[data-topic-minutes]").value),
      confidence: Number(row.querySelector("[data-topic-confidence]").value)
    };
  }).filter(function (topic) { return topic.name; });
  const error = document.getElementById("form-error");
  if (!title || !date) {
    error.textContent = "Add a subject name and exam date to continue.";
    error.hidden = false;
    return;
  }
  if (daysUntil(date) < 0) {
    error.textContent = "Choose today or a future date for your exam.";
    error.hidden = false;
    return;
  }
  if (!topics.length) {
    error.textContent = "Add at least one topic so Pace can build a useful plan.";
    error.hidden = false;
    return;
  }
  const exam = { id: createId(), title: title, date: date, dailyGoal: dailyGoal, topics: topics, planWarning: "" };
  state.dailyGoalMinutes = dailyGoal;
  state.exams.push(exam);
  const sessions = rebuildAllPlans().filter(function (session) { return session.examId === exam.id; });
  plannerExamFilter = exam.id;
  plannerFilter = "all";
  closeExamModal();
  saveAndRender();
  navigate("planner");
  showToast(sessions.length ? "Your study plan is ready." : "Exam saved. There was no time left to schedule sessions.", sessions.length ? "success" : "warning");
}
function rebuildAllPlans() {
  const completed = state.sessions.filter(function (session) { return session.status === "completed"; });
  state.sessions = completed.slice();
  const generated = [];
  state.exams.slice().sort(function (a, b) { return a.date.localeCompare(b.date); }).forEach(function (exam) {
    const done = completed.filter(function (session) { return session.examId === exam.id; });
    const fresh = buildSchedule(exam, done, state.sessions, state.dailyGoalMinutes);
    state.sessions = state.sessions.concat(fresh);
    generated.push.apply(generated, fresh);
  });
  return generated;
}
function regenerateExam(examId) {
  const exam = state.exams.find(function (item) { return item.id === examId; });
  if (!exam) return;
  const completed = state.sessions.filter(function (session) { return session.examId === examId && session.status === "completed"; });
  state.sessions = state.sessions.filter(function (session) { return session.examId !== examId; });
  const fresh = buildSchedule(exam, completed, state.sessions.concat(completed), state.dailyGoalMinutes);
  state.sessions = state.sessions.concat(completed, fresh);
  saveAndRender();
  showToast(fresh.length ? "Your remaining sessions have been spaced again." : "There are no remaining sessions to schedule.", "success");
}
function regenerateAll() {
  rebuildAllPlans();
  saveAndRender();
  showToast("Your remaining plans have been refreshed.", "success");
}
function deleteExam(examId) {
  const exam = state.exams.find(function (item) { return item.id === examId; });
  if (!exam) return;
  if (!window.confirm("Remove " + exam.title + " and its study sessions?")) return;
  state.exams = state.exams.filter(function (item) { return item.id !== examId; });
  state.sessions = state.sessions.filter(function (session) { return session.examId !== examId; });
  if (plannerExamFilter === examId) plannerExamFilter = "all";
  saveAndRender();
  showToast("Exam removed from your workspace.");
}
function openExamPlan(examId) {
  plannerExamFilter = examId;
  plannerFilter = "all";
  navigate("planner");
  renderPlanner();
}
function setSessionComplete(sessionId) {
  const session = state.sessions.find(function (item) { return item.id === sessionId; });
  if (!session || session.status === "completed") return;
  session.status = "completed";
  session.completedAt = new Date().toISOString();
  saveAndRender();
  showToast("Session complete. Nice work showing up.", "success");
}
function updateTimerDisplay() {
  const minutes = Math.floor(timerRemaining / 60);
  const seconds = timerRemaining % 60;
  document.getElementById("timer-display").textContent = String(minutes).padStart(2, "0") + ":" + String(seconds).padStart(2, "0");
  const offset = timerTotal ? 616 * (1 - timerRemaining / timerTotal) : 616;
  document.getElementById("timer-progress").style.strokeDashoffset = String(offset);
  document.getElementById("focus-encouragement").textContent = timerPaused ? "Paused. Take a breath, then continue when you’re ready." : timerRemaining <= 60 ? "One last minute. Stay with it." : "Take a breath. You’re right where you need to be.";
}
function stopTimer() {
  if (timerInterval) window.clearInterval(timerInterval);
  timerInterval = null;
}
function startTimer() {
  stopTimer();
  timerPaused = false;
  updateTimerDisplay();
  timerInterval = window.setInterval(function () {
    if (timerPaused) return;
    timerRemaining = Math.max(0, timerRemaining - 1);
    updateTimerDisplay();
    if (timerRemaining === 0) finishFocusSession();
  }, 1000);
}
function startFocusSession(sessionId) {
  const session = state.sessions.find(function (item) { return item.id === sessionId; });
  if (!session || session.status === "completed") return;
  activeSessionId = sessionId;
  timerTotal = Number(session.duration) * 60;
  timerRemaining = timerTotal;
  document.getElementById("focus-title").textContent = session.topic;
  document.getElementById("focus-subtitle").textContent = session.subject + " · " + session.kind + " · " + session.duration + " minutes";
  document.getElementById("focus-overlay").hidden = false;
  document.getElementById("timer-toggle").textContent = "Pause";
  startTimer();
}
function closeFocus() {
  stopTimer();
  timerPaused = true;
  activeSessionId = null;
  document.getElementById("focus-overlay").hidden = true;
}
function finishFocusSession() {
  const id = activeSessionId;
  stopTimer();
  document.getElementById("focus-overlay").hidden = true;
  activeSessionId = null;
  if (id) setSessionComplete(id);
}
function toggleTimer() {
  timerPaused = !timerPaused;
  document.getElementById("timer-toggle").textContent = timerPaused ? "Resume" : "Pause";
  updateTimerDisplay();
}
function resetDemo() {
  if (!window.confirm("Replace this browser’s workspace with the example study plan?")) return;
  state = demoState();
  plannerExamFilter = "all";
  plannerFilter = "all";
  saveAndRender();
  navigate("overview");
  showToast("Example workspace restored.", "success");
}
function handleAction(button) {
  const action = button.dataset.action;
  if (action === "open-exam-modal") openExamModal(button);
  else if (action === "close-exam-modal") closeExamModal();
  else if (action === "add-topic-row") addTopicRow("", 60, 3);
  else if (action === "remove-topic-row") {
    const rows = document.getElementById("topic-fields");
    if (rows.children.length > 1) button.closest(".topic-row").remove();
  }
  else if (action === "start-session") startFocusSession(button.dataset.sessionId);
  else if (action === "mark-complete") setSessionComplete(button.dataset.sessionId);
  else if (action === "toggle-timer") toggleTimer();
  else if (action === "finish-session") finishFocusSession();
  else if (action === "close-focus") closeFocus();
  else if (action === "generate-all") regenerateAll();
  else if (action === "regenerate-exam") regenerateExam(button.dataset.examId);
  else if (action === "delete-exam") deleteExam(button.dataset.examId);
  else if (action === "open-exam-plan") openExamPlan(button.dataset.examId);
  else if (action === "reset-demo") resetDemo();
  else if (action === "help") showToast("Add an exam, rate your confidence in each topic, then start or complete the sessions Pace suggests.");
}
document.addEventListener("click", function (event) {
  const viewButton = event.target.closest("[data-view-target]");
  if (viewButton) {
    navigate(viewButton.dataset.viewTarget);
    return;
  }
  const filterButton = event.target.closest("[data-filter]");
  if (filterButton) {
    plannerFilter = filterButton.dataset.filter;
    renderPlanner();
    return;
  }
  const actionButton = event.target.closest("[data-action]");
  if (actionButton) handleAction(actionButton);
});
document.getElementById("exam-filter").addEventListener("change", function (event) {
  plannerExamFilter = event.currentTarget.value;
  renderPlanner();
});
document.getElementById("exam-form").addEventListener("submit", createExam);
document.addEventListener("keydown", function (event) {
  if (event.key === "Escape") {
    if (!document.getElementById("focus-overlay").hidden) closeFocus();
    else if (!document.getElementById("exam-modal").hidden) closeExamModal();
  }
});
window.addEventListener("storage", function (event) {
  if (event.key === STORAGE_KEY) {
    state = loadState();
    render();
    showToast("Your workspace was updated in another tab.");
  }
});

render();
try {
  if (!localStorage.getItem(STORAGE_KEY)) localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
} catch (error) { /* Browser storage may be disabled. */ }
