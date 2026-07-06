/*
 * chat.js - AI tutor backed by OpenRouter (free models only).
 * OpenAI-compatible streaming chat. The model list is fetched live and filtered
 * to free models so the picker always reflects what is currently available.
 *
 * Bring your own key: get a free key at https://openrouter.ai/keys and paste it
 * into Settings. It is stored only in your browser (localStorage), never in this file.
 */
(function (global) {
  "use strict";

  var LS_KEY = "sd_chat_cfg_v1";
  var DEFAULT_KEY = ""; // ship empty — users add their own key in Settings
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

  var SYSTEM_PROMPT =
    "You are a warm, focused study tutor built into a flashcard app for an 'Introduction to Data " +
    "Science & AI' course (NumPy, Pandas, machine learning, neural networks, training, RNNs, PyTorch).\n\n" +
    "You are ALWAYS given the exact question currently on the student's screen, with every option " +
    "labelled A, B, C, D exactly as they see it, each option's explanation, which option is correct, " +
    "and an ANSWER GATE telling you whether they have answered yet.\n\n" +
    "Rules:\n" +
    "1. You always have the current question. NEVER say you don't know the question or what an option " +
    "is. If the student says 'why not B', option B is the one labelled B in the context below.\n" +
    "2. Respond to what the student actually says. A greeting gets a short greeting and an offer to " +
    "help, not an explanation. Do not dump an answer unprompted.\n" +
    "3. ANSWER GATE = NOT ANSWERED: do not reveal or hint which option is correct, and do not recite " +
    "the explanations. Help them reason toward it with questions and concept clarification. Only reveal " +
    "the answer if they explicitly ask for it.\n" +
    "4. ANSWER GATE = ANSWERED: explain fully. Why the correct option is right, why the tempting wrong " +
    "one is wrong.\n" +
    "5. Keep replies short (2 to 4 sentences), plain language, a tiny example only if it helps. Use light markdown.";

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
    if (q.type === "FIB") {
      L.push("\nType: fill-in-the-blank.");
      L.push("Correct answer: " + (q.correctAnswer || ""));
      if (q.explanation) L.push("Explanation: " + q.explanation);
    } else if (Array.isArray(q.answerOptions)) {
      L.push("\nOptions (labelled exactly as the student sees them):");
      q.answerOptions.forEach(function (o, i) {
        var correct = (o.isCorrect === "true" || o.isCorrect === true);
        L.push(String.fromCharCode(65 + i) + ". " + o.answerText + (correct ? "   [THIS IS THE CORRECT OPTION]" : ""));
        if (o.explanation) L.push("     why: " + o.explanation);
      });
    }
    if (q.sectionTitle) L.push("\nTopic: " + q.sectionTitle);
    L.push("\n=== ANSWER GATE ===");
    if (answered) {
      L.push("The student HAS ANSWERED" + (opts.correct != null ? " (they got it " + (opts.correct ? "RIGHT" : "WRONG") + ")" : "") +
        ". You may discuss the correct option and all explanations freely.");
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
      "X-Title": "Intro DS AI Study Deck"
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
