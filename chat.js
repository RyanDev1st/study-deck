/*
 * chat.js - AI Explainer backed by OpenRouter (free models only).
 * OpenAI-compatible streaming chat. Model list is fetched live and filtered to
 * free models so the picker always reflects what's currently available.
 *
 * NOTE: the API key below is a default for convenience in this local, offline
 * study app. It lives in plaintext here and in localStorage. If you share this
 * folder, remove the key first.
 */
(function (global) {
  "use strict";

  var LS_KEY = "aids_chat_cfg_v2";
  // No key is shipped. Bring your own free OpenRouter key via the in-app Settings panel
  // (openrouter.ai/keys). It is stored only in this browser's localStorage.
  var DEFAULT_KEY = "";
  var DEFAULT_CFG = {
    baseUrl: "https://openrouter.ai/api/v1",
    key: DEFAULT_KEY,
    model: "google/gemma-4-31b-it:free",
    temperature: 0.4
  };

  // curated preference order for the picker (higher = shown first)
  var PREFER = ["gemma", "llama-3.3", "qwen3", "gpt-oss", "hermes", "nemotron-3-nano", "llama-3.2", "mistral"];

  function loadCfg() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      var c = raw ? Object.assign({}, DEFAULT_CFG, JSON.parse(raw)) : Object.assign({}, DEFAULT_CFG);
      if (!c.key) c.key = DEFAULT_KEY;
      return c;
    } catch (_) { return Object.assign({}, DEFAULT_CFG); }
  }
  function saveCfg(cfg) { try { localStorage.setItem(LS_KEY, JSON.stringify(cfg)); } catch (_) {} }

  // Kept deliberately light: it sets the tone, the context, and a few of the student's learning
  // preferences, then gets out of the way so the model can tutor however works best.
  var SYSTEM_PROMPT =
    "You are the study tutor built into a Discrete Mathematics flashcard app (counting / combinatorics, " +
    "generating functions, recurrences, inclusion-exclusion, graphs, trees). Be a genuinely good tutor in " +
    "whatever way works best — the points below only set the tone and a few of the student's learning " +
    "preferences; beyond them, use your own judgement.\n\n" +
    "Each turn you are given a snapshot of the whole app (current subject and section, the student's progress, " +
    "and the exact question on screen with its options, which one is correct, and whether they have answered), " +
    "any image they attach, and your own draft paper. Trust this context; never claim you cannot see the question " +
    "or the app.\n\n" +
    "The student's learning preferences — please honour these:\n" +
    "- Show your work. When you do any counting or generating-function problem, show EVERY step from the " +
    "defining equation to the closed form. Never skip algebra or say it is obvious; gaps confuse them.\n" +
    "- Write all mathematics in LaTeX so it renders: inline $ ... $ and display $$ ... $$ " +
    "(e.g. $\\binom{n}{k} = \\frac{n!}{k!(n-k)!}$). Avoid plain-ASCII math.\n" +
    "- Answer gate: if the student has NOT answered the on-screen question yet, do not reveal or hint which " +
    "option is correct — help them reason it out, and reveal the answer only if they explicitly ask. Once they " +
    "have answered, explain freely.\n" +
    "- When the student has answered and was wrong, explicitly address the option they chose: why it is " +
    "tempting but wrong, then why the correct option is right.\n" +
    "- Draft paper: you have a persistent notepad (its contents are shown to you each turn). To remember " +
    "something durable — a recurring mistake, a preference, a running summary — write a line of the exact form " +
    "[[NOTE: your terse note]] anywhere in your reply; the app files it into the draft paper and hides it from " +
    "the chat. Save sparingly and do not repeat a note you already made.\n\n" +
    "Keep replies focused, use light markdown, and be accurate.";

  /*
   * questionContext(q, opts) - builds the full context the model always receives:
   * the question, every labelled option WITH its explanation, the correct option, and a
   * prominent ANSWER GATE. Whether the model may reveal the answer is governed by the gate
   * + the system prompt, not by hiding data (so it is never clueless about the options).
   */
  function questionContext(q, opts) {
    if (!q) return "No question is currently on the student's screen.";
    opts = opts || {};
    var answered = !!opts.answered;
    var L = [];
    L.push("=== QUESTION CURRENTLY ON THE STUDENT'S SCREEN ===");
    L.push(q.questionText || "");
    var chose = (typeof opts.choice === "number") ? opts.choice : -1;   // MCQ chosen index
    if (q.type === "FIB") {
      L.push("\nType: fill-in-the-blank.");
      L.push("Correct answer: " + (q.correctAnswer || ""));
      if (answered && opts.raw != null) {
        var correctness = (opts.correct === true) ? " (correct)" : (opts.correct === false) ? " (incorrect)" : "";
        L.push("The student typed: " + JSON.stringify(String(opts.raw)) + correctness);
      }
      if (q.explanation) L.push("Explanation: " + q.explanation);
    } else if (Array.isArray(q.answerOptions)) {
      L.push("\nOptions (labelled exactly as the student sees them on screen):");
      // Options are SHUFFLED per question; opts.order maps display position -> original index,
      // so the letters here match what the student sees (the correct one is NOT always A).
      var order = Array.isArray(opts.order) && opts.order.length === q.answerOptions.length
        ? opts.order : q.answerOptions.map(function (_, i) { return i; });
      order.forEach(function (origIdx, dispPos) {
        var o = q.answerOptions[origIdx];
        var correct = (o.isCorrect === "true" || o.isCorrect === true);
        var tags = "";
        if (correct) tags += "   [THIS IS THE CORRECT OPTION]";
        if (answered && origIdx === chose) tags += "   [THE STUDENT CHOSE THIS]";
        L.push(String.fromCharCode(65 + dispPos) + ". " + o.answerText + tags);
        if (o.explanation) L.push("     why: " + o.explanation);
      });
    }
    if (q.sectionTitle) L.push("\nTopic: " + q.sectionTitle);
    L.push("\n=== ANSWER GATE ===");
    if (answered) {
      // map the chosen ORIGINAL index to the DISPLAY letter the student actually saw
      var dispChoose = chose;
      if (chose >= 0 && Array.isArray(opts.order) && opts.order.indexOf(chose) >= 0) dispChoose = opts.order.indexOf(chose);
      var pickLabel = (chose >= 0) ? " and picked option " + String.fromCharCode(65 + dispChoose) : "";
      L.push("The student HAS ANSWERED" + pickLabel + (opts.correct != null ? " (" + (opts.correct ? "correct" : "incorrect") + ")" : "") +
        ". You may explain freely. Answer their latest message; reference their pick only when it is relevant, not as a fixed opener.");
    } else {
      L.push("The student has NOT ANSWERED yet. Do NOT reveal or hint which option is correct and do " +
        "NOT recite the explanations above. Use them only to guide the student's reasoning. Reveal the " +
        "answer only if they explicitly ask for it.");
    }
    return L.join("\n");
  }

  function headers(cfg) {
    return {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + cfg.key,
      "X-Title": "Discrete Math Study Deck"
    };
  }

  // availability failsafe: needs a key AND a network connection (cloud service).
  function capability() {
    var cfg = loadCfg();
    var online = (typeof navigator === "undefined") ? true : navigator.onLine !== false;
    if (!cfg.key) return { ok: false, reason: "No OpenRouter API key set. Open settings to add one." };
    if (!online) return { ok: false, reason: "You appear to be offline. The AI explainer needs an internet connection (OpenRouter)." };
    return { ok: true, reason: "" };
  }

  // fetch + filter the current free models
  var _modelsCache = null;
  async function listFreeModels(force) {
    if (_modelsCache && !force) return _modelsCache;
    var cfg = loadCfg();
    var r = await fetch(cfg.baseUrl + "/models", { headers: { "Authorization": "Bearer " + cfg.key } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    var j = await r.json();
    var all = j.data || [];
    var free = all.filter(function (m) {
      var id = m.id || "";
      var p = m.pricing || {};
      var freeId = /:free$/.test(id);
      var zero = parseFloat(p.prompt || "0") === 0 && parseFloat(p.completion || "0") === 0;
      // keep chat-capable text models; drop audio/safety-only endpoints
      if (/lyria|content-safety|whisper|tts/i.test(id)) return false;
      return freeId || zero;
    }).map(function (m) {
      return { id: m.id, name: (m.name || m.id).replace(/\s*\(free\)\s*$/i, ""), ctx: m.context_length || 0 };
    });
    // rank: preferred families first, then by context length
    function rank(id) { for (var i = 0; i < PREFER.length; i++) if (id.indexOf(PREFER[i]) >= 0) return i; return PREFER.length; }
    free.sort(function (a, b) { var ra = rank(a.id), rb = rank(b.id); return ra !== rb ? ra - rb : b.ctx - a.ctx; });
    _modelsCache = free;
    return free;
  }

  async function health() {
    try { var m = await listFreeModels(true); return { ok: true, count: m.length }; }
    catch (e) { return { ok: false, error: e.message }; }
  }

  /*
   * stream(messages, {onToken,onDone,onError,signal})
   * OpenRouter is OpenAI-compatible SSE: lines "data: {json}" ... "data: [DONE]".
   */
  async function stream(messages, handlers) {
    var cfg = loadCfg();
    handlers = handlers || {};
    var onToken = handlers.onToken || function () {};
    var resp;
    try {
      resp = await fetch(cfg.baseUrl + "/chat/completions", {
        method: "POST",
        headers: headers(cfg),
        body: JSON.stringify({ model: cfg.model, messages: messages, stream: true, temperature: cfg.temperature }),
        signal: handlers.signal
      });
    } catch (e) {
      if (handlers.onError) handlers.onError("Network error reaching OpenRouter: " + (e.message || e));
      return;
    }
    if (!resp.ok) {
      var txt = await resp.text().catch(function () { return ""; });
      var msg = "OpenRouter returned HTTP " + resp.status + ".";
      if (resp.status === 401) msg += " The API key was rejected — check settings.";
      else if (resp.status === 402) msg += " This model needs credits; pick a free model.";
      else if (resp.status === 429) msg += " Rate limited on free tier — wait a moment or switch model.";
      if (txt) { try { var jt = JSON.parse(txt); if (jt.error && jt.error.message) msg += "\n" + jt.error.message; } catch (_) {} }
      if (handlers.onError) handlers.onError(msg);
      return;
    }
    var reader = resp.body.getReader();
    var decoder = new TextDecoder();
    var buf = "";
    try {
      while (true) {
        var chunk = await reader.read();
        if (chunk.done) break;
        buf += decoder.decode(chunk.value, { stream: true });
        var idx;
        while ((idx = buf.indexOf("\n")) >= 0) {
          var line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!line || line.startsWith(":")) continue; // ignore SSE comments/keepalive
          if (line.startsWith("data:")) line = line.slice(5).trim();
          if (line === "[DONE]") continue;
          try {
            var j = JSON.parse(line);
            var d = j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content;
            if (d) onToken(d);
          } catch (_) {}
        }
      }
      if (handlers.onDone) handlers.onDone();
    } catch (e) {
      if (e.name === "AbortError") { if (handlers.onDone) handlers.onDone(true); return; }
      if (handlers.onError) handlers.onError("Stream error: " + (e.message || e));
    }
  }

  global.AIChat = {
    loadCfg: loadCfg, saveCfg: saveCfg, capability: capability, health: health,
    listFreeModels: listFreeModels, stream: stream,
    questionContext: questionContext, SYSTEM_PROMPT: SYSTEM_PROMPT, DEFAULT_CFG: DEFAULT_CFG
  };
})(window);
