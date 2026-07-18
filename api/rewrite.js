const OPENAI_MODEL = "gpt-5.4-mini";
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

// Step two of the analysis flow: takes text that /api/transcribe (for photos)
// or the paste box (for typed input) already produced, and rewrites,
// summarizes and/or translates it. Text-only by design — images never reach
// this endpoint, so the page is only ever sent to the vision model once.

const READING_LEVELS = {
  elementary:
    "an elementary school (roughly 3rd-5th grade) reading level — short sentences, common everyday words, no jargon",
  "middle-school":
    "a middle school (roughly 6th-8th grade) reading level — clear vocabulary, moderate sentence length",
  "plain-english":
    "plain English for English language learners at an intermediate (CEFR B1-ish) level — clear, simple vocabulary and moderately short sentences, no idioms or slang, but natural enough not to sound like a beginner primer",
};

// Not a reading level — a different job entirely, so it branches the prompt.
const SUMMARY_MODE = "summary";

const STRUCTURE_INSTRUCTION =
  "Preserve the original structure (bullet points, numbered lists, headings, question numbers) when it helps readability or matches the content type, such as worksheet questions or lists. Otherwise, use plain prose paragraphs.";

const LANGUAGE_NAMES = {
  en: "English",
  es: "Spanish",
  fr: "French",
  zh: "Chinese (Simplified)",
  ar: "Arabic",
  vi: "Vietnamese",
  tl: "Tagalog",
};

function isValidMode(mode) {
  return mode === SUMMARY_MODE || Boolean(READING_LEVELS[mode]);
}

// The detected source language is a free-text name produced by the vision model
// reading a user-supplied image, and it gets interpolated into this prompt — so
// it's only trusted if it looks like a plain language name. Anything else is
// dropped in favour of the generic "same language as the source" wording.
const SAFE_LANGUAGE_NAME = /^[A-Za-zÀ-ɏ][A-Za-zÀ-ɏ ()'-]{0,39}$/;

function safeSourceLanguage(name) {
  if (typeof name !== "string") return null;
  const trimmed = name.trim();
  return SAFE_LANGUAGE_NAME.test(trimmed) ? trimmed : null;
}

// Says outright which language the result must be written in. Without this the
// model drifts into English, because every other instruction here is in
// English — so "no translation" on a Russian page came back in English.
function buildLanguageInstruction(targetName, sourceName) {
  if (targetName) {
    return ` Write the result in ${targetName}, translating it from the language the source text is written in.`;
  }
  if (sourceName) {
    return (
      ` This is not a translation task. Write the result in ${sourceName}, the same language as the ` +
      `source text. Do not translate it into a different language — your result must be in ${sourceName}.`
    );
  }
  return (
    " This is not a translation task. Write the result in exactly the same language as the source text. " +
    "Do not translate it into a different language — if the source text is not in English, your result " +
    "must not be in English either."
  );
}

// "Plain English" is a reading level, not a language: applied to a Russian page
// kept in Russian, it means plain Russian. Falls back to the English phrasing
// when the output language isn't known (pasted text, which isn't detected).
function describeLevel(readingLevel, outputLanguageName) {
  if (readingLevel !== "plain-english") return READING_LEVELS[readingLevel];
  const language = outputLanguageName || "English";
  return (
    `plain ${language} for ${language} language learners at an intermediate (CEFR B1-ish) level — ` +
    "clear, simple vocabulary and moderately short sentences, no idioms or slang, but natural enough " +
    "not to sound like a beginner primer"
  );
}

function buildInstruction(readingLevel, targetName, sourceName) {
  const languageInstruction = buildLanguageInstruction(targetName, sourceName);

  if (readingLevel === SUMMARY_MODE) {
    return (
      "Summarize the following text concisely, capturing only its key points. " +
      "Use a short paragraph, or a few bullet points if the content is a list — " +
      "whichever fits better. It must be substantially shorter than the original: " +
      "summarize it, do not rewrite it in full." +
      languageInstruction
    );
  }

  return (
    `Rewrite the following text at ${describeLevel(readingLevel, targetName || sourceName)}. ` +
    "Keep the meaning intact; simplify vocabulary and sentence structure appropriately for the level. " +
    `${STRUCTURE_INSTRUCTION}` +
    languageInstruction
  );
}

function buildTextPrompt(text, readingLevel, targetLanguage, sourceLanguage) {
  const targetName = targetLanguage ? LANGUAGE_NAMES[targetLanguage] : null;
  const sourceName = safeSourceLanguage(sourceLanguage);

  // The title is deliberately always English: it labels the entry in the
  // history drawer, whose UI is English regardless of the passage's language.
  return (
    `${buildInstruction(readingLevel, targetName, sourceName)}\n\n` +
    'Also provide a short 3-5 word English title naming the topic of the passage (for example ' +
    '"Photosynthesis basics"), with no trailing punctuation. The title is always in English, ' +
    "whatever language the result itself is written in.\n\n" +
    'Respond with strict JSON only, in exactly this shape: {"title": string, "rewritten": string}. ' +
    "Do not add commentary, headers, or explanations — only the result itself in the rewritten field.\n\n" +
    `TEXT:\n${text}`
  );
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("OPENAI_API_KEY is not set");
    res.status(500).json({ error: "Server is not configured correctly" });
    return;
  }

  const { text, readingLevel, targetLanguage, sourceLanguage } = req.body || {};
  const trimmedText = typeof text === "string" ? text.trim() : "";

  if (!trimmedText) {
    res.status(400).json({ error: "Provide text to rewrite" });
    return;
  }

  if (!isValidMode(readingLevel)) {
    res.status(400).json({ error: "Missing or invalid readingLevel" });
    return;
  }

  if (targetLanguage && !LANGUAGE_NAMES[targetLanguage]) {
    res.status(400).json({ error: "Invalid targetLanguage" });
    return;
  }

  const isSummary = readingLevel === SUMMARY_MODE;

  try {
    const openaiRes = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              (isSummary
                ? "You summarize text, optionally translate it, and name it. "
                : "You rewrite text for a target reading level, optionally translate it, and name it. ") +
              "You only translate when the user's instructions ask for a specific output language; " +
              "otherwise you always write in the same language as the source text. " +
              'Respond with strict JSON only: {"title": string, "rewritten": string}. ' +
              "No markdown, no extra commentary.",
          },
          {
            role: "user",
            content: buildTextPrompt(trimmedText, readingLevel, targetLanguage, sourceLanguage),
          },
        ],
      }),
    });

    if (!openaiRes.ok) {
      const errBody = await openaiRes.text();
      console.error("OpenAI API error", openaiRes.status, errBody);
      res.status(502).json({ error: "Failed to process request" });
      return;
    }

    const data = await openaiRes.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      console.error("OpenAI response missing content", data);
      res.status(502).json({ error: "Failed to process request" });
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (parseErr) {
      console.error("Failed to parse model output as JSON", content);
      res.status(502).json({ error: "Failed to process request" });
      return;
    }

    if (typeof parsed.rewritten !== "string") {
      console.error("Model output missing expected fields", parsed);
      res.status(502).json({ error: "Failed to process request" });
      return;
    }

    // Title is best-effort — if the model omits it, the client derives a fallback.
    const title = typeof parsed.title === "string" ? parsed.title.trim() : "";

    res.status(200).json({ title, rewritten: parsed.rewritten });
  } catch (err) {
    console.error("Unexpected error calling OpenAI", err);
    res.status(500).json({ error: "Unexpected server error" });
  }
};
