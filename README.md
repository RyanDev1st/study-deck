# Exam Booklet — an offline spaced-repetition MCQ trainer

A self-contained, offline study web app: a multiple-choice quiz "booklet" with a real
spaced-repetition scheduler, an answer-gated AI tutor, and full step-by-step solutions.
No build step, no framework — open `index.html` (served over http) and study.

Originally built for a Discrete Mathematics exam; the **engine is subject-agnostic** — point it
at any question bank in the same data format. This repo ships the **engine plus a small sample
bank**; the full question set is kept private.

## Features

- **FSRS-5 spaced repetition** (`fsrs.js`) — grades Again / Hard / Good / Easy, with a due queue,
  leech flagging, weak-topic drilling, and a per-topic mastery dashboard.
- **In-session learning steps (Anki-style)** — a card you grade *Again* (or *Hard*, for cards
  marked theoretical) is re-inserted a short gap ahead so it recurs *soon*, not at the end of the
  set. Re-grading it up removes the pending copy.
- **Shuffled questions and options** — the correct answer is never fixed to "A"; option order is a
  stable per-card permutation.
- **Subjects & modes** — pick a Subject, then Interleaved / Due / New / Weak / Single-topic.
- **Grades persist** — revisit an answered card and your grade is still shown (and changeable),
  with no double-counting of the schedule.
- **Wrong-log + "Redo missed"** — every card you miss is collected into a one-tap redo booklet.
- **Answer-gated AI tutor** (`chat.js`, OpenRouter free models) — before you answer it won't reveal
  the correct option; after, it explains fully. Renders LaTeX (offline MathJax), reads the whole
  app state for context, keeps a persistent "draft paper" of notes-to-self, and accepts image input.
- **Fully offline** except the optional AI tutor and web fonts. Data persists in `localStorage`.

## Run it

```sh
# 1) provide a question bank (copy the samples, or drop in your own)
cp data.sample.js   data.js
cp theory.sample.js theory.js

# 2) serve over http (file:// triggers strict-origin errors for SVG <use> / fonts)
python -m http.server 8000
#   ...or double-click serve.cmd on Windows
```

Open <http://localhost:8000>. To enable the AI tutor, paste a free
[OpenRouter](https://openrouter.ai/keys) API key into the in-app Settings panel (stored only in
your browser). No key ships with this repo.

## Data format

`data.js` defines a global `quizData`. Each **top-level entry is a Subject**; its `quizzes[]` are
sections; each section `title` also keys a reference sheet in `theory.js`.

```js
const quizData = [{
  title: "Basic Counting",          // Subject (appears in the New-booklet picker)
  complete: "...", error: "...",
  quizzes: [{
    id: 1,
    title: "Basic Counting — Sum, Product & Subset Rules",   // section; also the theory key
    quiz: [{
      questionText: "How many subsets does a set with n elements have?",
      answerOptions: [
        { answerText: "2^n", isCorrect: "true",  explanation: "Full worked solution…" },
        { answerText: "n^2", isCorrect: "false", explanation: "Why this is wrong…" }
      ]
    }]
  }]
}];
```

- `isCorrect` is the **string** `"true"`/`"false"`. Exactly one correct option per question.
- Every option carries its own `explanation`; the correct one holds the full step-by-step solution.
- Fill-in-the-blank item: `{ type: "FIB", questionText, correctAnswer, explanation }`.
- `theory.js`: `theoryData["<exact section title>"] = \`<html reference sheet>\``.

See `data.sample.js` / `theory.sample.js` for a complete working example.

## Files

| File | Role |
| --- | --- |
| `index.html` | Page shell + slide-in panels + tutor dock |
| `app.js` | Engine: sessions, rendering, scoring, SRS, keyboard, tutor wiring |
| `fsrs.js` | FSRS-5 spaced-repetition scheduler (`window.FSRS`) |
| `chat.js` | `window.AIChat` — OpenRouter streaming tutor (answer-gated) |
| `style.css` | Design system ("exam booklet", light + dark) |
| `gsap.min.js` | Vendored GSAP 3.12 (motion, offline) |
| `tex-svg.js` | Vendored MathJax 3.2 (LaTeX → SVG, offline) |
| `data.sample.js` / `theory.sample.js` | Example bank + reference sheets |
| `serve.cmd` | Windows launcher (serves on :8000) |

## License

MIT — see `LICENSE`.
