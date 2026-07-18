const OPENAI_TTS_URL = "https://api.openai.com/v1/audio/speech";
const TTS_MODEL = "gpt-4o-mini-tts";
const DEFAULT_VOICE = "marin";

// OpenAI's speech endpoint rejects input past 4096 characters. The client
// splits passages into far smaller chunks, so hitting this means a caller
// bypassed that — fail with a clear reason rather than a generic upstream 502.
const MAX_INPUT_LENGTH = 4096;

const ALLOWED_VOICES = new Set([
  "marin",
  "cedar",
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "fable",
  "nova",
  "onyx",
  "sage",
  "shimmer",
  "verse",
]);

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

  const { text, voice } = req.body || {};
  const trimmedText = typeof text === "string" ? text.trim() : "";
  if (!trimmedText) {
    res.status(400).json({ error: "Missing text" });
    return;
  }

  if (trimmedText.length > MAX_INPUT_LENGTH) {
    res.status(400).json({ error: "Text is too long for a single request" });
    return;
  }

  if (voice !== undefined && !ALLOWED_VOICES.has(voice)) {
    res.status(400).json({ error: "Invalid voice" });
    return;
  }

  try {
    const openaiRes = await fetch(OPENAI_TTS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: TTS_MODEL,
        voice: voice || DEFAULT_VOICE,
        input: trimmedText,
        response_format: "mp3",
      }),
    });

    if (!openaiRes.ok) {
      const errBody = await openaiRes.text();
      console.error("OpenAI TTS error", openaiRes.status, errBody);
      res.status(502).json({ error: "Failed to generate audio" });
      return;
    }

    const arrayBuffer = await openaiRes.arrayBuffer();
    res.setHeader("Content-Type", "audio/mpeg");
    res.status(200).send(Buffer.from(arrayBuffer));
  } catch (err) {
    console.error("Unexpected error calling OpenAI TTS", err);
    res.status(500).json({ error: "Unexpected server error" });
  }
};
