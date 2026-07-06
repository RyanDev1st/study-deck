/* ============================================================
   Intro DS AI - Study Deck engine
   - FSRS-5 spaced repetition (fsrs.js)
   - interleaving, due queue, weak-topic drilling, leech detection
   - SRS dashboard (due/new/learning/retention, forecast, mastery)
   - keyboard-driven retrieval practice
   - local Gemma AI explainer (chat.js), gated on GPU + reachability
   ============================================================ */
(function () {
  "use strict";

  var LS_KEY = "sd_study_v1";
  var BANK_KEY = "sd_bank_v1";   // imported question bank (JSON) lives here
  var MATURE_DAYS = 21;        // stability at which a card counts as "mastered"
  var LEECH_LAPSES = 8;        // lapses before a card is flagged a leech
  var DAY = 86400000;

  var bank = null;             // { title, quizzes:[...], theory:{...} }

  var scheduler = new FSRS({ requestRetention: 0.9, maximumInterval: 365 });

  // ---- element refs ----
  var $ = function (id) { return document.getElementById(id); };
  var el = {};
  ["question-container","btn-prev","btn-next","btn-submit","submit-row","progress-fill",
   "progress-text","session-name","quiz-screen","score-screen","final-score","score-feedback",
   "btn-retry","btn-weak","weak-count","score-breakdown","session-list","btn-new-session",
   "btn-review-due","due-pill","btn-collapse","btn-open-margin","btn-theme","margin",
   "s-due","s-new","s-learn","s-retention","streak-n","reviewed-n","forecast","mastery",
   "theory-panel","theory-content","close-theory","chat-dock","chat-fab","close-chat","chat-log",
   "chat-text","chat-send","chat-stop","btn-chat-cfg","ai-dot","chat-model","scrim","toast",
   "btn-progress","settings-panel","close-settings","set-key","set-refresh","set-save","set-status",
   "bank-name","bank-count","btn-bank-import","btn-bank-export","btn-bank-reset","bank-file","bank-status",
   "new-modal","close-modal","m-mode","m-topic","topic-field","m-type","m-count","btn-start"
  ].forEach(function (k) { el[k] = $(k); });

  // ---- state ----
  var pool = [];                 // [{id, sectionTitle, ...question}]
  var byId = {};                 // id -> question
  var sections = [];             // ordered section titles
  var state = {
    activeSessionId: null,
    sessions: [],
    cards: {},                   // id -> FSRS card
    meta: { reviewedTotal: 0, studyDays: [], theme: null }
  };
  var aiCap = null;              // hardware capability result

  // ---- motion (GSAP, with graceful no-op fallback) ----
  var G = window.gsap || null;
  var reduceMotion = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var fx = {
    enabled: !!G && !reduceMotion,
    from: function (t, v) { if (fx.enabled) try { G.from(t, v); } catch (e) {} },
    to: function (t, v) { if (fx.enabled) try { G.to(t, v); } catch (e) {} },
    fromTo: function (t, a, b) { if (fx.enabled) try { G.fromTo(t, a, b); } catch (e) {} },
    kill: function (t) { if (fx.enabled) try { G.killTweensOf(t); } catch (e) {} }
  };
  // reveal a question sheet: fade the card, stagger the options in like ink settling
  function animQuestion(card) {
    if (!fx.enabled || !card) return;
    var opts = card.querySelectorAll(".opt, .fib-input");
    G.set(card, { clearProps: "all" });
    G.from(card, { opacity: 0, y: 10, duration: 0.32, ease: "power2.out" });
    if (opts.length) G.from(opts, { opacity: 0, x: -8, duration: 0.3, stagger: 0.045, ease: "power2.out", delay: 0.05 });
  }
  function animPanelOpen(p) { if (fx.enabled) G.fromTo(p, { x: 40 }, { x: 0, duration: 0.34, ease: "power3.out" }); }
  function animReveal(node) { if (fx.enabled && node) G.from(node, { opacity: 0, y: 6, duration: 0.28, ease: "power2.out" }); }
  function animCount(node, to, suffix) {
    if (!fx.enabled || !node) { node.textContent = to + (suffix || ""); return; }
    var o = { v: 0 };
    G.to(o, { v: to, duration: 0.7, ease: "power1.out", onUpdate: function () { node.textContent = Math.round(o.v) + (suffix || ""); } });
  }

  // ---- utilities ----
  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.remove("hidden");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.toast.classList.add("hidden"); }, 2600);
  }
  function todayKey(t) { var d = new Date(t || Date.now()); return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate(); }

  function save() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) {}
  }
  function load() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (raw) {
        var p = JSON.parse(raw);
        state = Object.assign(state, p);
        if (!state.cards) state.cards = {};
        if (!state.meta) state.meta = { reviewedTotal: 0, studyDays: [], theme: null };
      }
    } catch (e) {}
  }

  // ---- question bank (modular: localStorage import, else bundled sample) ----
  var FALLBACK_BANK = {
    title: "Empty deck",
    quizzes: [{ id: 1, title: "Getting started", quiz: [
      { questionText: "No question bank is loaded. Open Settings to import one. Which file type does import expect?",
        answerOptions: [
          { answerText: "A .json file", isCorrect: "true", explanation: "Correct. Import a question-bank JSON. See banks/sample.json for the format." },
          { answerText: "A .csv file", isCorrect: "false", explanation: "This app imports JSON, not CSV." },
          { answerText: "A .pdf file", isCorrect: "false", explanation: "PDFs are not supported; use a JSON bank." }
        ] }
    ] }],
    theory: { "Getting started": "<h3>Load a bank</h3><p>Open <strong>Settings</strong> and use <strong>Import</strong> to load a question-bank JSON. The format is documented in <code>banks/sample.json</code> and the README.</p>" }
  };

  function validateBank(b) {
    if (!b || !Array.isArray(b.quizzes) || !b.quizzes.length) return "Bank has no 'quizzes' array.";
    for (var i = 0; i < b.quizzes.length; i++) {
      var s = b.quizzes[i];
      if (!s.title || !Array.isArray(s.quiz)) return "Section " + (i + 1) + " is missing a title or 'quiz' array.";
    }
    return null; // ok
  }

  // Resolve the active bank: user import (localStorage) -> bundled sample.json -> inline fallback.
  async function resolveBank() {
    try {
      var raw = localStorage.getItem(BANK_KEY);
      if (raw) { var b = JSON.parse(raw); if (!validateBank(b)) return b; }
    } catch (e) {}
    try {
      var r = await fetch("banks/sample.json", { cache: "no-store" });
      if (r.ok) { var j = await r.json(); if (!validateBank(j)) return j; }
    } catch (e) {}
    return FALLBACK_BANK; // offline / file:// with no import
  }

  function bankTheory() { return (bank && bank.theory) || {}; }

  function buildPool() {
    pool = []; byId = {}; sections = [];
    if (!bank || validateBank(bank)) { el["question-container"].innerHTML = '<div class="q-card"><p>Could not load a question bank. Open Settings to import one.</p></div>'; return false; }
    bank.quizzes.forEach(function (sec) {
      if (sections.indexOf(sec.title) < 0) sections.push(sec.title);
      sec.quiz.forEach(function (q, i) {
        var item = Object.assign({}, q, { id: sec.title + "::" + i, sectionTitle: sec.title });
        pool.push(item);
        byId[item.id] = item;
      });
    });
    return true;
  }
  function cardFor(id) {
    if (!state.cards[id]) state.cards[id] = scheduler.createCard();
    return state.cards[id];
  }

  // ---- SRS selection ----
  function isDue(id, now) {
    var c = state.cards[id];
    if (!c || c.state === FSRS.STATE.NEW) return false;
    return c.due <= now;
  }
  function isNew(id) { var c = state.cards[id]; return !c || c.state === FSRS.STATE.NEW; }
  function dueList(now) { now = now || Date.now(); return pool.filter(function (q) { return isDue(q.id, now); }); }
  function newList() { return pool.filter(function (q) { return isNew(q.id); }); }

  function isCorrectOpt(o) { return o.isCorrect === "true" || o.isCorrect === true; }

  // topic mastery 0..1 : mean over topic cards of clamp(stability / MATURE_DAYS, 1); unseen = 0
  function topicMastery(title) {
    var items = pool.filter(function (q) { return q.sectionTitle === title; });
    if (!items.length) return 0;
    var sum = 0;
    items.forEach(function (q) {
      var c = state.cards[q.id];
      var s = c && c.state !== FSRS.STATE.NEW ? Math.min(c.stability / MATURE_DAYS, 1) : 0;
      sum += s;
    });
    return sum / items.length;
  }
  // weak = low mastery OR flagged leech OR lapses>=2
  function weakList() {
    return pool.filter(function (q) {
      var c = state.cards[q.id];
      if (!c || c.state === FSRS.STATE.NEW) return false;
      return c.lapses >= 2 || Math.min(c.stability / MATURE_DAYS, 1) < 0.35;
    });
  }

  // ---- sessions ----
  function makeQueue(mode, type, count, topic) {
    var src;
    if (mode === "due") src = dueList();
    else if (mode === "new") src = newList();
    else if (mode === "weak") src = weakList();
    else if (mode === "topic") src = pool.filter(function (q) { return q.sectionTitle === topic; });
    else src = pool.slice(); // interleave = everything

    if (type === "MCQ") src = src.filter(function (q) { return q.type !== "FIB"; });
    else if (type === "FIB") src = src.filter(function (q) { return q.type === "FIB"; });

    // interleave: shuffle so consecutive items rarely share a topic
    src = interleave(shuffle(src.slice()));
    if (count && count < src.length) src = src.slice(0, count);
    return src.map(function (q) { return q.id; });
  }
  // spread items so neighbours differ in topic where possible
  function interleave(items) {
    var buckets = {};
    items.forEach(function (q) { (buckets[q.sectionTitle] = buckets[q.sectionTitle] || []).push(q); });
    var keys = Object.keys(buckets);
    var out = [], remaining = items.length, last = null;
    while (remaining > 0) {
      // pick the fullest bucket that isn't the last topic used
      keys.sort(function (a, b) { return buckets[b].length - buckets[a].length; });
      var pick = keys.find(function (k) { return buckets[k].length && k !== last; });
      if (!pick) pick = keys.find(function (k) { return buckets[k].length; });
      out.push(buckets[pick].shift()); last = pick; remaining--;
    }
    return out;
  }

  function modeName(mode, topic) {
    return ({ interleave: "Interleaved", due: "Due reviews", new: "New cards", weak: "Weak topics", topic: topic })[mode] || "Session";
  }

  function createSession(mode, type, count, topic) {
    var queue = makeQueue(mode, type, count, topic);
    if (!queue.length) {
      toast(mode === "due" ? "Nothing due right now — great job!" : "No questions match those filters.");
      return false;
    }
    var s = {
      id: Date.now().toString(),
      name: modeName(mode, topic),
      date: new Date().toLocaleString(),
      queue: queue, pos: 0, answers: {}, done: false
    };
    state.sessions.push(s);
    state.activeSessionId = s.id;
    switchScreen("quiz");
    save();
    renderSidebar();
    renderQuestion();
    return true;
  }
  function activeSession() { return state.sessions.find(function (s) { return s.id === state.activeSessionId; }); }

  function switchSession(id) {
    state.activeSessionId = id;
    var s = activeSession();
    if (s && s.done) showScore(); else { switchScreen("quiz"); renderQuestion(); }
    save(); renderSidebar();
  }
  function deleteSession(id, e) {
    e.stopPropagation();
    state.sessions = state.sessions.filter(function (s) { return s.id !== id; });
    if (state.activeSessionId === id) state.activeSessionId = state.sessions.length ? state.sessions[state.sessions.length - 1].id : null;
    if (state.activeSessionId) switchSession(state.activeSessionId);
    else { el["question-container"].innerHTML = '<div class="q-card"><p class="faint">No active booklet. Start one from the left.</p></div>'; el["session-name"].textContent = "—"; }
    save(); renderSidebar(); renderDashboard();
  }

  // ---- rendering ----
  function switchScreen(which) {
    var quiz = which === "quiz";
    el["quiz-screen"].classList.toggle("active", quiz);
    el["quiz-screen"].classList.toggle("hidden", !quiz);
    el["score-screen"].classList.toggle("active", !quiz);
    el["score-screen"].classList.toggle("hidden", quiz);
  }

  function updateProgress() {
    var s = activeSession(); if (!s) return;
    var pct = ((s.pos + 1) / s.queue.length) * 100;
    el["progress-fill"].style.width = pct + "%";
    el["progress-text"].textContent = "Question " + (s.pos + 1) + " of " + s.queue.length;
    el["session-name"].textContent = s.name;
    el["btn-prev"].disabled = s.pos === 0;
    var last = s.pos === s.queue.length - 1;
    el["btn-next"].disabled = last;
    el["submit-row"].classList.toggle("hidden", !last);
  }

  function renderQuestion() {
    var s = activeSession(); if (!s) return;
    updateProgress();
    var id = s.queue[s.pos];
    var q = byId[id];
    var ans = s.answers[s.pos];   // {choice, correct, graded}
    var host = el["question-container"];
    host.innerHTML = "";

    var card = document.createElement("div");
    card.className = "q-card";

    card.innerHTML =
      '<div class="q-head">' +
        '<span class="q-badge">' + esc(q.sectionTitle) + '</span>' +
        '<button type="button" class="unclear-btn"><svg class="ic ic-sm"><use href="#i-book"/></svg> Unclear?</button>' +
      '</div>' +
      '<div class="q-title">' + esc(q.questionText) + '</div>';

    if (q.type === "FIB") renderFIB(card, q, s, ans);
    else renderMCQ(card, q, s, ans);

    host.appendChild(card);
    card.querySelector(".unclear-btn").addEventListener("click", openTheory);
    if (!ans) animQuestion(card); // only animate a fresh (unanswered) sheet
    if (ans && ans.graded == null) renderGrade(card, q, s); // answered but not graded
  }

  function renderMCQ(card, q, s, ans) {
    var wrap = document.createElement("div");
    wrap.className = "options";
    var answered = !!ans;

    q.answerOptions.forEach(function (opt, i) {
      var lab = document.createElement("label");
      lab.className = "opt";
      var key = String.fromCharCode(65 + i);
      lab.innerHTML =
        '<div class="opt-row"><span class="opt-key">' + key + '</span>' +
        '<span class="opt-text">' + esc(opt.answerText) + '</span></div>';
      var input = document.createElement("input");
      input.type = "radio"; input.name = "opt"; input.value = i;
      lab.insertBefore(input, lab.firstChild);

      if (answered) {
        lab.classList.add("disabled");
        if (isCorrectOpt(opt)) lab.classList.add("correct");
        else if (ans.choice === i) lab.classList.add("wrong");
        if (ans.choice === i) lab.classList.add("selected");
        appendExp(lab, opt.explanation, isCorrectOpt(opt));
      } else {
        lab.addEventListener("click", function (e) { e.preventDefault(); answerMCQ(q, s, i); });
      }
      wrap.appendChild(lab);
    });
    card.appendChild(wrap);
  }

  function appendExp(container, text, ok) {
    if (!text) return;
    var d = document.createElement("div");
    d.className = "exp " + (ok ? "ok" : "no");
    d.innerHTML = '<span class="exp-tag">' + (ok ? "Correct" : "Why not") + '</span>' + esc(text);
    container.appendChild(d);
  }

  function renderFIB(card, q, s, ans) {
    var answered = !!ans;
    var input = document.createElement("input");
    input.className = "fib-input"; input.type = "text";
    input.placeholder = "Type your answer, then Enter…";
    card.appendChild(input);
    if (answered) {
      input.value = ans.raw; input.disabled = true;
      input.style.borderColor = ans.correct ? "var(--tick)" : "var(--pen)";
      var d = document.createElement("div");
      d.className = "exp " + (ans.correct ? "ok" : "no");
      d.innerHTML = '<span class="exp-tag">' + (ans.correct ? "Correct" : "Answer: " + esc(q.correctAnswer)) + '</span>' + esc(q.explanation || "");
      card.appendChild(d);
    } else {
      input.addEventListener("keydown", function (e) {
        if (e.key === "Enter" && input.value.trim()) answerFIB(q, s, input.value.trim());
      });
      setTimeout(function () { input.focus(); }, 30);
    }
  }

  function answerMCQ(q, s, choice) {
    var correct = isCorrectOpt(q.answerOptions[choice]);
    s.answers[s.pos] = { choice: choice, correct: correct, graded: null };
    save(); renderQuestion();
  }
  function answerFIB(q, s, raw) {
    var correct = raw.toLowerCase().trim() === String(q.correctAnswer).toLowerCase().trim();
    s.answers[s.pos] = { raw: raw, correct: correct, graded: null };
    save(); renderQuestion();
  }

  // grading with FSRS previews
  function renderGrade(card, q, s) {
    var id = s.queue[s.pos];
    var c = cardFor(id);
    var preview = scheduler.preview(c);
    var labels = { 1: "Again", 2: "Hard", 3: "Good", 4: "Easy" };
    var g = document.createElement("div");
    g.className = "grade";
    var btns = '<div class="grade-btns">';
    [1, 2, 3, 4].forEach(function (k) {
      btns += '<button class="grade-btn" data-g="' + k + '"><span>' + labels[k] +
        '</span><span class="when">' + FSRS.humanInterval(preview[k]) + '</span></button>';
    });
    btns += "</div>";
    g.innerHTML = '<div class="grade-q">How well did you recall this? <kbd>1</kbd>–<kbd>4</kbd></div>' + btns;
    card.appendChild(g);
    animReveal(g);
    // reveal explanations + correctness marks as they appear
    var exps = card.querySelectorAll(".exp");
    if (fx.enabled && exps.length) G.from(exps, { opacity: 0, x: -6, duration: 0.3, stagger: 0.05, ease: "power2.out" });

    g.querySelectorAll(".grade-btn").forEach(function (b) {
      b.addEventListener("click", function () { grade(q, s, parseInt(b.dataset.g, 10), g); });
    });
  }

  function grade(q, s, gr, gEl) {
    var id = s.queue[s.pos];
    var before = cardFor(id);
    var wasNew = before.state === FSRS.STATE.NEW;
    var updated = scheduler.schedule(before, gr, Date.now());
    state.cards[id] = updated;

    // stats
    state.meta.reviewedTotal++;
    var tk = todayKey();
    if (state.meta.studyDays.indexOf(tk) < 0) state.meta.studyDays.push(tk);

    s.answers[s.pos].graded = gr;

    // leech flag
    if (updated.lapses >= LEECH_LAPSES && !updated.leech) { updated.leech = true; toast("Leech flagged — revisit this concept."); }

    // Again -> requeue in-session for immediate re-practice
    if (gr === 1) { s.queue.push(id); }

    if (gEl) {
      var next = FSRS.humanInterval(updated);
      gEl.innerHTML = '<div class="grade-done">Scheduled — next review in <b>' + next + '</b>' +
        (wasNew ? " (new card learned)" : "") + '. ' +
        (s.pos < s.queue.length - 1 ? "Press <kbd>&rarr;</kbd> for next." : "Finish when ready.") + '</div>';
    }
    save(); renderSidebar(); renderDashboard();
  }

  // ---- score ----
  function showScore() {
    var s = activeSession(); if (!s) return;
    s.done = true; switchScreen("score");
    var total = 0, correct = 0, perTopic = {};
    Object.keys(s.answers).forEach(function (posKey) {
      var a = s.answers[posKey]; if (!a) return;
      var id = s.queue[posKey]; var q = byId[id]; if (!q) return;
      total++; if (a.correct) correct++;
      var t = q.sectionTitle;
      perTopic[t] = perTopic[t] || { n: 0, ok: 0 };
      perTopic[t].n++; if (a.correct) perTopic[t].ok++;
    });
    var pct = total ? Math.round((correct / total) * 100) : 0;
    el["final-score"].textContent = correct + " / " + total + "  (" + pct + "%)";
    // stamp the grade on like a marker press
    if (fx.enabled) { G.fromTo(el["final-score"], { scale: 0.4, opacity: 0, rotation: -18 }, { scale: 1, opacity: 1, rotation: -4, duration: 0.55, ease: "back.out(2)" }); }
    var fb = pct >= 80 ? "Strong. You're exam-ready on this set."
      : pct >= 60 ? "Solid. Drill the weak topics below."
      : "Keep going. Review theory, then retry.";
    el["score-feedback"].textContent = fb;

    // breakdown by topic
    var bd = "";
    Object.keys(perTopic).forEach(function (t) {
      var o = perTopic[t]; var p = Math.round((o.ok / o.n) * 100);
      var col = p >= 80 ? "var(--tick)" : p >= 50 ? "#c8901e" : "var(--pen)";
      bd += '<div class="sb-row"><span class="sb-name">' + esc(t) + '</span>' +
        '<span class="sb-val">' + o.ok + "/" + o.n + " · " + p + '%</span>' +
        '<div class="sb-bar"><div class="sb-fill" style="width:' + p + '%;background:' + col + '"></div></div></div>';
    });
    el["score-breakdown"].innerHTML = bd;
    if (fx.enabled) {
      var rows = el["score-breakdown"].querySelectorAll(".sb-row");
      if (rows.length) G.from(rows, { opacity: 0, y: 8, duration: 0.3, stagger: 0.06, ease: "power2.out", delay: 0.3 });
      var fills = el["score-breakdown"].querySelectorAll(".sb-fill");
      fills.forEach(function (f) { var w = f.style.width; G.fromTo(f, { width: 0 }, { width: w, duration: 0.6, ease: "power2.out", delay: 0.35 }); });
    }

    var weak = weakList().length;
    el["weak-count"].textContent = weak;
    el["btn-weak"].classList.toggle("hidden", weak === 0);
    save(); renderDashboard();
  }

  // ---- sidebar + dashboard ----
  function renderSidebar() {
    el["session-list"].innerHTML = "";
    state.sessions.slice().reverse().forEach(function (s) {
      var li = document.createElement("li");
      li.className = "session-item" + (s.id === state.activeSessionId ? " active" : "");
      li.innerHTML =
        '<div class="session-meta"><span class="session-name">' + esc(s.name) + '</span>' +
        '<span class="session-date">' + esc(s.date) + '</span></div>' +
        '<button class="icon-btn btn-del" title="Delete" aria-label="Delete session"><svg class="ic ic-sm"><use href="#i-trash"/></svg></button>';
      li.addEventListener("click", function () { switchSession(s.id); });
      li.querySelector(".btn-del").addEventListener("click", function (e) { deleteSession(s.id, e); });
      el["session-list"].appendChild(li);
    });
  }

  function computeStreak() {
    var days = state.meta.studyDays.slice();
    if (!days.length) return 0;
    var set = {}; days.forEach(function (d) { set[d] = true; });
    var streak = 0; var cur = new Date();
    // if not studied today, start counting from yesterday
    if (!set[todayKey(cur.getTime())]) cur = new Date(cur.getTime() - DAY);
    while (set[todayKey(cur.getTime())]) { streak++; cur = new Date(cur.getTime() - DAY); }
    return streak;
  }

  function renderDashboard() {
    var now = Date.now();
    var due = dueList(now).length;
    var neu = newList().length;
    var learn = pool.filter(function (q) { var c = state.cards[q.id]; return c && (c.state === FSRS.STATE.LEARNING || c.state === FSRS.STATE.RELEARNING); }).length;

    // retention estimate = mean retrievability over reviewed (non-new) cards
    var rs = 0, rn = 0;
    pool.forEach(function (q) {
      var c = state.cards[q.id];
      if (c && c.state !== FSRS.STATE.NEW) { rs += scheduler.retrievability(c, now); rn++; }
    });
    var ret = rn ? Math.round((rs / rn) * 100) + "%" : "--";

    el["s-due"].textContent = due;
    el["s-new"].textContent = neu;
    el["s-learn"].textContent = learn;
    el["s-retention"].textContent = ret;
    el["due-pill"].textContent = due;
    el["streak-n"].textContent = computeStreak();
    el["reviewed-n"].textContent = state.meta.reviewedTotal + " reviewed";

    renderForecast(now);
    renderMastery();
  }

  function renderForecast(now) {
    var days = 14, counts = new Array(days).fill(0);
    var start = new Date(); start.setHours(0, 0, 0, 0);
    pool.forEach(function (q) {
      var c = state.cards[q.id];
      if (!c || c.state === FSRS.STATE.NEW) return;
      var d = Math.floor((c.due - start.getTime()) / DAY);
      if (d < 0) d = 0;
      if (d < days) counts[d]++;
    });
    var cv = el["forecast"]; var dpr = window.devicePixelRatio || 1;
    var w = cv.clientWidth || 280, h = 52;
    cv.width = w * dpr; cv.height = h * dpr;
    var ctx = cv.getContext("2d"); ctx.scale(dpr, dpr); ctx.clearRect(0, 0, w, h);
    var max = Math.max(1, Math.max.apply(null, counts));
    var css = getComputedStyle(document.documentElement);
    var pen = css.getPropertyValue("--pen").trim() || "#b0202f";
    var future = css.getPropertyValue("--tick").trim() || "#3f7d4e";
    var muted = css.getPropertyValue("--faint").trim() || "#889";
    var gap = 4, bw = (w - gap * (days - 1)) / days;
    counts.forEach(function (n, i) {
      var bh = Math.max(n ? 3 : 1, (n / max) * (h - 14));
      var x = i * (bw + gap), y = h - bh - 10;
      ctx.fillStyle = i === 0 ? pen : future;   // today = urgent (pen), future = scheduled (green)
      ctx.globalAlpha = n ? 1 : 0.25;
      roundRect(ctx, x, y, bw, bh, 2); ctx.fill();
      if (n) { ctx.globalAlpha = 1; ctx.fillStyle = muted; ctx.font = "9px " + (css.getPropertyValue("--mono") || "monospace"); ctx.textAlign = "center"; ctx.fillText(String(n), x + bw / 2, h - 1); }
    });
    ctx.globalAlpha = 1;
  }
  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  function renderMastery() {
    var html = "";
    sections.forEach(function (t) {
      var m = Math.round(topicMastery(t) * 100);
      var short = t.split(" - ")[0];
      var col = m >= 70 ? "var(--tick)" : m >= 40 ? "var(--ink-2)" : m >= 15 ? "#c8901e" : "var(--pen)";
      html += '<div class="mastery-row"><span class="mastery-name" title="' + esc(t) + '">' + esc(short) +
        '</span><span class="mastery-pct">' + m + '%</span>' +
        '<div class="mastery-bar"><div class="mastery-fill" style="width:' + m + '%;background:' + col + '"></div></div></div>';
    });
    el["mastery"].innerHTML = html;
  }

  // ---- theory panel ----
  function openTheory() {
    var s = activeSession(); if (!s) return;
    var q = byId[s.queue[s.pos]];
    var td = bankTheory();
    var html = td[q.questionText] || td[q.sectionTitle] || "";
    el["theory-content"].innerHTML = html || '<p class="faint">No reference note for this topic in this bank.</p>';
    openPanel(el["theory-panel"]);
  }

  // ---- panels ----
  function openPanel(p) {
    document.querySelectorAll(".panel.open").forEach(function (x) { if (x !== p) closePanel(x); });
    p.classList.add("open"); p.setAttribute("aria-hidden", "false");
    // stagger the panel's contents in (transform on .panel itself drives the slide via CSS)
    if (fx.enabled) { var kids = p.querySelectorAll(".panel-body > *"); if (kids.length) G.from(kids, { opacity: 0, y: 10, duration: 0.3, stagger: 0.04, ease: "power2.out", delay: 0.08 }); }
    if (window.innerWidth < 900) { el["scrim"].hidden = false; }
  }
  function closePanel(p) {
    p.classList.remove("open"); p.setAttribute("aria-hidden", "true");
    if (!document.querySelector(".panel.open")) el["scrim"].hidden = true;
  }

  // ============================================================
  //  AI TUTOR  (OpenRouter free models; floating dock)
  //  Failsafe: needs an API key + internet. No key/offline -> disabled.
  // ============================================================
  var chatHistory = [];   // [{role, content}]
  var chatAbort = null;

  function md(t) {
    var s = esc(t);
    s = s.replace(/```([\s\S]*?)```/g, function (_, c) { return "<pre><code>" + c.replace(/^\n/, "") + "</code></pre>"; });
    s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
    s = s.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
    s = s.replace(/^\s*[-*]\s+(.*)$/gm, "• $1");
    return s;
  }

  function addMsg(role, text) {
    var d = document.createElement("div");
    d.className = "msg " + role;
    d.innerHTML = role === "ai" ? md(text) : esc(text);
    el["chat-log"].appendChild(d);
    el["chat-log"].scrollTop = el["chat-log"].scrollHeight;
    return d;
  }

  function setAiDot(kind, title) {
    el["ai-dot"].className = "dot " + kind;
    el["ai-dot"].title = title || "";
  }

  function inputEnabled(on) {
    el["chat-text"].disabled = !on; el["chat-send"].disabled = !on;
    el["chat-text"].placeholder = on ? "Ask about this question…" : "Tutor unavailable";
  }

  // Populate the model picker from OpenRouter's live free-model list.
  async function populateModels() {
    var sel = el["chat-model"]; var cfg = AIChat.loadCfg();
    try {
      var models = await AIChat.listFreeModels();
      if (!models.length) { sel.innerHTML = '<option>' + esc(cfg.model) + "</option>"; return false; }
      sel.innerHTML = models.map(function (m) {
        var k = m.ctx ? Math.round(m.ctx / 1000) + "k" : "";
        return '<option value="' + esc(m.id) + '">' + esc(m.name) + (k ? "  · " + k : "") + "</option>";
      }).join("");
      // ensure current model is selectable even if not in the free list
      if (!models.some(function (m) { return m.id === cfg.model; })) {
        sel.insertAdjacentHTML("afterbegin", '<option value="' + esc(cfg.model) + '">' + esc(cfg.model) + " (current)</option>");
      }
      sel.value = cfg.model;
      return true;
    } catch (e) {
      sel.innerHTML = '<option value="' + esc(cfg.model) + '">' + esc(cfg.model) + "</option>";
      return false;
    }
  }

  // Availability: key + online. Then load models.
  async function initAI() {
    aiCap = AIChat.capability();
    if (!aiCap.ok) { setAiDot("off", aiCap.reason); return; }
    setAiDot("warn", "Loading models…");
    var ok = await populateModels();
    setAiDot(ok ? "on" : "warn", ok ? "OpenRouter ready" : "Could not load model list");
  }

  function renderUnavailable() {
    var reason = aiCap ? aiCap.reason : "The AI tutor is unavailable.";
    el["chat-log"].innerHTML =
      '<div class="dock-unavail"><b>Tutor unavailable</b><br><br>' + esc(reason) +
      '<br><br>Open <svg class="ic ic-sm" style="vertical-align:middle"><use href="#i-gear"/></svg> settings to add a key.</div>';
    inputEnabled(false);
  }

  function openDock(prefill) {
    el["chat-dock"].classList.remove("hidden");
    el["chat-dock"].setAttribute("aria-hidden", "false");
    el["chat-fab"].classList.add("hidden");
    if (!aiCap) aiCap = AIChat.capability();

    if (!aiCap.ok) { renderUnavailable(); return; }

    if (!el["chat-log"].dataset.started) {
      el["chat-log"].innerHTML = "";
      inputEnabled(true);
      addMsg("sys", "Free models via OpenRouter. Pick a model above, ask about the current question, or press E.");
      el["chat-log"].dataset.started = "1";
      if (!el["chat-model"].options.length) populateModels();
    } else {
      inputEnabled(true);
    }
    if (prefill) { el["chat-text"].value = prefill; sendChat(); }
    else setTimeout(function () { el["chat-text"].focus(); }, 60);
  }
  function closeDock() {
    el["chat-dock"].classList.add("hidden");
    el["chat-dock"].setAttribute("aria-hidden", "true");
    el["chat-fab"].classList.remove("hidden");
  }

  function currentQuestionForChat() {
    var s = activeSession(); if (!s) return null;
    return byId[s.queue[s.pos]];
  }

  async function sendChat() {
    var text = el["chat-text"].value.trim();
    if (!text) return;
    aiCap = AIChat.capability();
    if (!aiCap.ok) { renderUnavailable(); return; }

    el["chat-text"].value = ""; autosize();
    addMsg("user", text);

    // prior turns first, then the CURRENT question context, then the new user message —
    // so the model always sees the exact question right before what the student just asked.
    var prior = chatHistory.slice(-6);
    var s = activeSession();
    var q = currentQuestionForChat();
    var ans = s ? s.answers[s.pos] : null;
    var ctx = q ? AIChat.questionContext(q, { answered: !!ans, correct: ans ? ans.correct : null }) : "";
    var msgs = [{ role: "system", content: AIChat.SYSTEM_PROMPT }].concat(prior);
    if (ctx) msgs.push({ role: "system", content: ctx });
    msgs.push({ role: "user", content: text });
    chatHistory.push({ role: "user", content: text });

    var bubble = addMsg("ai", "");
    var acc = "";
    bubble.innerHTML = '<span class="cursor"></span>';
    el["chat-send"].classList.add("hidden");
    el["chat-stop"].classList.remove("hidden");
    chatAbort = new AbortController();

    await AIChat.stream(msgs, {
      signal: chatAbort.signal,
      onToken: function (t) { acc += t; bubble.innerHTML = md(acc) + '<span class="cursor"></span>'; el["chat-log"].scrollTop = el["chat-log"].scrollHeight; },
      onDone: function () {
        bubble.innerHTML = md(acc || "_(no output — try another free model)_");
        chatHistory.push({ role: "assistant", content: acc });
        finishStream();
      },
      onError: function (msg) {
        bubble.classList.remove("ai"); bubble.classList.add("sys");
        bubble.textContent = msg;
        setAiDot("warn", "Request failed");
        finishStream();
      }
    });
  }
  function finishStream() {
    el["chat-send"].classList.remove("hidden");
    el["chat-stop"].classList.add("hidden");
    chatAbort = null;
  }
  function autosize() {
    var t = el["chat-text"]; t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 120) + "px";
  }

  // settings panel (API key + model loading)
  function openSettings() {
    var cfg = AIChat.loadCfg();
    el["set-key"].value = cfg.key || "";
    el["set-status"].textContent = "";
    openPanel(el["settings-panel"]);
    renderDashboard(); // ensure canvas/mastery are current when panel opens
  }
  async function refreshModels() {
    el["set-status"].textContent = "Fetching free models…";
    var cfg = AIChat.loadCfg(); cfg.key = el["set-key"].value.trim() || cfg.key; AIChat.saveCfg(cfg);
    try { var m = await AIChat.listFreeModels(true); await populateModels(); el["set-status"].textContent = m.length + " free models loaded."; setAiDot("on", "OpenRouter ready"); }
    catch (e) { el["set-status"].textContent = "Failed: " + e.message; }
  }
  function saveKey() {
    var cfg = AIChat.loadCfg();
    cfg.key = el["set-key"].value.trim() || cfg.key;
    if (el["chat-model"] && el["chat-model"].value) cfg.model = el["chat-model"].value;
    AIChat.saveCfg(cfg);
    el["set-status"].textContent = "Saved. Key stored in this browser only.";
    el["chat-log"].dataset.started = "";
    initAI();
    toast("Key saved.");
  }

  // ---- question bank: import / export / reset ----
  function bankInfo() {
    if (!el["bank-name"]) return;
    var n = pool.length;
    el["bank-name"].textContent = (bank && bank.title) || "Untitled";
    el["bank-count"].textContent = n + " question" + (n === 1 ? "" : "s") + " · " + sections.length + " topic" + (sections.length === 1 ? "" : "s");
  }
  function importBank(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var parsed;
      try { parsed = JSON.parse(reader.result); }
      catch (e) { el["bank-status"].textContent = "Not valid JSON: " + e.message; return; }
      var err = validateBank(parsed);
      if (err) { el["bank-status"].textContent = "Invalid bank: " + err; return; }
      try { localStorage.setItem(BANK_KEY, JSON.stringify(parsed)); } catch (e) { el["bank-status"].textContent = "Could not save (storage full?)."; return; }
      // new bank = new card ids; clear old sessions/cards so nothing is stale
      try { localStorage.removeItem(LS_KEY); } catch (e) {}
      toast("Bank imported. Reloading…");
      setTimeout(function () { location.reload(); }, 500);
    };
    reader.onerror = function () { el["bank-status"].textContent = "Could not read the file."; };
    reader.readAsText(file);
  }
  function exportBank() {
    var out = bank || FALLBACK_BANK;
    var blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    var safe = ((out.title || "deck").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")) || "deck";
    a.href = url; a.download = safe + ".json";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    el["bank-status"].textContent = "Exported " + a.download + ".";
  }
  function resetBank() {
    try { localStorage.removeItem(BANK_KEY); localStorage.removeItem(LS_KEY); } catch (e) {}
    toast("Reset to sample. Reloading…");
    setTimeout(function () { location.reload(); }, 500);
  }

  // ---- theme ----
  function applyTheme(mode) {
    document.documentElement.setAttribute("data-theme", mode);
    state.meta.theme = mode;
    el["btn-theme"].querySelector("use").setAttribute("href", mode === "dark" ? "#i-sun" : "#i-moon");
    save();
    renderDashboard(); // recolor canvas
  }
  function initTheme() {
    var mode = state.meta.theme;
    if (!mode) mode = window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    applyTheme(mode);
  }

  // ---- keyboard ----
  function onKey(e) {
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.tagName === "SELECT") return;
    if (!el["new-modal"].classList.contains("hidden")) return;
    var s = activeSession(); if (!s || el["score-screen"].classList.contains("active")) return;
    var ans = s.answers[s.pos];
    var q = byId[s.queue[s.pos]];

    if (["1", "2", "3", "4"].indexOf(e.key) >= 0) {
      var n = parseInt(e.key, 10) - 1;
      if (!ans && q.type !== "FIB") { if (q.answerOptions[n]) { e.preventDefault(); answerMCQ(q, s, n); } }
      else if (ans && ans.graded == null) {
        e.preventDefault();
        var gEl = el["question-container"].querySelector(".grade");
        grade(q, s, n + 1, gEl);
      }
    } else if (e.key === "ArrowRight") { if (!el["btn-next"].disabled) { s.pos++; save(); renderQuestion(); } }
    else if (e.key === "ArrowLeft") { if (s.pos > 0) { s.pos--; save(); renderQuestion(); } }
    else if (e.key.toLowerCase() === "t") { e.preventDefault(); openTheory(); }
    else if (e.key.toLowerCase() === "e") { e.preventDefault(); explainCurrent(); }
  }

  function explainCurrent() {
    var q = currentQuestionForChat(); if (!q) return;
    openDock("Explain this question simply and tell me the key concept to remember.");
  }

  // ---- wire events ----
  function wire() {
    el["btn-next"].addEventListener("click", function () { var s = activeSession(); if (s && s.pos < s.queue.length - 1) { s.pos++; save(); renderQuestion(); } });
    el["btn-prev"].addEventListener("click", function () { var s = activeSession(); if (s && s.pos > 0) { s.pos--; save(); renderQuestion(); } });
    el["btn-submit"].addEventListener("click", showScore);
    el["btn-retry"].addEventListener("click", function () { createSession("interleave", "MCQ", 15); });
    el["btn-weak"].addEventListener("click", function () { createSession("weak", "BOTH", 30); });
    el["btn-review-due"].addEventListener("click", function () { createSession("due", "BOTH", 40); });

    // new-session modal
    el["btn-new-session"].addEventListener("click", openModal);
    el["close-modal"].addEventListener("click", closeModal);
    el["m-mode"].addEventListener("change", function () { el["topic-field"].hidden = el["m-mode"].value !== "topic"; });
    el["btn-start"].addEventListener("click", function () {
      var mode = el["m-mode"].value, type = el["m-type"].value, count = parseInt(el["m-count"].value, 10) || 15, topic = el["m-topic"].value;
      if (createSession(mode, type, count, topic)) closeModal();
    });

    // slide-in panels
    el["close-theory"].addEventListener("click", function () { closePanel(el["theory-panel"]); });
    el["close-settings"].addEventListener("click", function () { closePanel(el["settings-panel"]); });
    el["btn-progress"].addEventListener("click", openSettings);
    el["scrim"].addEventListener("click", function () { document.querySelectorAll(".panel.open").forEach(closePanel); document.body.classList.remove("margin-open"); el["scrim"].hidden = true; });

    // floating chat dock
    el["chat-fab"].addEventListener("click", function () { openDock(); });
    el["close-chat"].addEventListener("click", closeDock);
    el["chat-send"].addEventListener("click", sendChat);
    el["chat-stop"].addEventListener("click", function () { if (chatAbort) chatAbort.abort(); });
    el["chat-text"].addEventListener("input", autosize);
    el["chat-text"].addEventListener("keydown", function (e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); } });
    el["chat-model"].addEventListener("change", function () { var c = AIChat.loadCfg(); c.model = el["chat-model"].value; AIChat.saveCfg(c); toast("Model: " + el["chat-model"].value); });
    el["btn-chat-cfg"].addEventListener("click", openSettings);
    el["set-refresh"].addEventListener("click", refreshModels);
    el["set-save"].addEventListener("click", saveKey);

    // question bank import / export / reset
    el["btn-bank-import"].addEventListener("click", function () { el["bank-file"].click(); });
    el["bank-file"].addEventListener("change", function (e) { if (e.target.files && e.target.files[0]) importBank(e.target.files[0]); e.target.value = ""; });
    el["btn-bank-export"].addEventListener("click", exportBank);
    el["btn-bank-reset"].addEventListener("click", resetBank);

    // margin + theme
    el["btn-collapse"].addEventListener("click", function () { document.body.classList.add("margin-collapsed"); });
    el["btn-open-margin"].addEventListener("click", function () { document.body.classList.remove("margin-collapsed"); document.body.classList.add("margin-open"); });
    el["btn-theme"].addEventListener("click", function () { applyTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark"); });

    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", function () { renderForecast(Date.now()); });
  }

  function openModal() {
    // populate topic list
    el["m-topic"].innerHTML = sections.map(function (t) { return '<option value="' + esc(t) + '">' + esc(t) + "</option>"; }).join("");
    el["topic-field"].hidden = el["m-mode"].value !== "topic";
    el["new-modal"].classList.remove("hidden");
  }
  function closeModal() { el["new-modal"].classList.add("hidden"); }

  // ---- boot ----
  async function init() {
    bank = await resolveBank();      // load the active question bank first
    if (!buildPool()) { wire(); return; }
    load();
    initTheme();
    wire();
    bankInfo();
    renderSidebar();
    renderDashboard();

    if (state.sessions.length && state.activeSessionId) switchSession(state.activeSessionId);
    else createSession("interleave", "MCQ", 15);

    initAI(); // async, updates the AI status dot

    // gentle intro: margin + fab settle in
    if (fx.enabled) {
      G.from(".margin-head, .actions, .sessions-rule, #session-list", { opacity: 0, x: -14, duration: 0.4, stagger: 0.06, ease: "power2.out" });
      G.from("#chat-fab", { scale: 0, duration: 0.5, ease: "back.out(2)", delay: 0.4 });
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
