const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const QUIZ_MODEL = "gpt-5.4-mini";

function buildPrompt(text, previousQuestions) {
  // Testing this against the real API surfaced the model straight-up
  // repeating an entire previous question set verbatim despite a softer,
  // trailing version of this instruction — so this is deliberately blunt and
  // placed first, before the model has started forming its own answer.
  const avoidClause =
    Array.isArray(previousQuestions) && previousQuestions.length > 0
      ? "This is a retry: the learner already saw the questions listed below and asked for different " +
        "ones. You must not repeat any of them verbatim, and you must not reword one into a new question " +
        "that tests the exact same fact — that is still a repeat. Pick a different detail, a different " +
        "sentence, or a different angle (cause, sequence, definition, comparison) from the passage for " +
        "every question. If the passage is short, look for smaller or more specific details you haven't " +
        "used yet rather than restating a bigger idea already covered below.\n\n" +
        "Already asked — do not repeat or reword any of these:\n" +
        previousQuestions.map((q, i) => `${i + 1}. ${q}`).join("\n") +
        "\n\n"
      : "";

  return (
    avoidClause +
    "Based on the following passage, write exactly 3 short multiple-choice questions " +
    "that test basic comprehension of it. Each question must have exactly 3 answer options, " +
    "with exactly one correct answer. Keep questions and options short and clear, matching the " +
    "reading level of the passage itself.\n\n" +
    'Respond with strict JSON only, in exactly this shape: ' +
    '{"questions": [{"question": string, "options": [string, string, string], "correctIndex": number}]} ' +
    "with exactly 3 items in the questions array, and correctIndex being the 0-based index (0, 1, or 2) " +
    "of the correct option. No markdown, no extra commentary.\n\n" +
    `PASSAGE:\n${text}`
  );
}

// The model has a documented positional bias in multiple-choice generation —
// asking it to "vary the position" in the prompt isn't reliable, which is
// exactly what was happening here (the correct answer almost never landed on
// the last option). Shuffling server-side guarantees a uniform position
// regardless of whatever bias the model has, without depending on prompting.
function shuffleQuestion(question) {
  const paired = question.options.map((option, i) => ({
    option,
    isCorrect: i === question.correctIndex,
  }));
  for (let i = paired.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [paired[i], paired[j]] = [paired[j], paired[i]];
  }
  return {
    question: question.question,
    options: paired.map((p) => p.option),
    correctIndex: paired.findIndex((p) => p.isCorrect),
  };
}

function isValidQuestions(questions) {
  return (
    Array.isArray(questions) &&
    questions.length === 3 &&
    questions.every(
      (q) =>
        q &&
        typeof q.question === "string" &&
        Array.isArray(q.options) &&
        q.options.length === 3 &&
        q.options.every((o) => typeof o === "string") &&
        Number.isInteger(q.correctIndex) &&
        q.correctIndex >= 0 &&
        q.correctIndex <= 2
    )
  );
}

// The prompt's anti-repeat instruction isn't reliably honored on its own —
// testing against the real API caught the model returning an entire previous
// question set verbatim despite being told those exact questions were
// off-limits. This is a backstop: exact (case/whitespace-insensitive) matches
// against the prior list.
function hasExactRepeat(questions, priorQuestions) {
  if (priorQuestions.length === 0) return false;
  const priorSet = new Set(priorQuestions.map((q) => q.trim().toLowerCase()));
  return questions.some((q) => priorSet.has(q.question.trim().toLowerCase()));
}

// One call to OpenAI: request, parse, validate. Returns { questions } or
// { error, status } — never throws, so the caller can retry on a repeat
// without a nested try/catch.
async function requestQuiz(apiKey, trimmedText, priorQuestions) {
  const openaiRes = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: QUIZ_MODEL,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You write short reading-comprehension quizzes. Always respond with strict JSON only, " +
            'in exactly this shape: {"questions": [{"question": string, "options": [string, string, string], "correctIndex": number}]}. ' +
            "No markdown, no extra commentary.",
        },
        { role: "user", content: buildPrompt(trimmedText, priorQuestions) },
      ],
    }),
  });

  if (!openaiRes.ok) {
    const errBody = await openaiRes.text();
    console.error("OpenAI quiz error", openaiRes.status, errBody);
    return { error: "Failed to generate quiz", status: 502 };
  }

  const data = await openaiRes.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    console.error("OpenAI quiz response missing content", data);
    return { error: "Failed to generate quiz", status: 502 };
  }

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (parseErr) {
    console.error("Failed to parse quiz JSON", content);
    return { error: "Failed to generate quiz", status: 502 };
  }

  if (!isValidQuestions(parsed.questions)) {
    console.error("Quiz output failed validation", parsed);
    return { error: "Failed to generate quiz", status: 502 };
  }

  return { questions: parsed.questions };
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

  const { text, previousQuestions } = req.body || {};
  const trimmedText = typeof text === "string" ? text.trim() : "";
  if (!trimmedText) {
    res.status(400).json({ error: "Missing text" });
    return;
  }

  // Accumulates across every retry in a quiz session, so cap generously —
  // these are short strings, and keep the most recent ones if it ever gets
  // long (a passage's oldest angles are the ones already furthest exhausted).
  const priorQuestions = Array.isArray(previousQuestions)
    ? previousQuestions.filter((q) => typeof q === "string" && q.trim()).slice(-30)
    : [];

  try {
    let result = await requestQuiz(apiKey, trimmedText, priorQuestions);

    // One retry if the model repeated a previous set despite being told not
    // to. Bounded to a single extra call — a short passage only has so many
    // distinct facts, so a second attempt is a reasonable-effort improvement,
    // not a guarantee, and an unbounded loop risks cost with no better odds.
    if (result.questions && hasExactRepeat(result.questions, priorQuestions)) {
      console.warn("Quiz repeated a previous question set verbatim — retrying once");
      result = await requestQuiz(apiKey, trimmedText, priorQuestions);
    }

    if (result.error) {
      res.status(result.status).json({ error: result.error });
      return;
    }

    res.status(200).json({ questions: result.questions.map(shuffleQuestion) });
  } catch (err) {
    console.error("Unexpected error calling OpenAI for quiz", err);
    res.status(500).json({ error: "Unexpected server error" });
  }
};
