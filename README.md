# Study Deck

An offline, single-file-simple **spaced-repetition MCQ trainer**. Load any question bank, drill it with the FSRS-5 scheduler, and (optionally) ask a built-in AI tutor to explain a question. No build step, no backend — just static files.

- **FSRS-5** scheduling (the modern successor to SM-2): grade each card Again / Hard / Good / Easy, get due dates back.
- **Bring-your-own question bank** — import/export as JSON. A sample ships in `banks/`.
- **Optional AI tutor** — streams from free models on OpenRouter using *your* key. Never reveals the answer before you do.
- Works fully offline (except web fonts and the tutor). Light + dark themes.

## Run

The app makes same-origin requests (icons, the sample bank), so run it over a local server rather than opening the file directly.

**Windows:** double-click `serve.cmd` → opens `http://localhost:8000`.

**Any OS:**
```bash
python -m http.server 8000
# or:  npx http-server -p 8000
```
Then open `http://localhost:8000`.

## Question banks

The active bank lives in your browser. In **Settings** (chart icon, bottom-left) you can **Import** a `.json` bank, **Export** the current one, or **Reset** to the sample.

A bank is one JSON file:

```json
{
  "title": "My Deck",
  "quizzes": [
    {
      "id": 1,
      "title": "Topic name",
      "quiz": [
        {
          "questionText": "Which is true?",
          "answerOptions": [
            { "answerText": "Right one",  "isCorrect": "true",  "explanation": "why it is right" },
            { "answerText": "Wrong one",  "isCorrect": "false", "explanation": "why it is wrong" }
          ]
        },
        { "type": "FIB", "questionText": "Fill the ____.", "correctAnswer": "blank", "explanation": "note" }
      ]
    }
  ],
  "theory": {
    "Topic name": "<h3>Reference</h3><p>Shown by the Unclear? button for this topic.</p>"
  }
}
```

Rules:
- `isCorrect` is the **string** `"true"` / `"false"`.
- Exactly **one** correct option per multiple-choice question; 2–4 options.
- Every option needs its own `explanation` (shown after answering).
- `type: "FIB"` items are fill-in-the-blank (`correctAnswer` instead of options). Optional.
- `theory` is optional; keys must match a section `title` exactly. Shown by the **Unclear?** button.

See `banks/sample.json` for a working example.

## AI tutor (optional)

1. Get a free key at [openrouter.ai/keys](https://openrouter.ai/keys).
2. **Settings → AI tutor →** paste the key → **Save key** → **Load models**.
3. Open the tutor (nib button, bottom-right, or press **E**) and pick a free model.

The key is stored only in your browser (`localStorage`). Free models are rate-limited; switch models if you hit HTTP 429. Without a key the tutor stays disabled — everything else works.

## Keyboard

`1`–`4` answer / grade · `E` tutor · `T` topic reference · `←` / `→` navigate.

## Files

| File | Role |
| --- | --- |
| `index.html` | Page shell |
| `app.js` | Engine: sessions, scheduling, dashboard, bank import/export |
| `fsrs.js` | FSRS-5 scheduler |
| `chat.js` | OpenRouter tutor client |
| `style.css` | Styles (both themes) |
| `gsap.min.js` | Vendored GSAP (animations) |
| `banks/sample.json` | Example question bank + format reference |

## License

MIT — see [LICENSE](LICENSE).
