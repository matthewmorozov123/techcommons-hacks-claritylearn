# ClarityLearn

Upload a photo of a textbook or worksheet page, or paste text, and ClarityLearn rewrites it at the reading level you choose — with optional translation, read-aloud, and a quick self-quiz.

Built by Matthew Morozov for TechCommons.

**Live app:** https://claritylearn.vercel.app

## What it does

- **Upload or paste** — take a photo of a page (multiple pages are combined into one passage) or paste text directly.
- **Rewrite at a reading level** — Elementary, Middle school, Plain English (for English language learners), or Summary.
- **Translate** — optionally translate the result into Spanish, French, Chinese, Arabic, Vietnamese, or Tagalog. The source language is auto-detected from photos, and the "no translation" option always names the language the result will actually be kept in.
- **Read aloud** — text-to-speech with selectable voices and speed, streamed in chunks so long passages start playing almost immediately instead of waiting for the whole thing to generate.
- **Self-quiz** — three multiple-choice comprehension questions generated from the rewritten passage, with a "try again" option for a fresh set.
- **History** — past rewrites are saved locally in the browser, organized into optional projects/folders.
- **Dark mode** — toggle in the header, remembers your preference.

## How it works

The frontend is plain HTML/CSS/JavaScript — no framework, no build step. The backend is four Vercel serverless functions that call the OpenAI API:

| Endpoint | Purpose |
|---|---|
| `api/transcribe.js` | Reads photo(s) of a page, transcribes the text, and detects its language |
| `api/rewrite.js` | Rewrites, summarizes, and/or translates the transcribed (or pasted) text |
| `api/quiz.js` | Generates a 3-question comprehension quiz from the result |
| `api/tts.js` | Converts a chunk of text to speech |

Uploading a photo only calls the vision model once (in `transcribe.js`); every later action — changing the reading level, re-translating, regenerating the quiz — reuses that transcription and only calls the (cheaper, faster) text model.

## Running locally

You'll need an [OpenAI API key](https://platform.openai.com/api-keys) and the [Vercel CLI](https://vercel.com/docs/cli) (the app relies on Vercel's `api/` routing convention, so a plain static server won't serve the backend).

```bash
npm install -g vercel
vercel dev
```

Create a `.env` file in the project root with:

```
OPENAI_API_KEY=your-key-here
```

Then open the local URL `vercel dev` prints (typically `http://localhost:3000`).

## Project structure

```
index.html       Markup
style.css        Styles, including the dark theme
app.js           All client-side logic
api/
  transcribe.js  Photo → transcription + detected language
  rewrite.js     Text → rewritten/summarized/translated result
  quiz.js        Text → comprehension quiz
  tts.js         Text → speech audio
```
