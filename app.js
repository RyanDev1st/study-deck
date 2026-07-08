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

  var LS_KEY = "dm_study_v1";
  var MATURE_DAYS = 21;        // stability at which a card counts as "mastered"
  var LEECH_LAPSES = 8;        // lapses before a card is flagged a leech
  var DAY = 86400000;

  var scheduler = new FSRS({ requestRetention: 0.9, maximumInterval: 365 });
  // Theoretical (definition/theorem/recall) cards get a HIGHER desired retention, so FSRS
  // schedules them at shorter intervals -> they resurface more often across days.
  var schedulerTheory = new FSRS({ requestRetention: 0.94, maximumInterval: 365 });

  // In-session learning steps (Anki-style). A struggled card is re-inserted a SHORT gap ahead
  // (not dumped at the end), so you re-see it soon even in a big set. LEARN_REPEATS caps how many
  // times one card can re-queue; LEARN_GAP is roughly how many other cards you see before it returns.
  var LEARN_REPEATS = { theory: 2, normal: 1 };
  var LEARN_GAP = { theory: 3, normal: 6 };

  // Classify a question as theoretical (memorize) vs computational (derive on the spot).
  // Priority: user's per-card toggle -> explicit data flag -> heuristic on the question text.
  function isTheoretical(q) {
    if (!q) return false;
    var flags = state.meta && state.meta.theoryFlags;
    if (flags && typeof flags[q.id] === "boolean") return flags[q.id];
    if (typeof q.theoretical === "boolean") return q.theoretical;
    if (q.type === "FIB") return false;
    // computational cues: the question asks you to count/compute a value
    return !/^\s*(how many|in how many|compute|calculate|find the coefficient|find the number|what is the coefficient|what is the value of|find a closed formula|find the closed formula|solve )/i.test(q.questionText || "");
  }
  function schedFor(q) { return isTheoretical(q) ? schedulerTheory : scheduler; }

  // ---- element refs ----
  var $ = function (id) { return document.getElementById(id); };
  var el = {};
  ["question-container","btn-prev","btn-next","btn-submit","submit-row","progress-fill",
   "progress-text","session-name","quiz-screen","score-screen","final-score","score-feedback",
   "btn-retry","btn-weak","weak-count","score-breakdown","session-list","btn-new-session",
   "btn-review-due","due-pill","btn-collapse","btn-open-margin","btn-theme","margin",
   "s-due","s-new","s-learn","s-retention","streak-n","reviewed-n","forecast","mastery",
   "theory-panel","theory-content","close-theory","chat-dock","chat-fab","close-chat","chat-log",
   "chat-text","chat-send","chat-stop","chat-explain","btn-chat-cfg","ai-dot","chat-model","scrim","toast",
   "btn-progress","settings-panel","close-settings","set-key","set-refresh","set-save","set-status",
   "new-modal","close-modal","m-subject","subject-field","m-mode","m-topic","topic-field","m-type","m-count","btn-start",
   "btn-redo-missed","paper-panel","close-paper","paper-text","paper-save","paper-clear","btn-paper","paper-count",
   "chat-attach","chat-image","chat-img-chip"
  ].forEach(function (k) { el[k] = $(k); });

  // ---- state ----
  var pool = [];                 // [{id, sectionTitle, ...question}]
  var byId = {};                 // id -> question
  var sections = [];             // ordered section titles (all subjects)
  var subjects = [];             // ordered subject names (quizData[].title)
  var sectionsBySubject = {};    // subject -> [section titles]
  var subjectOfSection = {};     // section title -> subject
  var state = {
    activeSessionId: null,
    sessions: [],
    cards: {},                   // id -> FSRS card
    meta: { reviewedTotal: 0, studyDays: [], theme: null, draftPaper: "", theoryFlags: {} }
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
        if (typeof state.meta.draftPaper !== "string") state.meta.draftPaper = "";
        if (!state.meta.theoryFlags) state.meta.theoryFlags = {};
        // migrate older sessions to slot-keyed state (answers/optOrder were keyed by position,
        // which equals the initial slot ids, so no re-keying is needed — just add the arrays).
        (state.sessions || []).forEach(function (s) {
          if (!s.slots) s.slots = (s.queue || []).map(function (_, i) { return i; });
          if (s.slotSeq == null) s.slotSeq = (s.queue || []).length;
          if (!s.learn) s.learn = {};
          if (!s.wrong) s.wrong = [];
          if (!s.optOrder) s.optOrder = {};
        });
      }
    } catch (e) {}
  }
  // Stable per-slot key for the card at a queue position (survives mid-queue inserts).
  function slotAt(s, pos) { if (!s.slots) s.slots = s.queue.map(function (_, i) { return i; }); return s.slots[pos]; }
  function nextSlot(s) { if (s.slotSeq == null) s.slotSeq = s.queue.length; return s.slotSeq++; }

  // ---- pool ----
  function buildPool() {
    // NB: data.js declares `const quizData`, which is NOT a window property — reference it bare.
    if (typeof quizData === "undefined" || !quizData[0] || !quizData[0].quizzes) {
      el["question-container"].innerHTML = '<div class="q-card"><p>Could not load questions (data.js).</p></div>';
      return false;
    }
    // Each top-level entry in quizData is a SUBJECT; its quizzes[] are the sections.
    quizData.forEach(function (subj) {
      var sname = subj.title;
      if (subjects.indexOf(sname) < 0) { subjects.push(sname); sectionsBySubject[sname] = []; }
      (subj.quizzes || []).forEach(function (sec) {
        if (sections.indexOf(sec.title) < 0) sections.push(sec.title);
        if (sectionsBySubject[sname].indexOf(sec.title) < 0) sectionsBySubject[sname].push(sec.title);
        subjectOfSection[sec.title] = sname;
        sec.quiz.forEach(function (q, i) {
          var item = Object.assign({}, q, { id: sec.title + "::" + i, sectionTitle: sec.title, subject: sname });
          pool.push(item);
          byId[item.id] = item;
        });
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
  function makeQueue(mode, type, count, topic, subject) {
    var src;
    if (mode === "due") src = dueList();
    else if (mode === "new") src = newList();
    else if (mode === "weak") src = weakList();
    else if (mode === "topic") src = pool.filter(function (q) { return q.sectionTitle === topic; });
    else src = pool.slice(); // interleave = everything

    // Subject filter (applies to every mode except single-topic, where topic already fixes it)
    if (subject && mode !== "topic") src = src.filter(function (q) { return q.subject === subject; });

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

  function modeName(mode, topic, subject) {
    var base = ({ interleave: "Interleaved", due: "Due reviews", new: "New cards", weak: "Weak topics", topic: topic })[mode] || "Session";
    if (subject && mode !== "topic") base = subject + " — " + base;
    return base;
  }

  function createSession(mode, type, count, topic, subject) {
    var queue = makeQueue(mode, type, count, topic, subject);
    if (!queue.length) {
      toast(mode === "due" ? "Nothing due right now — great job!" : "No questions match those filters.");
      return false;
    }
    return startSession(queue, modeName(mode, topic, subject));
  }

  // Build a session from an explicit list of card ids (used by "Redo missed").
  function createSessionFromIds(ids, name) {
    var seen = {}, valid = [];
    (ids || []).forEach(function (id) { if (byId[id] && !seen[id]) { seen[id] = true; valid.push(id); } });
    if (!valid.length) { toast("Nothing to redo — no missed questions."); return false; }
    return startSession(interleave(shuffle(valid.map(function (id) { return byId[id]; }))).map(function (q) { return q.id; }), name);
  }

  function startSession(queue, name) {
    var s = {
      id: Date.now().toString(),
      name: name,
      date: new Date().toLocaleString(),
      queue: queue, pos: 0, answers: {}, done: false,
      optOrder: {}, wrong: [], learn: {},
      slots: queue.map(function (_, i) { return i; }),   // slot id per position; answers/optOrder key off these
      slotSeq: queue.length
    };
    state.sessions.push(s);
    state.activeSessionId = s.id;
    switchScreen("quiz");
    save();
    renderSidebar();
    renderQuestion();
    refreshChatIfOpen();   // new booklet -> fresh chat in the open dock
    return true;
  }
  function activeSession() { return state.sessions.find(function (s) { return s.id === state.activeSessionId; }); }

  function switchSession(id) {
    state.activeSessionId = id;
    var s = activeSession();
    if (s && s.done) showScore(); else { switchScreen("quiz"); renderQuestion(); }
    save(); renderSidebar();
    refreshChatIfOpen();   // show this booklet's saved conversation
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
    var ans = s.answers[slotAt(s, s.pos)];   // {choice, correct, graded, cardBefore} — keyed by slot
    var host = el["question-container"];
    host.innerHTML = "";

    var card = document.createElement("div");
    card.className = "q-card";

    var theo = isTheoretical(q);
    card.innerHTML =
      '<div class="q-head">' +
        '<span class="q-badge">' + esc(q.sectionTitle) + '</span>' +
        '<button type="button" class="theory-toggle' + (theo ? " on" : "") + '" title="Theory cards get more spaced-repetition. Click to toggle.">' +
          '<svg class="ic ic-sm"><use href="#i-bolt"/></svg> ' + (theo ? "Theory" : "Mark theory") + '</button>' +
        '<button type="button" class="unclear-btn"><svg class="ic ic-sm"><use href="#i-book"/></svg> Unclear?</button>' +
      '</div>' +
      '<div class="q-title">' + esc(q.questionText) + '</div>';

    if (q.type === "FIB") renderFIB(card, q, s, ans);
    else renderMCQ(card, q, s, ans);

    host.appendChild(card);
    card.querySelector(".unclear-btn").addEventListener("click", openTheory);
    card.querySelector(".theory-toggle").addEventListener("click", function () { toggleTheory(q); });
    if (!ans) animQuestion(card); // only animate a fresh (unanswered) sheet
    if (ans) renderGrade(card, q, s, ans); // answered -> always show the grade row (highlights your pick)
  }

  // Stable shuffle of the answer options (correct is NOT always A).
  // Keyed by SLOT id (survives mid-queue inserts); generated once, persisted.
  function optionOrder(s, pos, q) {
    if (!s.optOrder) s.optOrder = {};
    var slot = slotAt(s, pos);
    var cur = s.optOrder[slot];
    if (!cur || cur.length !== q.answerOptions.length) {
      var idx = q.answerOptions.map(function (_, i) { return i; });
      s.optOrder[slot] = shuffle(idx);
      save();
    }
    return s.optOrder[slot];
  }

  function renderMCQ(card, q, s, ans) {
    var wrap = document.createElement("div");
    wrap.className = "options";
    var answered = !!ans;
    var order = optionOrder(s, s.pos, q);   // display position -> original option index

    order.forEach(function (origIdx, dispPos) {
      var opt = q.answerOptions[origIdx];
      var lab = document.createElement("label");
      lab.className = "opt";
      var key = String.fromCharCode(65 + dispPos);   // letter follows DISPLAY order
      lab.innerHTML =
        '<div class="opt-row"><span class="opt-key">' + key + '</span>' +
        '<span class="opt-text">' + esc(opt.answerText) + '</span></div>';
      var input = document.createElement("input");
      input.type = "radio"; input.name = "opt"; input.value = origIdx;
      lab.insertBefore(input, lab.firstChild);

      if (answered) {
        lab.classList.add("disabled");
        if (isCorrectOpt(opt)) lab.classList.add("correct");
        else if (ans.choice === origIdx) lab.classList.add("wrong");
        if (ans.choice === origIdx) lab.classList.add("selected");
        appendExp(lab, opt.explanation, isCorrectOpt(opt));
      } else {
        lab.addEventListener("click", function (e) { e.preventDefault(); answerMCQ(q, s, origIdx); });
      }
      wrap.appendChild(lab);
    });
    card.appendChild(wrap);
  }

  function toggleTheory(q) {
    if (!state.meta.theoryFlags) state.meta.theoryFlags = {};
    var now = !isTheoretical(q);
    state.meta.theoryFlags[q.id] = now;
    save();
    toast(now ? "Marked theoretical — stronger spaced repetition." : "Marked computational.");
    renderQuestion();
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
    s.answers[slotAt(s, s.pos)] = { choice: choice, correct: correct, graded: null };
    if (!correct) logWrong(s, q.id);
    save(); renderQuestion();
  }
  function answerFIB(q, s, raw) {
    var correct = raw.toLowerCase().trim() === String(q.correctAnswer).toLowerCase().trim();
    s.answers[slotAt(s, s.pos)] = { raw: raw, correct: correct, graded: null };
    if (!correct) logWrong(s, q.id);
    save(); renderQuestion();
  }

  // Record a card the student got wrong this session -> the "Redo missed" pile at the end.
  function logWrong(s, id) {
    if (!s.wrong) s.wrong = [];
    if (s.wrong.indexOf(id) < 0) s.wrong.push(id);
  }
  // In-session spaced repetition (Anki learning-step style). The GRADE is the source of truth:
  // Again (and Hard for theory) schedules a re-practice copy a SHORT gap ahead — so it recurs SOON,
  // not after the whole (possibly 100-card) set — while Good/Easy schedules none. Re-grading toggles
  // this: grade up and the pending copy is removed; grade down and one is added. The MCQ wrong-log
  // (Redo missed) is the separate safety net, so a wrong-but-graded-Good card is never lost.
  function applyLearningStep(s, id, q, gr, ansRec) {
    var wantRequeue = (gr === 1) || (isTheoretical(q) && gr === 2);
    if (wantRequeue) {
      if (ansRec.requeuedSlot == null) ansRec.requeuedSlot = insertLearningCopy(s, id, isTheoretical(q));
    } else if (ansRec.requeuedSlot != null) {
      removeRequeue(s, id, ansRec);
    }
  }
  // Splice a fresh unanswered copy of the card a few positions ahead. Returns its slot id (or null
  // if the per-session repeat cap is hit). The original slot keeps its own answer/grade.
  function insertLearningCopy(s, id, theo) {
    if (!s.learn) s.learn = {};
    var cap = theo ? LEARN_REPEATS.theory : LEARN_REPEATS.normal;
    if ((s.learn[id] || 0) >= cap) return null;          // cumulative cap so one session can't loop forever
    s.learn[id] = (s.learn[id] || 0) + 1;
    var gap = theo ? LEARN_GAP.theory : LEARN_GAP.normal;
    var at = Math.min(s.pos + 1 + gap, s.queue.length);  // a few cards ahead (append if near the end)
    var slot = nextSlot(s);
    s.queue.splice(at, 0, id);
    s.slots.splice(at, 0, slot);
    toast(theo ? "Theory card — back in ~" + (at - s.pos) + " cards." : "Re-queued — back in ~" + (at - s.pos) + " cards.");
    return slot;
  }
  // Drop a still-unanswered re-practice copy (used when a re-grade graduates the card).
  function removeRequeue(s, id, ansRec) {
    var slot = ansRec.requeuedSlot;
    if (slot == null) return;
    var idx = s.slots.indexOf(slot);
    if (idx >= 0 && !s.answers[slot]) {                  // only if that copy hasn't been answered yet
      s.queue.splice(idx, 1);
      s.slots.splice(idx, 1);
      if (idx <= s.pos) s.pos--;                         // keep pos on the same card if we removed before it
      if (s.learn && s.learn[id]) s.learn[id]--;         // free the repeat budget (concurrent cap)
      toast("Recalled it — removed the re-practice copy.");
    }
    ansRec.requeuedSlot = null;
  }

  // grading with FSRS previews. Called for every ANSWERED card (fresh or revisited), so the grade
  // you picked stays visible and can be changed. Previews are computed from the card state BEFORE
  // this slot was first graded (ans.cardBefore), so re-grading never compounds the schedule.
  function renderGrade(card, q, s, ans) {
    var id = s.queue[s.pos];
    var base = (ans && ans.cardBefore) ? ans.cardBefore : cardFor(id);
    var preview = schedFor(q).preview(base);
    var labels = { 1: "Again", 2: "Hard", 3: "Good", 4: "Easy" };
    var graded = ans && ans.graded != null;
    var g = document.createElement("div");
    g.className = "grade";
    var btns = '<div class="grade-btns">';
    [1, 2, 3, 4].forEach(function (k) {
      var chosen = graded && ans.graded === k ? " chosen" : "";
      btns += '<button class="grade-btn' + chosen + '" data-g="' + k + '"><span>' + labels[k] +
        '</span><span class="when">' + FSRS.humanInterval(preview[k]) + '</span></button>';
    });
    btns += "</div>";
    var head = graded
      ? 'You graded this <b>' + labels[ans.graded] + '</b> · next review in <b>' + FSRS.humanInterval(state.cards[id] || preview[ans.graded]) + '</b>. Change it below if needed.'
      : 'How well did you recall this? <kbd>1</kbd>–<kbd>4</kbd>';
    g.innerHTML = '<div class="grade-q">' + head + '</div>' + btns;
    card.appendChild(g);
    if (!graded) {
      animReveal(g);
      var exps = card.querySelectorAll(".exp");
      if (fx.enabled && exps.length) G.from(exps, { opacity: 0, x: -6, duration: 0.3, stagger: 0.05, ease: "power2.out" });
    }
    g.querySelectorAll(".grade-btn").forEach(function (b) {
      b.addEventListener("click", function () { grade(q, s, parseInt(b.dataset.g, 10)); });
    });
  }

  function grade(q, s, gr) {
    var id = s.queue[s.pos];
    var ansRec = s.answers[slotAt(s, s.pos)];
    if (!ansRec) return;                       // can only grade an answered card
    var firstTime = ansRec.graded == null;
    // snapshot the pre-grade card ONCE per slot, so re-grading recomputes from the same base
    if (ansRec.cardBefore == null) ansRec.cardBefore = Object.assign({}, cardFor(id));
    var base = ansRec.cardBefore;
    var wasNew = base.state === FSRS.STATE.NEW;
    var updated = schedFor(q).schedule(base, gr, Date.now());
    state.cards[id] = updated;
    ansRec.graded = gr;

    if (firstTime) {
      // stats run only on the FIRST grade of this slot (re-grading must not double-count)
      state.meta.reviewedTotal++;
      var tk = todayKey();
      if (state.meta.studyDays.indexOf(tk) < 0) state.meta.studyDays.push(tk);
      if (updated.lapses >= LEECH_LAPSES && !updated.leech) { updated.leech = true; toast("Leech flagged — revisit this concept."); }
      if (gr === 1) logWrong(s, id);   // self-graded Again also lands in the redo pile
      if (wasNew) toast("New card learned.");
    }
    // learning step runs on every grade: it adds a re-practice copy for Again/Hard(theory),
    // or removes a still-pending one when you re-grade the card up to Good/Easy.
    applyLearningStep(s, id, q, gr, ansRec);

    save(); renderQuestion(); renderSidebar(); renderDashboard();
  }

  // Score a session by DISTINCT card (a card re-queued and later fixed counts once, last answer wins),
  // walking slots in queue order so the most recent answer for each card is the one kept.
  function computeScore(s) {
    var byCard = {}, order = [];
    (s.slots || []).forEach(function (slot, pos) {
      var a = s.answers[slot]; if (!a) return;
      var id = s.queue[pos]; if (!byId[id]) return;
      if (byCard[id] === undefined) order.push(id);
      byCard[id] = a;   // later slot (a re-practice) overwrites -> last answer wins
    });
    var total = 0, correct = 0, perTopic = {};
    order.forEach(function (id) {
      var a = byCard[id], q = byId[id];
      total++; if (a.correct) correct++;
      var t = q.sectionTitle;
      perTopic[t] = perTopic[t] || { n: 0, ok: 0 };
      perTopic[t].n++; if (a.correct) perTopic[t].ok++;
    });
    return { total: total, correct: correct, perTopic: perTopic };
  }

  // ---- score ----
  function showScore() {
    var s = activeSession(); if (!s) return;
    s.done = true; switchScreen("score");
    var sc = computeScore(s);
    var total = sc.total, correct = sc.correct, perTopic = sc.perTopic;
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

    // "Redo missed" — the cards answered wrong (or self-graded Again) this session
    var missed = (s.wrong || []).filter(function (id) { return byId[id]; });
    if (el["btn-redo-missed"]) {
      el["btn-redo-missed"].classList.toggle("hidden", missed.length === 0);
      if (missed.length) el["btn-redo-missed"].innerHTML =
        '<svg class="ic ic-sm"><use href="#i-redo"/></svg> Redo missed (' + missed.length + ')';
    }
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
    var html = "";
    if (typeof theoryData !== "undefined") {
      if (theoryData[q.questionText]) html = theoryData[q.questionText];
      else if (theoryData[q.sectionTitle]) html = theoryData[q.sectionTitle];
    }
    el["theory-content"].innerHTML = html || '<p class="faint">No reference note for this concept yet.</p>';
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
  // Chat history is per study-session and persists inside the session object
  // (saved with the rest of state under aids_study_v4). Switch sessions -> switch chat.
  var INTRO_MSG = "Ask about the current question, tap the lightbulb to explain it, or just chat. Your conversation is saved per booklet.";
  function sessionChat() { var s = activeSession(); if (!s) return null; if (!s.chat) s.chat = []; return s.chat; }
  function renderChatLog() {
    if (!el["chat-log"]) return;
    el["chat-log"].innerHTML = "";
    var hist = sessionChat();
    if (!hist || !hist.length) { addMsg("sys", INTRO_MSG); return; }
    hist.forEach(function (m) { addMsg(m.role === "assistant" ? "ai" : "user", m.content); });
  }
  function refreshChatIfOpen() {
    if (el["chat-dock"] && !el["chat-dock"].classList.contains("hidden") && aiCap && aiCap.ok) renderChatLog();
  }
  var chatAbort = null;
  var pendingImage = null;   // data-URL of an image the student attached to the next message

  // Read a picked image file into a data URL and show a small preview chip above the input.
  function pickImage(file) {
    if (!file || !/^image\//.test(file.type)) { toast("Please choose an image file."); return; }
    if (file.size > 4 * 1024 * 1024) { toast("Image too large (max 4 MB)."); return; }
    var r = new FileReader();
    r.onload = function () {
      pendingImage = r.result;
      if (el["chat-img-chip"]) {
        el["chat-img-chip"].innerHTML = '<img src="' + pendingImage + '" alt="attachment"><button type="button" class="img-x" title="Remove">&times;</button>';
        el["chat-img-chip"].classList.remove("hidden");
        var x = el["chat-img-chip"].querySelector(".img-x");
        if (x) x.addEventListener("click", clearPendingImage);
      }
    };
    r.readAsDataURL(file);
  }
  function clearPendingImage() {
    pendingImage = null;
    if (el["chat-image"]) el["chat-image"].value = "";
    if (el["chat-img-chip"]) { el["chat-img-chip"].innerHTML = ""; el["chat-img-chip"].classList.add("hidden"); }
  }

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
    if (role === "ai") typeset(d);
    el["chat-log"].scrollTop = el["chat-log"].scrollHeight;
    return d;
  }

  // Render LaTeX ($...$, $$...$$) with the locally-vendored MathJax (SVG output, offline).
  // esc() turns & < > into entities, but the DOM decodes them back in text nodes, so MathJax
  // still reads the raw math. We typeset only on completed messages (not per token).
  function typeset(node) {
    if (!node || !window.MathJax || !window.MathJax.typesetPromise) return;
    try { window.MathJax.typesetClear && window.MathJax.typesetClear([node]); } catch (_) {}
    window.MathJax.typesetPromise([node]).catch(function () {});
  }

  // Pull [[NOTE: ...]] blocks out of an AI reply: returns the cleaned text + the notes.
  function extractNotes(text) {
    var notes = [];
    var shown = String(text || "").replace(/\[\[NOTE:\s*([\s\S]*?)\]\]/gi, function (_, n) { notes.push(n.trim()); return ""; });
    return { shown: shown.replace(/\n{3,}/g, "\n\n").trim(), notes: notes };
  }
  // Append new notes to the persistent draft paper (deduped, size-capped).
  function appendDraftNotes(notes) {
    if (!notes || !notes.length) return 0;
    var cur = state.meta.draftPaper || "";
    var added = 0;
    notes.forEach(function (n) {
      if (!n || cur.indexOf(n) >= 0) return;             // skip empty / already-saved
      cur += (cur ? "\n" : "") + "• " + n; added++;
    });
    if (cur.length > 6000) cur = cur.slice(cur.length - 6000);  // keep the most recent ~6k chars
    state.meta.draftPaper = cur; save();
    if (added) {
      updatePaperCount();
      if (el["paper-panel"] && el["paper-panel"].classList.contains("open")) el["paper-text"].value = cur;
      toast(added === 1 ? "Saved a note to the draft paper." : "Saved " + added + " notes to the draft paper.");
    }
    return added;
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

  var DOCK_KEY = "aids_dock_open";
  function openDock(prefill) {
    el["chat-dock"].classList.remove("hidden");
    el["chat-dock"].setAttribute("aria-hidden", "false");
    el["chat-fab"].classList.add("hidden");
    try { localStorage.setItem(DOCK_KEY, "1"); } catch (e) {}
    if (!aiCap) aiCap = AIChat.capability();

    if (!aiCap.ok) { renderUnavailable(); return; }

    inputEnabled(true);
    renderChatLog();                       // restore this session's saved conversation
    if (!el["chat-model"].options.length) populateModels();
    if (prefill) { el["chat-text"].value = prefill; sendChat(); }
    else if (!prefill && document.activeElement !== el["chat-text"]) setTimeout(function () { el["chat-text"].focus(); }, 60);
  }
  function closeDock() {
    el["chat-dock"].classList.add("hidden");
    el["chat-dock"].setAttribute("aria-hidden", "true");
    el["chat-fab"].classList.remove("hidden");
    try { localStorage.setItem(DOCK_KEY, "0"); } catch (e) {}
  }
  function dockWasOpen() { try { return localStorage.getItem(DOCK_KEY) === "1"; } catch (e) { return false; } }

  function currentQuestionForChat() {
    var s = activeSession(); if (!s) return null;
    return byId[s.queue[s.pos]];
  }

  // Full-app readability: a compact snapshot of everything the tutor should know about the app.
  function appStateContext() {
    var L = [];
    L.push("=== APP SNAPSHOT (so you understand where the student is) ===");
    L.push("App: an offline Discrete Mathematics MCQ trainer with spaced repetition and this tutor dock.");
    L.push("Subjects and their sections:");
    subjects.forEach(function (subj) {
      L.push("  - " + subj + ": " + (sectionsBySubject[subj] || []).map(function (t) { return t.replace(/^.*?—\s*/, ""); }).join("; "));
    });
    var s = activeSession();
    if (s) {
      L.push("Current booklet: \"" + s.name + "\" — on question " + (s.pos + 1) + " of " + s.queue.length + ".");
      var sc = computeScore(s);
      if (sc.total) L.push("Answered so far this booklet: " + sc.correct + "/" + sc.total + " correct.");
      if (s.wrong && s.wrong.length) L.push("Missed this booklet (redo pile): " + s.wrong.length + ".");
      var q = byId[s.queue[s.pos]];
      if (q) L.push("Current section: " + q.sectionTitle + (isTheoretical(q) ? " [marked theoretical -> extra spaced repetition]" : "") + ".");
    }
    var now = Date.now();
    L.push("Spaced-repetition status across all " + pool.length + " cards: " + dueList(now).length + " due, " + newList().length + " new.");
    return L.join("\n");
  }

  async function sendChat() {
    var text = el["chat-text"].value.trim();
    if (!text && !pendingImage) return;
    aiCap = AIChat.capability();
    if (!aiCap.ok) { renderUnavailable(); return; }

    var img = pendingImage;                 // capture + clear the attached image
    el["chat-text"].value = ""; autosize();
    clearPendingImage();
    var ub = addMsg("user", text || "(image)");
    if (img) { var im = document.createElement("img"); im.className = "msg-img"; im.src = img; ub.appendChild(im); }

    // Context order: system prompt, the persistent draft paper, a trimmed history, the CURRENT
    // question, then the user's new message — so the model sees the exact question last.
    var hist = sessionChat() || [];
    var prior = trimHistory(hist);
    var s = activeSession();
    var q = currentQuestionForChat();
    var ans = s ? s.answers[slotAt(s, s.pos)] : null;
    var order = (s && q && q.type !== "FIB") ? optionOrder(s, s.pos, q) : undefined;
    var ctx = q ? AIChat.questionContext(q, {
      answered: !!ans,
      correct: ans ? ans.correct : null,
      choice: ans && typeof ans.choice === "number" ? ans.choice : undefined,
      raw: ans ? ans.raw : undefined,
      order: order
    }) : "";
    var msgs = [{ role: "system", content: AIChat.SYSTEM_PROMPT }];
    msgs.push({ role: "system", content: appStateContext() });   // whole-app readability
    if (state.meta.draftPaper) msgs.push({ role: "system",
      content: "=== YOUR DRAFT PAPER (persistent notes-to-self, carried across every question and session) ===\n" + state.meta.draftPaper });
    msgs = msgs.concat(prior);
    if (ctx) msgs.push({ role: "system", content: ctx });
    // user turn — multimodal when an image is attached (needs a vision-capable free model)
    if (img) msgs.push({ role: "user", content: [ { type: "text", text: text || "Please look at this image." }, { type: "image_url", image_url: { url: img } } ] });
    else msgs.push({ role: "user", content: text });
    hist.push({ role: "user", content: text + (img ? "  [image attached]" : "") }); save();  // persist text only (no base64 bloat)

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
        // pull out any [[NOTE: ...]] the model wrote into the draft paper, show the cleaned reply
        var parsed = extractNotes(acc);
        var shown = parsed.shown || (acc ? "" : "_(no output — try another free model)_");
        bubble.innerHTML = md(shown);
        typeset(bubble);
        appendDraftNotes(parsed.notes);
        if (shown) { hist.push({ role: "assistant", content: shown }); save(); }   // persist the cleaned reply
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

  // Tighter context/memory control: keep only the last few turns, shorten long assistant
  // messages, and stay within an overall character budget so context does not balloon.
  function trimHistory(hist) {
    var recent = hist.slice(-6).map(function (m) {
      var c = m.content;
      if (m.role === "assistant" && c.length > 700) c = c.slice(0, 700) + " …";
      return { role: m.role, content: c };
    });
    var budget = 4000, out = [];
    for (var i = recent.length - 1; i >= 0; i--) {
      budget -= recent[i].content.length;
      if (budget < 0 && out.length) break;   // always keep at least the latest turn
      out.unshift(recent[i]);
    }
    return out;
  }

  // ---- draft paper (AI persistent notes) ----
  function updatePaperCount() {
    if (!el["paper-count"]) return;
    var lines = (state.meta.draftPaper || "").split("\n").filter(function (l) { return l.trim(); }).length;
    el["paper-count"].textContent = lines ? String(lines) : "";
    el["paper-count"].classList.toggle("hidden", lines === 0);
  }
  function openPaper() {
    if (!el["paper-panel"]) return;
    el["paper-text"].value = state.meta.draftPaper || "";
    openPanel(el["paper-panel"]);
  }
  function savePaper() {
    state.meta.draftPaper = el["paper-text"].value; save();
    updatePaperCount(); toast("Draft paper saved.");
  }
  function clearPaper() {
    state.meta.draftPaper = ""; if (el["paper-text"]) el["paper-text"].value = "";
    save(); updatePaperCount(); toast("Draft paper cleared.");
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
    initAI().then(refreshChatIfOpen);
    toast("Key saved.");
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
    var ans = s.answers[slotAt(s, s.pos)];
    var q = byId[s.queue[s.pos]];

    if (["1", "2", "3", "4"].indexOf(e.key) >= 0) {
      var n = parseInt(e.key, 10) - 1;   // display position pressed
      if (!ans && q.type !== "FIB") {
        var order = optionOrder(s, s.pos, q);   // map display position -> original option index
        if (order[n] != null) { e.preventDefault(); answerMCQ(q, s, order[n]); }
      }
      else if (ans) {   // answered -> keys 1-4 grade (or re-grade) recall
        e.preventDefault();
        grade(q, s, n + 1);
      }
    } else if (e.key === "ArrowRight") { if (!el["btn-next"].disabled) { s.pos++; save(); renderQuestion(); } }
    else if (e.key === "ArrowLeft") { if (s.pos > 0) { s.pos--; save(); renderQuestion(); } }
    else if (e.key.toLowerCase() === "t") { e.preventDefault(); openTheory(); }
    else if (e.key.toLowerCase() === "e") { e.preventDefault(); explainCurrent(); }
  }

  function explainCurrent() {
    var q = currentQuestionForChat(); if (!q) return;
    openDock("Explain this one simply, and what's the key idea to remember?");
  }

  // ---- wire events ----
  function wire() {
    el["btn-next"].addEventListener("click", function () { var s = activeSession(); if (s && s.pos < s.queue.length - 1) { s.pos++; save(); renderQuestion(); } });
    el["btn-prev"].addEventListener("click", function () { var s = activeSession(); if (s && s.pos > 0) { s.pos--; save(); renderQuestion(); } });
    el["btn-submit"].addEventListener("click", showScore);
    el["btn-retry"].addEventListener("click", function () { createSession("interleave", "MCQ", 15); });
    el["btn-weak"].addEventListener("click", function () { createSession("weak", "BOTH", 30); });
    el["btn-review-due"].addEventListener("click", function () { createSession("due", "BOTH", 40); });
    if (el["btn-redo-missed"]) el["btn-redo-missed"].addEventListener("click", function () {
      var s = activeSession(); if (s) createSessionFromIds(s.wrong, "Redo missed");
    });

    // draft paper (AI persistent notes)
    if (el["btn-paper"]) el["btn-paper"].addEventListener("click", openPaper);
    if (el["close-paper"]) el["close-paper"].addEventListener("click", function () { closePanel(el["paper-panel"]); });
    if (el["paper-save"]) el["paper-save"].addEventListener("click", savePaper);
    if (el["paper-clear"]) el["paper-clear"].addEventListener("click", clearPaper);

    // new-session modal
    el["btn-new-session"].addEventListener("click", openModal);
    el["close-modal"].addEventListener("click", closeModal);
    el["m-mode"].addEventListener("change", function () { el["topic-field"].hidden = el["m-mode"].value !== "topic"; });
    el["m-subject"].addEventListener("change", populateTopicSelect);
    el["btn-start"].addEventListener("click", function () {
      var mode = el["m-mode"].value, type = el["m-type"].value, count = parseInt(el["m-count"].value, 10) || 15,
          topic = el["m-topic"].value, subject = el["m-subject"].value;
      if (createSession(mode, type, count, topic, subject)) closeModal();
    });

    // slide-in panels
    el["close-theory"].addEventListener("click", function () { closePanel(el["theory-panel"]); });
    el["close-settings"].addEventListener("click", function () { closePanel(el["settings-panel"]); });
    el["btn-progress"].addEventListener("click", openSettings);
    el["scrim"].addEventListener("click", function () { document.querySelectorAll(".panel.open").forEach(closePanel); document.body.classList.remove("margin-open"); el["scrim"].hidden = true; });

    // floating chat dock
    el["chat-fab"].addEventListener("click", function () { openDock(); });
    el["close-chat"].addEventListener("click", closeDock);
    el["chat-explain"].addEventListener("click", explainCurrent);
    el["chat-send"].addEventListener("click", sendChat);
    el["chat-stop"].addEventListener("click", function () { if (chatAbort) chatAbort.abort(); });
    el["chat-text"].addEventListener("input", autosize);
    el["chat-text"].addEventListener("keydown", function (e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); } });
    if (el["chat-attach"]) el["chat-attach"].addEventListener("click", function () { el["chat-image"].click(); });
    if (el["chat-image"]) el["chat-image"].addEventListener("change", function (e) { if (e.target.files && e.target.files[0]) pickImage(e.target.files[0]); });
    el["chat-model"].addEventListener("change", function () { var c = AIChat.loadCfg(); c.model = el["chat-model"].value; AIChat.saveCfg(c); toast("Model: " + el["chat-model"].value); });
    el["btn-chat-cfg"].addEventListener("click", openSettings);
    el["set-refresh"].addEventListener("click", refreshModels);
    el["set-save"].addEventListener("click", saveKey);

    // margin + theme
    el["btn-collapse"].addEventListener("click", function () { document.body.classList.add("margin-collapsed"); });
    el["btn-open-margin"].addEventListener("click", function () { document.body.classList.remove("margin-collapsed"); document.body.classList.add("margin-open"); });
    el["btn-theme"].addEventListener("click", function () { applyTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark"); });

    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", function () { renderForecast(Date.now()); });
  }

  // topic <select> shows only sections belonging to the chosen subject ("" = all subjects)
  function populateTopicSelect() {
    var subj = el["m-subject"].value;
    var list = subj ? (sectionsBySubject[subj] || []) : sections;
    el["m-topic"].innerHTML = list.map(function (t) { return '<option value="' + esc(t) + '">' + esc(t) + "</option>"; }).join("");
  }
  function openModal() {
    // subject list: "All subjects" + each subject
    el["m-subject"].innerHTML = '<option value="">All subjects</option>' +
      subjects.map(function (s) { return '<option value="' + esc(s) + '">' + esc(s) + "</option>"; }).join("");
    populateTopicSelect();
    el["topic-field"].hidden = el["m-mode"].value !== "topic";
    el["new-modal"].classList.remove("hidden");
  }
  function closeModal() { el["new-modal"].classList.add("hidden"); }

  // ---- boot ----
  function init() {
    if (!buildPool()) return;
    load();
    initTheme();
    wire();
    renderSidebar();
    renderDashboard();

    if (state.sessions.length && state.activeSessionId) switchSession(state.activeSessionId);
    else createSession("interleave", "MCQ", 15);

    updatePaperCount();
    initAI(); // async, updates the AI status dot

    // restore the tutor dock if it was left open (persistent across reloads)
    if (dockWasOpen()) openDock();

    // gentle intro for the margin only. The chat bubble is NOT animated from
    // scale 0 — a stalled tween would leave it invisible; it shows via CSS.
    if (fx.enabled) {
      G.from(".margin-head, .actions, .sessions-rule, #session-list", { opacity: 0, x: -14, duration: 0.4, stagger: 0.06, ease: "power2.out" });
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
