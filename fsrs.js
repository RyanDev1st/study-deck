/*
 * fsrs.js - FSRS-5 (Free Spaced Repetition Scheduler) in dependency-free vanilla JS.
 * Replaces the old SM-2 (supermemo.js). Runs offline as a classic <script>.
 *
 * Model per card: { due, stability, difficulty, elapsed_days, scheduled_days,
 *                   reps, lapses, state, last_review }
 * States: 0 New, 1 Learning, 2 Review, 3 Relearning
 * Grades: 1 Again, 2 Hard, 3 Good, 4 Easy
 *
 * Reference: open-spaced-repetition/fsrs (FSRS-5). Formulas implemented directly.
 */
(function (global) {
  "use strict";

  // FSRS-5 default parameters (w0..w18).
  const DEFAULT_W = [
    0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046,
    1.54575, 0.1192, 1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315,
    2.9898, 0.51655, 0.6621
  ];

  const DECAY = -0.5;
  const FACTOR = Math.pow(0.9, 1 / DECAY) - 1; // = 19/81 ~ 0.234568
  const DAY = 24 * 60 * 60 * 1000;

  const STATE = { NEW: 0, LEARNING: 1, REVIEW: 2, RELEARNING: 3 };
  const GRADE = { AGAIN: 1, HARD: 2, GOOD: 3, EASY: 4 };

  const clampD = (d) => Math.min(Math.max(d, 1), 10);

  function FSRS(opts) {
    opts = opts || {};
    this.w = opts.w || DEFAULT_W.slice();
    // Desired retention: probability of recall we schedule for. Higher = more reviews, better retention.
    this.requestRetention = opts.requestRetention != null ? opts.requestRetention : 0.9;
    this.maximumInterval = opts.maximumInterval || 365;
    // Short relearn/learn step (minutes) used before a card graduates to day-scale intervals.
    this.learnStepMin = opts.learnStepMin || 10;
  }

  FSRS.prototype.createCard = function (now) {
    now = now || Date.now();
    return {
      due: now,
      stability: 0,
      difficulty: 0,
      elapsed_days: 0,
      scheduled_days: 0,
      reps: 0,
      lapses: 0,
      state: STATE.NEW,
      last_review: null
    };
  };

  // R(t) = (1 + FACTOR * t / S)^DECAY  -- probability of recall after t days.
  FSRS.prototype.retrievability = function (card, now) {
    if (card.state === STATE.NEW || !card.stability || !card.last_review) return 0;
    now = now || Date.now();
    const t = Math.max(0, (now - card.last_review) / DAY);
    return Math.pow(1 + FACTOR * t / card.stability, DECAY);
  };

  // Interval (days) that yields requestRetention given stability S.
  FSRS.prototype.intervalFromStability = function (S) {
    const ivl = (S / FACTOR) * (Math.pow(this.requestRetention, 1 / DECAY) - 1);
    return Math.min(Math.max(Math.round(ivl), 1), this.maximumInterval);
  };

  FSRS.prototype._initDifficulty = function (g) {
    return clampD(this.w[4] - Math.exp(this.w[5] * (g - 1)) + 1);
  };
  FSRS.prototype._initStability = function (g) {
    return Math.max(this.w[g - 1], 0.1);
  };
  FSRS.prototype._nextDifficulty = function (D, g) {
    const damped = -this.w[6] * (g - 3) * (10 - D) / 9;      // linear damping (FSRS-5)
    const Dp = D + damped;
    const target = this._initDifficulty(GRADE.EASY);          // mean-reversion target
    return clampD(this.w[7] * target + (1 - this.w[7]) * Dp);
  };
  FSRS.prototype._recallStability = function (D, S, R, g) {
    const hard = g === GRADE.HARD ? this.w[15] : 1;
    const easy = g === GRADE.EASY ? this.w[16] : 1;
    const inc = Math.exp(this.w[8]) * (11 - D) * Math.pow(S, -this.w[9]) *
      (Math.exp(this.w[10] * (1 - R)) - 1) * hard * easy;
    return S * (1 + inc);
  };
  FSRS.prototype._forgetStability = function (D, S, R) {
    const sf = this.w[11] * Math.pow(D, -this.w[12]) *
      (Math.pow(S + 1, this.w[13]) - 1) * Math.exp(this.w[14] * (1 - R));
    return Math.min(sf, S); // a lapse never increases stability
  };

  /*
   * schedule(card, grade, now) -> new card object (does not mutate input).
   * Handles New -> Review/Relearning and subsequent Review/Relearning transitions.
   */
  FSRS.prototype.schedule = function (card, grade, now) {
    now = now || Date.now();
    const c = Object.assign({}, card);
    const elapsed = c.last_review ? Math.max(0, (now - c.last_review) / DAY) : 0;
    c.elapsed_days = elapsed;
    c.reps += 1;
    c.last_review = now;

    if (card.state === STATE.NEW) {
      c.difficulty = this._initDifficulty(grade);
      c.stability = this._initStability(grade);
      if (grade === GRADE.AGAIN) {
        c.state = STATE.LEARNING;
        c.scheduled_days = 0;
        c.due = now + this.learnStepMin * 60 * 1000;
      } else {
        c.state = STATE.REVIEW;
        const ivl = grade === GRADE.EASY
          ? this.intervalFromStability(c.stability)
          : this.intervalFromStability(c.stability);
        c.scheduled_days = ivl;
        c.due = now + ivl * DAY;
      }
      return c;
    }

    // Existing card (Learning / Review / Relearning)
    const R = this.retrievability(card, now);
    c.difficulty = this._nextDifficulty(card.difficulty || this._initDifficulty(grade), grade);

    if (grade === GRADE.AGAIN) {
      c.lapses += 1;
      c.stability = this._forgetStability(c.difficulty, card.stability || 1, R);
      c.state = STATE.RELEARNING;
      c.scheduled_days = 0;
      c.due = now + this.learnStepMin * 60 * 1000; // short relearn step
    } else {
      c.stability = this._recallStability(c.difficulty, card.stability || this._initStability(grade), R, grade);
      c.state = STATE.REVIEW;
      const ivl = this.intervalFromStability(c.stability);
      c.scheduled_days = ivl;
      c.due = now + ivl * DAY;
    }
    return c;
  };

  // Preview all four outcomes (for showing "next: 3d / 6d ..." hints on the buttons).
  FSRS.prototype.preview = function (card, now) {
    now = now || Date.now();
    const out = {};
    [GRADE.AGAIN, GRADE.HARD, GRADE.GOOD, GRADE.EASY].forEach((g) => {
      out[g] = this.schedule(card, g, now);
    });
    return out;
  };

  // Human-readable interval until due (from now).
  FSRS.humanInterval = function (card, now) {
    now = now || Date.now();
    const ms = card.due - now;
    if (ms <= 0) return "now";
    const min = ms / 60000;
    if (min < 60) return Math.max(1, Math.round(min)) + "m";
    const hr = min / 60;
    if (hr < 24) return Math.round(hr) + "h";
    const d = hr / 24;
    if (d < 30) return Math.round(d) + "d";
    const mo = d / 30;
    if (mo < 12) return Math.round(mo) + "mo";
    return (d / 365).toFixed(1) + "y";
  };

  FSRS.STATE = STATE;
  FSRS.GRADE = GRADE;
  FSRS.DECAY = DECAY;
  FSRS.FACTOR = FACTOR;
  FSRS.stateName = function (s) {
    return ["New", "Learning", "Review", "Relearning"][s] || "New";
  };

  global.FSRS = FSRS;
})(window);
