(() => {
  if (window.lucide) window.lucide.createIcons();

  const tabUpload = document.getElementById("tab-upload");
  const tabPaste = document.getElementById("tab-paste");
  const panelUpload = document.getElementById("panel-upload");
  const panelPaste = document.getElementById("panel-paste");

  const dropzone = document.getElementById("dropzone");
  const imageInput = document.getElementById("image-input");
  const pagesRow = document.getElementById("pages-row");
  const imageLightbox = document.getElementById("image-lightbox");
  const lightboxImg = document.getElementById("lightbox-img");
  const newChatBtn = document.getElementById("new-chat-btn");

  const pasteInput = document.getElementById("paste-input");

  const readingLevelSelect = document.getElementById("reading-level");
  const targetLanguageSelect = document.getElementById("target-language");

  const simplifyBtn = document.getElementById("simplify-btn");
  const readAloudBtn = document.getElementById("read-aloud-btn");
  const readAloudLabel = readAloudBtn.querySelector(".btn-label");
  const pauseResumeBtn = document.getElementById("pause-resume-btn");
  const pauseResumeLabel = pauseResumeBtn.querySelector(".btn-label");
  const downloadBtn = document.getElementById("download-btn");
  const speedSelect = document.getElementById("speed-select");
  const voiceSelect = document.getElementById("voice-select");
  const previewVoiceBtn = document.getElementById("preview-voice-btn");
  const previewVoiceLabel = previewVoiceBtn.querySelector(".btn-label");
  const ttsAudioEl = document.getElementById("tts-audio");
  const voicePreviewAudioEl = document.getElementById("voice-preview-audio");
  const statusMessage = document.getElementById("status-message");

  const voiceSettingsBtn = document.getElementById("voice-settings-btn");
  const voiceSettingsPopover = document.getElementById("voice-settings-popover");

  const quizPanel = document.getElementById("quiz-panel");
  const quizToggle = document.getElementById("quiz-toggle");
  const quizChevron = document.getElementById("quiz-chevron");
  const quizBody = document.getElementById("quiz-body");
  const quizContent = document.getElementById("quiz-content");

  const historyOpenBtn = document.getElementById("history-open-btn");
  const historyCloseBtn = document.getElementById("history-close-btn");
  const historyDrawer = document.getElementById("history-drawer");
  const historyBackdrop = document.getElementById("history-backdrop");
  const historyList = document.getElementById("history-list");
  const projectFilterRow = document.getElementById("project-filter-row");

  const themeToggle = document.getElementById("theme-toggle");

  const HISTORY_KEY = "claritylearn_history";
  const PROJECTS_KEY = "claritylearn_projects";
  const THEME_KEY = "claritylearn_theme";
  const HISTORY_MAX = 20;

  // Which project's chats are currently shown in the drawer. null = "All".
  let currentProjectFilter = null;
  // The open "delete this project?" popover, if any.
  let openProjectConfirm = null;

  const READING_LEVEL_LABELS = {
    elementary: "Elementary",
    "middle-school": "Middle school",
    "plain-english": "Plain English",
    summary: "Summary",
  };
  const LANGUAGE_LABELS = {
    en: "English",
    es: "Spanish",
    fr: "French",
    zh: "Chinese",
    ar: "Arabic",
    vi: "Vietnamese",
    tl: "Tagalog",
  };

  // Every language we can translate into. English is included: it's a normal
  // target whenever the source isn't English, and refreshLanguageOptions()
  // drops whichever entry matches the detected source language.
  const TARGET_LANGUAGES = [
    { code: "en", label: "English" },
    { code: "es", label: "Spanish" },
    { code: "fr", label: "French" },
    { code: "zh", label: "Chinese (Simplified)" },
    { code: "ar", label: "Arabic" },
    { code: "vi", label: "Vietnamese" },
    { code: "tl", label: "Tagalog" },
  ];

  const DEFAULT_SOURCE = { code: "en", name: "English" };
  // Coalesces bursts of page changes (multi-select, quick reordering) into one
  // detection call.
  const DETECTION_DEBOUNCE_MS = 400;

  const VOICE_PREVIEW_TEXT = "Hi, this is a preview of my voice.";

  const outputOriginal = document.getElementById("output-original");
  const outputRewritten = document.getElementById("output-rewritten");

  const stepEls = Array.from(document.querySelectorAll(".step"));

  // Keep the base64 JSON payload safely under Vercel's ~4.5MB request body limit.
  const MAX_DATA_URL_LENGTH = 3_800_000;

  // Each page: { file, url }. Order in this array = order sent to the model.
  let pages = [];
  let activeTab = "upload";

  // The history entry the current chat is saved as, if any. Re-running Analyze
  // (a different reading level, a retry) updates this entry in place instead
  // of creating a new one each click. Cleared by "New chat" and set when a
  // saved chat is reopened, so continuing to edit it updates the same entry.
  let currentEntryId = null;

  // ---- Step one: transcription + language detection ----
  // Filled in by /api/transcribe as soon as the page set settles, so that
  // clicking Analyze only needs a cheap text-only call to /api/rewrite.
  let transcribedText = null;
  let detectedLanguage = null;
  let detectionPromise = null;
  let detectionTimer = null;
  // Bumped whenever the pages change, so a detection that's still in flight
  // for a stale page set can't overwrite fresher state when it lands.
  let detectionToken = 0;

  function setStatus(msg) {
    statusMessage.textContent = msg;
  }

  // ---- Theme ----
  // Every color is a custom property on :root, overridden under
  // html[data-theme="dark"], so switching themes is just this attribute.
  // The initial value is set by an inline script in <head> (before first
  // paint); this only syncs the switch's state to it and handles clicks.

  function isDarkTheme() {
    return document.documentElement.getAttribute("data-theme") === "dark";
  }

  function applyTheme(isDark) {
    if (isDark) document.documentElement.setAttribute("data-theme", "dark");
    else document.documentElement.removeAttribute("data-theme");
    themeToggle.setAttribute("aria-checked", String(isDark));
  }

  applyTheme(isDarkTheme());

  themeToggle.addEventListener("click", () => {
    const next = !isDarkTheme();
    applyTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next ? "dark" : "light");
    } catch (err) {
      // Storage blocked — the choice just won't survive a reload.
      console.error("Couldn't save theme preference", err);
    }
  });

  // Purely cosmetic progress indicator — does not gate access to any step.
  function updateStepper() {
    const hasResult =
      Boolean(outputRewritten.textContent) && !outputRewritten.classList.contains("placeholder");
    const hasInput =
      activeTab === "upload" ? pages.length > 0 : pasteInput.value.trim().length > 0;

    let current = 0;
    if (hasResult) current = 2;
    else if (hasInput) current = 1;

    stepEls.forEach((el, i) => {
      el.classList.toggle("is-complete", i < current);
      el.classList.toggle("is-active", i === current);
    });
  }

  function switchTab(target) {
    activeTab = target;
    const isUpload = target === "upload";
    tabUpload.classList.toggle("active", isUpload);
    tabPaste.classList.toggle("active", !isUpload);
    tabUpload.setAttribute("aria-selected", String(isUpload));
    tabPaste.setAttribute("aria-selected", String(!isUpload));
    panelUpload.hidden = !isUpload;
    panelPaste.hidden = isUpload;
    updateSimplifyAvailability();
  }

  tabUpload.addEventListener("click", () => switchTab("upload"));
  tabPaste.addEventListener("click", () => switchTab("paste"));

  const CHEVRON_UP_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="18 15 12 9 6 15"></polyline></svg>';
  const CHEVRON_DOWN_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="6 9 12 15 18 9"></polyline></svg>';
  const CLOSE_X_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';

  function addFiles(fileList) {
    const files = Array.from(fileList || []).filter((f) => f && f.type.startsWith("image/"));
    if (files.length === 0) return;
    files.forEach((file) => pages.push({ file, url: URL.createObjectURL(file) }));
    setStatus("");
    pagesChanged();
  }

  function removePage(index) {
    const [removed] = pages.splice(index, 1);
    if (removed) URL.revokeObjectURL(removed.url);
    pagesChanged();
  }

  function movePage(index, dir) {
    const target = index + dir;
    if (target < 0 || target >= pages.length) return;
    [pages[index], pages[target]] = [pages[target], pages[index]];
    // Page order changes the combined transcription, so this re-detects too.
    pagesChanged();
  }

  function clearPages() {
    pages.forEach((p) => URL.revokeObjectURL(p.url));
    pages = [];
    pagesChanged();
  }

  function renderPages() {
    pagesRow.textContent = "";
    pages.forEach((page, index) => {
      const chip = document.createElement("div");
      chip.className = "page-chip";

      const thumb = document.createElement("img");
      thumb.className = "page-thumb";
      thumb.src = page.url;
      thumb.alt = `Page ${index + 1}`;
      thumb.title = "Click to view larger";
      thumb.addEventListener("click", () => {
        lightboxImg.src = page.url;
        imageLightbox.hidden = false;
      });
      chip.appendChild(thumb);

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "page-remove";
      remove.title = "Remove page";
      remove.setAttribute("aria-label", `Remove page ${index + 1}`);
      remove.innerHTML = CLOSE_X_SVG;
      remove.addEventListener("click", () => removePage(index));
      chip.appendChild(remove);

      const label = document.createElement("div");
      label.className = "page-label";
      label.textContent = `Page ${index + 1}`;
      chip.appendChild(label);

      const reorder = document.createElement("div");
      reorder.className = "reorder-btns";

      const up = document.createElement("button");
      up.type = "button";
      up.innerHTML = CHEVRON_UP_SVG;
      up.title = "Move up";
      up.disabled = index === 0;
      up.addEventListener("click", () => movePage(index, -1));

      const down = document.createElement("button");
      down.type = "button";
      down.innerHTML = CHEVRON_DOWN_SVG;
      down.title = "Move down";
      down.disabled = index === pages.length - 1;
      down.addEventListener("click", () => movePage(index, 1));

      reorder.appendChild(up);
      reorder.appendChild(down);
      chip.appendChild(reorder);

      pagesRow.appendChild(chip);
    });
  }

  imageInput.addEventListener("change", (e) => {
    addFiles(e.target.files);
    // Reset so selecting the same file again still fires a change event.
    imageInput.value = "";
  });

  function closeLightbox() {
    imageLightbox.hidden = true;
    lightboxImg.removeAttribute("src");
  }

  imageLightbox.addEventListener("click", closeLightbox);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !imageLightbox.hidden) closeLightbox();
  });

  dropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropzone.classList.add("dragover");
  });
  dropzone.addEventListener("dragleave", () => {
    dropzone.classList.remove("dragover");
  });
  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragover");
    addFiles(e.dataTransfer.files);
  });

  pasteInput.addEventListener("input", updateSimplifyAvailability);

  function updateSimplifyAvailability() {
    const hasInput =
      activeTab === "upload" ? pages.length > 0 : pasteInput.value.trim().length > 0;
    simplifyBtn.disabled = !hasInput;
    updateStepper();
  }

  // Downscales/recompresses the photo on a canvas, shrinking the quality/size
  // further on each pass until the resulting base64 payload fits comfortably
  // under the serverless function's request body limit.
  function drawResized(file, maxDim, quality) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const objectUrl = URL.createObjectURL(file);
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const scale = maxDim / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        URL.revokeObjectURL(objectUrl);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = (err) => {
        URL.revokeObjectURL(objectUrl);
        reject(err);
      };
      img.src = objectUrl;
    });
  }

  // Compress each page so the combined JSON payload stays under Vercel's
  // ~4.5MB request-body limit. The budget is shared across all pages.
  async function prepareImagesForApi(files) {
    const perImageBudget = Math.max(400_000, Math.floor(3_600_000 / files.length));
    const dataUrls = [];
    for (const file of files) {
      let maxDim = 1500;
      let quality = 0.8;
      let dataUrl = await drawResized(file, maxDim, quality);
      let attempts = 0;
      while (dataUrl.length > perImageBudget && attempts < 6) {
        quality = Math.max(0.35, quality - 0.12);
        maxDim = Math.max(700, Math.round(maxDim * 0.85));
        dataUrl = await drawResized(file, maxDim, quality);
        attempts++;
      }
      dataUrls.push(dataUrl);
    }
    return dataUrls;
  }

  // Rebuilds the "Translate to" list around the detected source language: the
  // default option names it, and it's dropped from the target list — picking it
  // there would mean "translate into the language it's already in", which is
  // exactly what the default option does.
  function refreshLanguageOptions() {
    const source = detectedLanguage || DEFAULT_SOURCE;
    const previous = targetLanguageSelect.value;

    targetLanguageSelect.textContent = "";

    const noneOption = document.createElement("option");
    noneOption.value = "";
    noneOption.textContent = `No translation — keep in ${source.name}`;
    targetLanguageSelect.appendChild(noneOption);

    TARGET_LANGUAGES.forEach(({ code, label }) => {
      if (code === source.code) return;
      const option = document.createElement("option");
      option.value = code;
      option.textContent = label;
      targetLanguageSelect.appendChild(option);
    });

    // Keep the user's existing pick if the new list still offers it.
    const stillOffered = Array.from(targetLanguageSelect.options).some(
      (option) => option.value === previous
    );
    targetLanguageSelect.value = stillOffered ? previous : "";
  }

  // Invalidates any transcription/detection for the previous page set and
  // schedules a fresh run. Called for every add, remove and reorder.
  function pagesChanged() {
    detectionToken++;
    clearTimeout(detectionTimer);
    detectionTimer = null;
    detectionPromise = null;
    transcribedText = null;
    detectedLanguage = null;

    renderPages();
    refreshLanguageOptions();
    updateSimplifyAvailability();

    if (pages.length === 0) return;

    const token = detectionToken;
    detectionTimer = setTimeout(() => {
      detectionPromise = runDetection(token);
    }, DETECTION_DEBOUNCE_MS);
  }

  // Step one: transcribe every current page as one document and detect its
  // language. Resolves either way — failure just leaves transcribedText null,
  // which lets Analyze retry it.
  async function runDetection(token) {
    const files = pages.map((page) => page.file);
    if (files.length === 0) return;

    setStatus(files.length > 1 ? "Reading your pages…" : "Reading your page…");

    try {
      const images = await prepareImagesForApi(files);
      if (token !== detectionToken) return;

      const res = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ images }),
      });
      const data = await res.json();

      // The page set changed while this was in flight — its answer is stale.
      if (token !== detectionToken) return;

      if (!res.ok) {
        detectionPromise = null;
        setStatus(data.error || "Couldn't read that page. Please try again.");
        return;
      }

      transcribedText = data.transcription;
      detectedLanguage = data.languageCode
        ? { code: data.languageCode, name: data.languageName || DEFAULT_SOURCE.name }
        : null;
      refreshLanguageOptions();
      setStatus("");
    } catch (err) {
      if (token !== detectionToken) return;
      console.error("Couldn't transcribe pages", err);
      // Cleared so clicking Analyze retries rather than reusing this failure.
      detectionPromise = null;
      setStatus("Couldn't read that page. Please try again.");
    }
  }

  // Returns the transcription for the current pages, waiting on an in-flight
  // detection or kicking one off if the debounce hasn't fired yet.
  async function ensureTranscription() {
    if (transcribedText) return transcribedText;
    clearTimeout(detectionTimer);
    detectionTimer = null;
    if (!detectionPromise) detectionPromise = runDetection(detectionToken);
    await detectionPromise;
    return transcribedText;
  }

  // The display label for the language a result ends up in: the translation
  // target if one was picked, else the detected source language, else English
  // (pasted text, which isn't detected, and the app's original assumption).
  function resultLanguageLabel(targetLanguage) {
    if (targetLanguage && LANGUAGE_LABELS[targetLanguage]) return LANGUAGE_LABELS[targetLanguage];
    if (detectedLanguage) {
      return LANGUAGE_LABELS[detectedLanguage.code] || detectedLanguage.name;
    }
    return "English";
  }

  // History entries created before output-language tracking don't carry the
  // field; fall back to their translation target, or English (everything
  // predating detection was English).
  function historyLanguageLabel(entry) {
    if (entry.outputLanguage) return entry.outputLanguage;
    if (entry.targetLanguage && LANGUAGE_LABELS[entry.targetLanguage]) {
      return LANGUAGE_LABELS[entry.targetLanguage];
    }
    return "English";
  }

  simplifyBtn.addEventListener("click", async () => {
    const readingLevel = readingLevelSelect.value;
    const targetLanguage = targetLanguageSelect.value || undefined;

    // Capture the current pages up front so they're stable for history.
    const isImageRewrite = activeTab === "upload" && pages.length > 0;
    const imageFilesForHistory = isImageRewrite ? pages.map((p) => p.file) : [];

    simplifyBtn.disabled = true;
    simplifyBtn.classList.add("is-loading");
    readAloudBtn.disabled = true;
    // The old result is about to be replaced — don't let it be downloaded as
    // if it matched the options now on screen. applyResult() re-enables both.
    downloadBtn.disabled = true;

    try {
      // Step one's output. For photos this is usually already done; for pasted
      // text the box is the source.
      let sourceText;
      if (activeTab === "upload") {
        if (pages.length === 0) return;
        sourceText = await ensureTranscription();
        if (!sourceText) {
          setStatus("Couldn't read those pages. Please try again.");
          return;
        }
      } else {
        sourceText = pasteInput.value.trim();
        if (!sourceText) return;
      }

      setStatus(
        readingLevel === "summary"
          ? "Summarizing — this can take a few seconds…"
          : "Rewriting — this can take a few seconds…"
      );

      // Step two: text-only, so the page image is never sent a second time.
      // sourceLanguage lets the server name the language to keep the result in
      // when no translation was picked. Undefined for pasted text, which isn't
      // detected — the server then tells the model to match the source itself.
      const res = await fetch("/api/rewrite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: sourceText,
          readingLevel,
          targetLanguage,
          sourceLanguage: detectedLanguage ? detectedLanguage.name : undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setStatus(data.error || "Something went wrong. Please try again.");
        return;
      }

      applyResult(sourceText, data.rewritten);
      const entryId = saveOrUpdateHistoryEntry({
        title: data.title || "",
        original: sourceText,
        rewritten: data.rewritten,
        readingLevel,
        targetLanguage: targetLanguage || "",
        // The language the result is actually written in, so the history chip
        // can always show it — the translation target, or the language it was
        // kept in when there was no translation.
        outputLanguage: resultLanguageLabel(targetLanguage),
        hasImage: isImageRewrite,
      });
      // Store the compressed page images (array) in IndexedDB, keyed by entry id.
      if (imageFilesForHistory.length > 0) {
        Promise.all(imageFilesForHistory.map((f) => compressImageToBlob(f, 1000, 0.8)))
          .then((blobs) => idbPutImages(entryId, blobs))
          .catch((err) => console.error("Couldn't store history images", err));
      }
      setStatus("");
    } catch (err) {
      console.error(err);
      setStatus("Something went wrong reaching the server. Please try again.");
    } finally {
      simplifyBtn.classList.remove("is-loading");
      updateSimplifyAvailability();
    }
  });

  // speechSynthesis.getVoices() can return an empty list on first call in
  // some browsers until the async "voiceschanged" event fires.
  function loadVoices() {
    return new Promise((resolve) => {
      const existing = window.speechSynthesis.getVoices();
      if (existing.length > 0) {
        resolve(existing);
        return;
      }
      const onVoicesChanged = () => {
        window.speechSynthesis.removeEventListener("voiceschanged", onVoicesChanged);
        resolve(window.speechSynthesis.getVoices());
      };
      window.speechSynthesis.addEventListener("voiceschanged", onVoicesChanged);
      setTimeout(() => resolve(window.speechSynthesis.getVoices()), 1000);
    });
  }

  function pickVoice(langPrefix, voices) {
    const lower = langPrefix.toLowerCase();
    return (
      voices.find((v) => v.lang && v.lang.toLowerCase() === lower) ||
      voices.find((v) => v.lang && v.lang.toLowerCase().startsWith(lower)) ||
      null
    );
  }

  let isSpeaking = false;
  let isPaused = false;
  // The browser-speech fallback pauses through a different API than <audio>.
  let usingBrowserSpeech = false;
  let ttsSession = null;

  // ---- Chunked server-side TTS ----
  // OpenAI's speech endpoint caps input at 4096 characters, and synthesis time
  // scales with length — so reading a whole page in one request starts slowly
  // and is rejected outright past the cap. Instead the passage is split on
  // sentence boundaries and played as a queue: chunk N plays while chunk N+1 is
  // already being fetched. The first chunk is kept short so audio starts fast.
  const TTS_MAX_CHUNK = 3500;
  const TTS_CHUNK_TARGET = 700;
  const TTS_FIRST_CHUNK_TARGET = 220;

  // Sentence-ending punctuation across the languages we translate into: Latin,
  // CJK (。！？) and Arabic (؟). Splitting here means chunks break where a
  // reader would pause, rather than mid-clause.
  const SENTENCE_SPLIT = /[^.!?。！？؟…]+[.!?。！？؟…]*/g;

  function splitSentences(text) {
    const sentences = [];
    // Hard line breaks split first, so list items and numbered worksheet
    // questions stay whole instead of being packed in with their neighbours.
    text.split(/\n+/).forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      const matches = trimmed.match(SENTENCE_SPLIT);
      if (!matches) {
        sentences.push(trimmed);
        return;
      }
      matches.forEach((match) => {
        const sentence = match.trim();
        if (sentence) sentences.push(sentence);
      });
    });
    return sentences;
  }

  function chunkText(text) {
    const chunks = [];
    let current = "";
    let target = TTS_FIRST_CHUNK_TARGET;

    function flush() {
      if (!current) return;
      chunks.push(current);
      current = "";
      target = TTS_CHUNK_TARGET;
    }

    splitSentences(text).forEach((sentence) => {
      // A single sentence over the cap has nowhere natural to break, so it gets
      // cut by length. Rare, but it must never be sent whole.
      if (sentence.length > TTS_MAX_CHUNK) {
        flush();
        for (let i = 0; i < sentence.length; i += TTS_MAX_CHUNK) {
          chunks.push(sentence.slice(i, i + TTS_MAX_CHUNK));
        }
        target = TTS_CHUNK_TARGET;
        return;
      }
      if (current && current.length + 1 + sentence.length > target) flush();
      current = current ? `${current} ${sentence}` : sentence;
    });

    flush();
    return chunks;
  }

  // "idle" disables the button (nothing to pause), "playing" offers Pause, and
  // "paused" offers Resume. It stays disabled while the first chunk loads —
  // there's no audio to act on until playback actually starts.
  function setPauseResumeState(state) {
    if (state === "idle") {
      pauseResumeBtn.disabled = true;
      pauseResumeBtn.classList.remove("is-playing");
      pauseResumeLabel.textContent = "Resume";
      return;
    }
    const playing = state === "playing";
    pauseResumeBtn.disabled = false;
    pauseResumeBtn.classList.toggle("is-playing", playing);
    pauseResumeLabel.textContent = playing ? "Pause" : "Resume";
  }

  function resetReadAloudButton() {
    isSpeaking = false;
    isPaused = false;
    usingBrowserSpeech = false;
    readAloudBtn.disabled = false;
    readAloudBtn.classList.remove("is-playing", "is-loading");
    readAloudLabel.textContent = "Read aloud";
    setPauseResumeState("idle");
  }

  function markPlaying() {
    isSpeaking = true;
    isPaused = false;
    readAloudBtn.disabled = false;
    readAloudBtn.classList.remove("is-loading");
    readAloudBtn.classList.add("is-playing");
    readAloudLabel.textContent = "Stop reading";
    setPauseResumeState("playing");
  }

  // True from the moment a read-aloud starts loading, not just once audio is
  // audible — so Stop can cancel a chunk that's still in flight.
  function isTtsBusy() {
    return ttsSession !== null || isSpeaking;
  }

  function releaseSessionUrls(session) {
    session.audioUrls.forEach((url, i) => {
      if (url) URL.revokeObjectURL(url);
      session.audioUrls[i] = null;
    });
  }

  function createTtsSession(chunks, voice) {
    return {
      chunks,
      voice,
      audioUrls: new Array(chunks.length).fill(null),
      fetches: new Array(chunks.length).fill(null),
      controllers: [],
      cancelled: false,
      // Set while a chunk is playing. stopSpeaking() calls it so the queue loop
      // unblocks instead of awaiting an "ended" event that will never fire.
      resolveCurrent: null,
    };
  }

  // Memoized per chunk, so the prefetch of chunk N+1 and the later await of it
  // share a single request.
  function fetchChunk(session, index) {
    if (session.fetches[index]) return session.fetches[index];

    const controller = new AbortController();
    session.controllers.push(controller);

    const request = fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: session.chunks[index], voice: session.voice }),
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error(`TTS request failed (${res.status})`);
        return res.blob();
      })
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        // Stop may have landed while this was in flight — don't leak the URL.
        if (session.cancelled) {
          URL.revokeObjectURL(url);
          throw new Error("Read-aloud cancelled");
        }
        session.audioUrls[index] = url;
        return url;
      });

    session.fetches[index] = request;
    // A prefetch has no awaiter yet; this keeps an aborted one from surfacing
    // as an unhandled rejection. Real awaiters still see the error.
    request.catch(() => {});
    return request;
  }

  function playChunk(session, url) {
    return new Promise((resolve, reject) => {
      function cleanup() {
        ttsAudioEl.onplay = null;
        ttsAudioEl.onended = null;
        ttsAudioEl.onerror = null;
        session.resolveCurrent = null;
      }

      session.resolveCurrent = () => {
        cleanup();
        resolve();
      };

      ttsAudioEl.onplay = markPlaying;
      ttsAudioEl.onended = () => {
        cleanup();
        resolve();
      };
      ttsAudioEl.onerror = () => {
        cleanup();
        // Tearing down a cancelled session revokes its URLs, which the element
        // can report as an error. That's expected, not a real failure.
        if (session.cancelled) resolve();
        else reject(new Error("Audio playback error"));
      };

      ttsAudioEl.src = url;
      ttsAudioEl.play().catch((err) => {
        cleanup();
        if (session.cancelled) resolve();
        else reject(err);
      });
    });
  }

  // Plays every chunk in order, keeping exactly one request ahead of the
  // playhead. Rejects on the first real failure so the caller can fall back to
  // browser speech synthesis.
  async function playTtsSession(session) {
    for (let i = 0; i < session.chunks.length; i++) {
      if (session.cancelled) return;
      const url = await fetchChunk(session, i);
      if (session.cancelled) return;

      // Warm the next chunk so it's ready before this one finishes.
      if (i + 1 < session.chunks.length) fetchChunk(session, i + 1);

      await playChunk(session, url);
      if (session.cancelled) return;

      URL.revokeObjectURL(url);
      session.audioUrls[i] = null;
    }
  }

  function stopSpeaking() {
    const active = ttsSession;
    ttsSession = null;

    // Detach handlers before touching src, so tearing the element down can't
    // fire onerror and be mistaken for a genuine playback failure — which would
    // kick off the browser-speech fallback the user just asked to stop.
    ttsAudioEl.onplay = null;
    ttsAudioEl.onended = null;
    ttsAudioEl.onerror = null;
    if (!ttsAudioEl.paused) ttsAudioEl.pause();
    ttsAudioEl.removeAttribute("src");
    ttsAudioEl.load();

    if (active) {
      active.cancelled = true;
      active.controllers.forEach((controller) => controller.abort());
      // Unblock the queue loop, which is awaiting the chunk we just killed.
      if (active.resolveCurrent) active.resolveCurrent();
      releaseSessionUrls(active);
    }

    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    resetReadAloudButton();
  }

  // Fallback path: the browser's built-in speechSynthesis, with a voice
  // auto-matched to the selected translation language when possible.
  async function speakWithBrowser(text) {
    if (!window.speechSynthesis) {
      resetReadAloudButton();
      return;
    }

    const langPrefix = targetLanguageSelect.value || "en";
    const voices = await loadVoices();
    const voice = pickVoice(langPrefix, voices);

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = parseFloat(speedSelect.value) || 1;
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    } else {
      utterance.lang = langPrefix === "en" ? "en-US" : langPrefix;
    }

    utterance.onstart = markPlaying;
    utterance.onend = resetReadAloudButton;
    utterance.onerror = resetReadAloudButton;

    usingBrowserSpeech = true;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }

  readAloudBtn.addEventListener("click", async () => {
    if (isTtsBusy()) {
      stopSpeaking();
      return;
    }

    const text = outputRewritten.textContent;
    if (!text) return;

    const chunks = chunkText(text);
    if (chunks.length === 0) return;

    // Deliberately left enabled while loading, so a click can cancel a slow
    // first chunk instead of the user waiting it out.
    readAloudBtn.classList.add("is-loading");
    readAloudLabel.textContent = "Loading audio…";

    const session = createTtsSession(chunks, voiceSelect.value);
    ttsSession = session;

    try {
      await playTtsSession(session);
      if (session.cancelled) return;
      ttsSession = null;
      resetReadAloudButton();
    } catch (err) {
      // Stop aborts in-flight fetches, which lands here — not a failure.
      if (session.cancelled) return;
      console.error("Server TTS unavailable, falling back to browser speech synthesis", err);
      ttsSession = null;
      session.controllers.forEach((controller) => controller.abort());
      releaseSessionUrls(session);
      readAloudBtn.classList.remove("is-loading");
      readAloudLabel.textContent = "Read aloud";
      await speakWithBrowser(text);
    }
  });

  // Pause/resume leaves the session intact — the queue loop simply stays parked
  // on the current chunk's promise, and prefetching carries on in the
  // background. Only Stop tears the session down.
  pauseResumeBtn.addEventListener("click", () => {
    if (!isSpeaking) return;

    if (usingBrowserSpeech) {
      if (!window.speechSynthesis) return;
      if (isPaused) {
        window.speechSynthesis.resume();
        isPaused = false;
        setPauseResumeState("playing");
      } else {
        window.speechSynthesis.pause();
        isPaused = true;
        setPauseResumeState("paused");
      }
      return;
    }

    if (isPaused) {
      // The element's onplay handler (markPlaying) flips the button back.
      ttsAudioEl.play().catch((err) => {
        console.error("Couldn't resume audio", err);
      });
    } else {
      ttsAudioEl.pause();
      isPaused = true;
      setPauseResumeState("paused");
    }
  });

  // Local YYYY-MM-DD_HH-MM, so the filename sorts chronologically and stays
  // safe on every filesystem.
  function downloadTimestamp() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return (
      `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
      `_${pad(now.getHours())}-${pad(now.getMinutes())}`
    );
  }

  function buildDownloadText(readingLevel, targetLanguage) {
    const levelLabel = READING_LEVEL_LABELS[readingLevel] || readingLevel;
    const lines = ["ClarityLearn", `Reading level: ${levelLabel}`];
    if (targetLanguage && LANGUAGE_LABELS[targetLanguage]) {
      lines.push(`Translated to: ${LANGUAGE_LABELS[targetLanguage]}`);
    }
    lines.push(
      "",
      "--- Original ---",
      "",
      outputOriginal.textContent,
      "",
      "--- Rewritten ---",
      "",
      outputRewritten.textContent,
      ""
    );
    // CRLF so the file opens correctly in Notepad, not as one long line.
    return lines.join("\r\n");
  }

  downloadBtn.addEventListener("click", () => {
    const readingLevel = readingLevelSelect.value;
    const targetLanguage = targetLanguageSelect.value;
    const text = buildDownloadText(readingLevel, targetLanguage);

    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `claritylearn-${readingLevel}-${downloadTimestamp()}.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Revoked on the next tick — Safari needs the URL to still resolve when
    // the click is handled.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  });

  let previewObjectUrl = null;

  previewVoiceBtn.addEventListener("click", async () => {
    // Stop any in-progress read-aloud so it doesn't overlap with the preview.
    if (isTtsBusy()) stopSpeaking();
    if (!voicePreviewAudioEl.paused) {
      voicePreviewAudioEl.pause();
      voicePreviewAudioEl.currentTime = 0;
    }

    previewVoiceBtn.disabled = true;
    previewVoiceBtn.classList.add("is-loading");
    previewVoiceLabel.textContent = "Loading…";

    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: VOICE_PREVIEW_TEXT, voice: voiceSelect.value }),
      });
      if (!res.ok) throw new Error(`Preview request failed (${res.status})`);

      const blob = await res.blob();
      if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
      previewObjectUrl = URL.createObjectURL(blob);
      voicePreviewAudioEl.src = previewObjectUrl;
      await voicePreviewAudioEl.play();
    } catch (err) {
      console.error("Voice preview failed", err);
      setStatus("Couldn't preview that voice. Please try again.");
    } finally {
      previewVoiceBtn.disabled = false;
      previewVoiceBtn.classList.remove("is-loading");
      previewVoiceLabel.textContent = "Preview voice";
    }
  });

  function closeVoiceSettings() {
    voiceSettingsPopover.classList.remove("open");
    voiceSettingsBtn.classList.remove("is-open");
    voiceSettingsBtn.setAttribute("aria-expanded", "false");
  }

  voiceSettingsBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = voiceSettingsPopover.classList.toggle("open");
    voiceSettingsBtn.classList.toggle("is-open", isOpen);
    voiceSettingsBtn.setAttribute("aria-expanded", String(isOpen));
  });

  document.addEventListener("click", (e) => {
    if (!voiceSettingsPopover.classList.contains("open")) return;
    if (voiceSettingsPopover.contains(e.target) || voiceSettingsBtn.contains(e.target)) return;
    closeVoiceSettings();
  });

  // Optional quiz — collapsed by default. Questions are only generated the
  // first time the card is expanded, not automatically after every rewrite.
  let quizLoaded = false;

  // The questions from the most recently rendered quiz, sent back on retry so
  // the model is told what to avoid repeating instead of independently
  // reconverging on the same handful of facts from a short passage.
  let previousQuizQuestions = [];

  function resetQuiz() {
    quizPanel.hidden = false;
    quizBody.classList.remove("open");
    quizChevron.classList.remove("open");
    quizToggle.setAttribute("aria-expanded", "false");
    quizContent.textContent = "";
    quizLoaded = false;
    previousQuizQuestions = [];
  }

  function renderQuiz(questions) {
    quizContent.textContent = "";

    const answered = new Array(questions.length).fill(false);
    let score = 0;

    const scoreLabel = document.createElement("span");
    scoreLabel.className = "quiz-score";

    function refreshScore() {
      scoreLabel.textContent = `Score: ${score} / ${questions.length}`;
    }

    questions.forEach((q, qIndex) => {
      const qDiv = document.createElement("div");
      qDiv.className = "quiz-question";

      const qP = document.createElement("p");
      qP.className = "quiz-q";
      qP.textContent = `${qIndex + 1}. ${q.question}`;
      qDiv.appendChild(qP);

      const choiceEls = [];
      q.options.forEach((optionText, oIndex) => {
        const choice = document.createElement("div");
        choice.className = "quiz-choice";

        const dot = document.createElement("span");
        dot.className = "quiz-dot";
        choice.appendChild(dot);

        const label = document.createElement("span");
        label.textContent = optionText;
        choice.appendChild(label);

        choice.addEventListener("click", () => {
          if (answered[qIndex]) return;
          answered[qIndex] = true;

          choiceEls.forEach((el, idx) => {
            el.classList.add("disabled");
            if (idx === q.correctIndex) el.classList.add("correct");
            else if (idx === oIndex) el.classList.add("incorrect");
          });

          if (oIndex === q.correctIndex) score += 1;
          refreshScore();
        });

        choiceEls.push(choice);
        qDiv.appendChild(choice);
      });

      quizContent.appendChild(qDiv);
    });

    const scoreRow = document.createElement("div");
    scoreRow.className = "quiz-score-row";
    scoreRow.appendChild(scoreLabel);

    const retryBtn = document.createElement("button");
    retryBtn.type = "button";
    retryBtn.className = "quiz-retry-link";
    retryBtn.textContent = "Try again with new questions";
    retryBtn.addEventListener("click", loadQuiz);
    scoreRow.appendChild(retryBtn);

    quizContent.appendChild(scoreRow);
    refreshScore();
  }

  async function loadQuiz() {
    quizContent.textContent = "";
    const loadingP = document.createElement("p");
    loadingP.className = "quiz-loading";
    loadingP.textContent = "Generating questions…";
    quizContent.appendChild(loadingP);

    try {
      const res = await fetch("/api/quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: outputRewritten.textContent,
          previousQuestions: previousQuizQuestions,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to generate quiz");
      // Accumulated across every retry in this quiz session (not replaced) —
      // a short passage only has so many distinct facts to ask about, and
      // excluding just the immediately-previous set let old questions cycle
      // back in by the third retry.
      previousQuizQuestions = previousQuizQuestions.concat(data.questions.map((q) => q.question));
      renderQuiz(data.questions);
    } catch (err) {
      console.error("Quiz generation failed", err);
      quizContent.textContent = "";
      const errorP = document.createElement("p");
      errorP.className = "quiz-error";
      errorP.textContent = "Couldn't generate questions. ";
      const retryBtn = document.createElement("button");
      retryBtn.type = "button";
      retryBtn.className = "quiz-retry-link";
      retryBtn.textContent = "Try again";
      retryBtn.addEventListener("click", loadQuiz);
      errorP.appendChild(retryBtn);
      quizContent.appendChild(errorP);
    }
  }

  function toggleQuiz() {
    const isOpen = quizBody.classList.toggle("open");
    quizChevron.classList.toggle("open", isOpen);
    quizToggle.setAttribute("aria-expanded", String(isOpen));
    if (isOpen && !quizLoaded) {
      quizLoaded = true;
      loadQuiz();
    }
  }

  quizToggle.addEventListener("click", toggleQuiz);
  quizToggle.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggleQuiz();
    }
  });

  // Shared result-rendering used by both a fresh rewrite and reopening a saved
  // history entry.
  function applyResult(original, rewritten) {
    outputOriginal.textContent = original;
    outputRewritten.textContent = rewritten;
    outputRewritten.classList.remove("placeholder");
    // Restart the fade-in animation even if it was already applied once.
    outputRewritten.classList.remove("fade-in");
    void outputRewritten.offsetWidth;
    outputRewritten.classList.add("fade-in");
    readAloudBtn.disabled = false;
    downloadBtn.disabled = false;
    resetQuiz();
    updateStepper();
  }

  // ---- Saved page images, persisted in IndexedDB (keyed by entry id) ----
  // localStorage's ~5-10MB cap can't hold several photos, so images live in
  // IndexedDB while the text/title/settings stay in localStorage.
  const IDB_NAME = "claritylearn";
  const IDB_STORE = "images";

  function idbOpen() {
    return new Promise((resolve, reject) => {
      // Open without a fixed version: uses the current version, or creates the
      // DB at v1 (firing onupgradeneeded) if it doesn't exist yet. This avoids
      // VersionError from hardcoding a version below the DB's current one.
      const req = indexedDB.open(IDB_NAME);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
      };
      req.onsuccess = () => {
        const db = req.result;
        if (db.objectStoreNames.contains(IDB_STORE)) {
          resolve(db);
          return;
        }
        // DB exists but the store is missing — reopen one version higher so
        // onupgradeneeded fires and recreates it (self-healing).
        const nextVersion = db.version + 1;
        db.close();
        const up = indexedDB.open(IDB_NAME, nextVersion);
        up.onupgradeneeded = () => {
          const udb = up.result;
          if (!udb.objectStoreNames.contains(IDB_STORE)) udb.createObjectStore(IDB_STORE);
        };
        up.onsuccess = () => resolve(up.result);
        up.onerror = () => reject(up.error);
      };
      req.onerror = () => reject(req.error);
    });
  }

  // Stores an array of page Blobs under the entry id.
  async function idbPutImages(id, blobs) {
    try {
      const db = await idbOpen();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, "readwrite");
        tx.objectStore(IDB_STORE).put(blobs, id);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    } catch (err) {
      console.error("Couldn't save images to IndexedDB", err);
    }
  }

  // Returns an array of page Blobs (normalizing a legacy single-blob record).
  async function idbGetImages(id) {
    try {
      const db = await idbOpen();
      const value = await new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, "readonly");
        const req = tx.objectStore(IDB_STORE).get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
      db.close();
      if (!value) return [];
      return Array.isArray(value) ? value : [value];
    } catch (err) {
      console.error("Couldn't read images from IndexedDB", err);
      return [];
    }
  }

  async function idbDeleteImage(id) {
    try {
      const db = await idbOpen();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, "readwrite");
        tx.objectStore(IDB_STORE).delete(id);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    } catch (err) {
      console.error("Couldn't delete image from IndexedDB", err);
    }
  }

  // Downscale to ~1000px on the long edge and re-encode as JPEG so stored
  // history images stay small.
  function compressImageToBlob(file, maxDim, quality) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const scale = maxDim / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        URL.revokeObjectURL(url);
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error("toBlob returned null"))),
          "image/jpeg",
          quality
        );
      };
      img.onerror = (err) => {
        URL.revokeObjectURL(url);
        reject(err);
      };
      img.src = url;
    });
  }

  // ---- Recent rewrites, persisted in localStorage (per-browser) ----

  function loadHistory() {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      console.error("Couldn't read saved history", err);
      return [];
    }
  }

  function writeHistory(entries) {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(entries));
    } catch (err) {
      // Storage full or unavailable (e.g. private mode) — history just won't persist.
      console.error("Couldn't save history", err);
    }
  }

  function saveHistoryEntry(entry) {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const entries = loadHistory();
    entries.unshift({
      id,
      ts: Date.now(),
      title: entry.title || "",
      original: entry.original,
      rewritten: entry.rewritten,
      readingLevel: entry.readingLevel,
      targetLanguage: entry.targetLanguage,
      outputLanguage: entry.outputLanguage || "",
      hasImage: Boolean(entry.hasImage),
      projectId: entry.projectId || null,
    });
    const kept = entries.slice(0, HISTORY_MAX);
    // Drop images belonging to entries pushed past the cap so IndexedDB doesn't grow forever.
    entries.slice(HISTORY_MAX).forEach((e) => {
      if (e.hasImage) idbDeleteImage(e.id);
    });
    writeHistory(kept);
    refreshHistoryUI();
    return id;
  }

  // Returns true if `id` still exists in history and was updated, false if not
  // (e.g. the user deleted it from the drawer mid-chat).
  function updateHistoryEntry(id, changes) {
    const entries = loadHistory();
    const idx = entries.findIndex((e) => e.id === id);
    if (idx === -1) return false;
    entries[idx] = { ...entries[idx], ...changes };
    writeHistory(entries);
    return true;
  }

  // One chat = one history entry. The first successful Analyze in a chat
  // creates it; every later Analyze in that same chat (a different reading
  // level, a retry, editing the source) updates it in place rather than
  // piling up a new entry per click. Falls back to creating a new entry if
  // the current one was deleted from the drawer mid-chat.
  function saveOrUpdateHistoryEntry(entry) {
    if (currentEntryId) {
      const hadImage = loadHistory().find((e) => e.id === currentEntryId)?.hasImage;
      const updated = updateHistoryEntry(currentEntryId, {
        title: entry.title || "",
        original: entry.original,
        rewritten: entry.rewritten,
        readingLevel: entry.readingLevel,
        targetLanguage: entry.targetLanguage,
        outputLanguage: entry.outputLanguage || "",
        hasImage: Boolean(entry.hasImage),
      });
      if (updated) {
        // The chat dropped its image (e.g. switched to Paste text and
        // re-ran) — don't leave the old pages orphaned in IndexedDB.
        if (hadImage && !entry.hasImage) idbDeleteImage(currentEntryId);
        refreshHistoryUI();
        return currentEntryId;
      }
    }
    currentEntryId = saveHistoryEntry(entry);
    return currentEntryId;
  }

  function deleteHistoryEntry(id) {
    writeHistory(loadHistory().filter((e) => e.id !== id));
    idbDeleteImage(id);
    refreshHistoryUI();
  }

  // ---- Projects: lightweight groups a saved chat can belong to ----

  function loadProjects() {
    try {
      const raw = localStorage.getItem(PROJECTS_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      console.error("Couldn't read saved projects", err);
      return [];
    }
  }

  function writeProjects(projects) {
    try {
      localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
    } catch (err) {
      console.error("Couldn't save projects", err);
    }
  }

  function createProject(name) {
    const trimmed = (name || "").trim();
    if (!trimmed) return null;
    const projects = loadProjects();
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    projects.push({ id, name: trimmed });
    writeProjects(projects);
    return id;
  }

  function deleteProject(id) {
    writeProjects(loadProjects().filter((p) => p.id !== id));
    // Unassign any chats that pointed at this project rather than orphaning them.
    const entries = loadHistory().map((e) =>
      e.projectId === id ? { ...e, projectId: null } : e
    );
    writeHistory(entries);
    if (currentProjectFilter === id) currentProjectFilter = null;
  }

  // Display name for an entry: the AI-generated title, or a fallback derived
  // from the original text for older entries saved before titles existed.
  function entryDisplayName(entry) {
    if (entry.title && entry.title.trim()) return entry.title.trim();
    const src = (entry.original || "").trim().replace(/\s+/g, " ");
    return src.length > 42 ? `${src.slice(0, 42)}…` : src || "Untitled";
  }

  // Fixed glyphs for history entries (constant markup, not user data).
  const FILE_ICON_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>' +
    '<polyline points="14 2 14 8 20 8"></polyline></svg>';

  const KEBAB_ICON_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" stroke="none">' +
    '<circle cx="12" cy="5" r="1.6"></circle><circle cx="12" cy="12" r="1.6"></circle>' +
    '<circle cx="12" cy="19" r="1.6"></circle></svg>';

  const RENAME_ICON_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"></path></svg>';

  const FOLDER_ICON_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"></path></svg>';

  const TRASH_ICON_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<polyline points="3 6 5 6 21 6"></polyline>' +
    '<path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>' +
    '<path d="M10 11v6"></path><path d="M14 11v6"></path>' +
    '<path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path></svg>';

  const CHECK_ICON_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
    '<polyline points="20 6 9 17 4 12"></polyline></svg>';

  const PLUS_ICON_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>';

  async function reopenHistoryEntry(entry) {
    // Continuing to edit a reopened chat (a different level, a retry) should
    // update this same saved entry, not fork a duplicate.
    currentEntryId = entry.id;
    if (READING_LEVEL_LABELS[entry.readingLevel]) {
      readingLevelSelect.value = entry.readingLevel;
    }
    targetLanguageSelect.value = entry.targetLanguage || "";
    applyResult(entry.original, entry.rewritten);

    // Restore the actual source into the input the click handler reads —
    // not just the read-only "Original" display column — so that re-running
    // Analyze after reopening operates on this chat's text, not on whatever a
    // previous chat happened to leave sitting in the paste box or upload area.
    if (entry.hasImage) {
      const blobs = await idbGetImages(entry.id);
      if (blobs.length > 0) {
        clearPages();
        blobs.forEach((blob, i) => {
          const file = new File([blob], `history-page-${i + 1}.jpg`, {
            type: blob.type || "image/jpeg",
          });
          pages.push({ file, url: URL.createObjectURL(file) });
        });
        renderPages();
        // clearPages() just reset the transcription cache (it's a fresh page
        // set as far as that cache knows). Re-seed it with the already-known
        // transcription so re-running Analyze doesn't burn a vision API call
        // re-transcribing images this chat already transcribed once.
        transcribedText = entry.original;
        switchTab("upload");
      }
    } else {
      clearPages();
      pasteInput.value = entry.original;
      switchTab("paste");
    }

    closeHistory();
    document
      .querySelector(".output-panel")
      .scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function closeAllMenus() {
    historyList.querySelectorAll(".history-menu.open").forEach((m) => m.classList.remove("open"));
    historyList
      .querySelectorAll(".history-project-list.open")
      .forEach((p) => p.classList.remove("open"));
    historyList
      .querySelectorAll(".history-item.menu-open")
      .forEach((i) => i.classList.remove("menu-open"));
  }

  // Turn an entry's title into an inline editable input. Enter or blur (incl.
  // clicking outside) saves; Escape cancels. Persists the new name to storage.
  function startRename(item, entry, nameEl) {
    const input = document.createElement("input");
    input.type = "text";
    input.className = "history-rename-input";
    input.value = entryDisplayName(entry);

    let done = false;
    function commit(save) {
      if (done) return;
      done = true;
      const newName = save ? input.value.trim() : "";
      if (save && newName) {
        entry.title = newName;
        updateHistoryEntry(entry.id, { title: newName });
        nameEl.textContent = newName;
        nameEl.title = newName;
      }
      if (input.parentNode) input.parentNode.replaceChild(nameEl, input);
    }

    input.addEventListener("click", (e) => e.stopPropagation());
    // Blur handles the "click outside saves" case.
    input.addEventListener("blur", () => commit(true));
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        e.preventDefault();
        commit(true);
      } else if (e.key === "Escape") {
        e.preventDefault();
        commit(false);
      }
    });

    item.querySelector(".history-title-row").replaceChild(input, nameEl);
    input.focus();
    input.select();
  }

  // A small row inside the "Add to project" expandable picker: an optional
  // checkmark (when this is the entry's current project) plus a label.
  function buildProjectRow(label, isActive, extraClass) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = `history-project-row${isActive ? " active" : ""}${
      extraClass ? ` ${extraClass}` : ""
    }`;
    const icon = document.createElement("span");
    icon.className = "history-menu-icon";
    if (isActive) icon.innerHTML = CHECK_ICON_SVG;
    row.appendChild(icon);
    const text = document.createElement("span");
    text.textContent = label;
    row.appendChild(text);
    return row;
  }

  function buildProjectPicker(entry) {
    const projectList = document.createElement("div");
    projectList.className = "history-project-list";
    projectList.addEventListener("click", (e) => e.stopPropagation());
    return projectList;
  }

  // (Re)renders the contents of an "Add to project" picker for one entry:
  // "No project", every saved project (checkmarked if assigned), then a
  // "New project" row that turns into an inline name field when clicked.
  function refreshProjectPicker(projectList, entry) {
    projectList.textContent = "";

    const noneRow = buildProjectRow("No project", !entry.projectId);
    noneRow.addEventListener("click", (e) => {
      e.stopPropagation();
      entry.projectId = null;
      updateHistoryEntry(entry.id, { projectId: null });
      closeAllMenus();
      refreshHistoryUI();
    });
    projectList.appendChild(noneRow);

    loadProjects().forEach((project) => {
      const row = buildProjectRow(project.name, entry.projectId === project.id);
      row.addEventListener("click", (e) => {
        e.stopPropagation();
        entry.projectId = project.id;
        updateHistoryEntry(entry.id, { projectId: project.id });
        closeAllMenus();
        refreshHistoryUI();
      });
      projectList.appendChild(row);
    });

    const newRow = buildProjectRow("New project", false, "history-project-new");
    newRow.querySelector(".history-menu-icon").innerHTML = PLUS_ICON_SVG;
    newRow.addEventListener("click", (e) => {
      e.stopPropagation();
      startNewProjectInline(projectList, newRow, (id) => {
        entry.projectId = id;
        updateHistoryEntry(entry.id, { projectId: id });
        closeAllMenus();
        refreshHistoryUI();
      });
    });
    projectList.appendChild(newRow);
  }

  // Swaps `placeholder` for a text input; Enter/blur-with-text creates a
  // project via `onCreate(id)`, Escape/blur-empty restores the placeholder.
  function startNewProjectInline(container, placeholder, onCreate) {
    const input = document.createElement("input");
    input.type = "text";
    input.className = "project-name-input";
    input.placeholder = "Project name";

    let done = false;
    function commit(save) {
      if (done) return;
      done = true;
      const name = input.value.trim();
      if (save && name) {
        const id = createProject(name);
        onCreate(id);
      } else if (input.parentNode) {
        input.parentNode.replaceChild(placeholder, input);
      }
    }

    input.addEventListener("click", (e) => e.stopPropagation());
    input.addEventListener("blur", () => commit(true));
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        e.preventDefault();
        commit(true);
      } else if (e.key === "Escape") {
        e.preventDefault();
        commit(false);
      }
    });

    container.replaceChild(input, placeholder);
    input.focus();
  }

  function buildMenuOption(className, iconSvg, label) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `history-menu-option ${className}`.trim();
    const icon = document.createElement("span");
    icon.className = "history-menu-icon";
    icon.innerHTML = iconSvg;
    btn.appendChild(icon);
    const text = document.createElement("span");
    text.textContent = label;
    btn.appendChild(text);
    return btn;
  }

  function renderHistoryList(entries) {
    historyList.textContent = "";

    if (entries.length === 0) {
      const empty = document.createElement("p");
      empty.className = "history-empty";
      empty.textContent = currentProjectFilter
        ? "No chats in this project yet."
        : "No saved rewrites yet.";
      historyList.appendChild(empty);
      return;
    }

    entries.forEach((entry) => {
      const item = document.createElement("div");
      item.className = "history-item";

      const text = document.createElement("div");
      text.className = "history-text";

      const titleRow = document.createElement("div");
      titleRow.className = "history-title-row";
      const name = document.createElement("p");
      name.className = "history-snippet";
      const displayName = entryDisplayName(entry);
      name.textContent = displayName;
      name.title = displayName;
      titleRow.appendChild(name);
      text.appendChild(titleRow);

      const meta = document.createElement("div");
      meta.className = "history-meta";

      const levelChip = document.createElement("span");
      levelChip.className = "history-chip";
      levelChip.textContent = READING_LEVEL_LABELS[entry.readingLevel] || "Rewrite";
      meta.appendChild(levelChip);

      const langChip = document.createElement("span");
      langChip.className = "history-chip lang";
      langChip.textContent = historyLanguageLabel(entry);
      meta.appendChild(langChip);

      if (entry.projectId) {
        const project = loadProjects().find((p) => p.id === entry.projectId);
        if (project) {
          const projectChip = document.createElement("span");
          projectChip.className = "history-chip project";
          projectChip.textContent = project.name;
          meta.appendChild(projectChip);
        }
      }

      text.appendChild(meta);
      item.appendChild(text);

      // Kebab (⋯) button
      const kebab = document.createElement("button");
      kebab.type = "button";
      kebab.className = "history-kebab";
      kebab.title = "More";
      kebab.setAttribute("aria-label", "More options");
      kebab.innerHTML = KEBAB_ICON_SVG;
      item.appendChild(kebab);

      // Dropdown menu
      const menu = document.createElement("div");
      menu.className = "history-menu";
      menu.addEventListener("click", (e) => e.stopPropagation());

      const renameOpt = buildMenuOption("", RENAME_ICON_SVG, "Rename");
      const projectOpt = buildMenuOption("", FOLDER_ICON_SVG, "Add to project");
      const projectList = buildProjectPicker(entry);
      const divider = document.createElement("div");
      divider.className = "history-menu-divider";
      const deleteOpt = buildMenuOption("danger", TRASH_ICON_SVG, "Delete");

      menu.appendChild(renameOpt);
      menu.appendChild(projectOpt);
      menu.appendChild(projectList);
      menu.appendChild(divider);
      menu.appendChild(deleteOpt);
      item.appendChild(menu);

      // Interactions
      kebab.addEventListener("click", (e) => {
        e.stopPropagation();
        const wasOpen = menu.classList.contains("open");
        closeAllMenus();
        if (!wasOpen) {
          menu.classList.add("open");
          item.classList.add("menu-open");
        }
      });

      renameOpt.addEventListener("click", (e) => {
        e.stopPropagation();
        closeAllMenus();
        startRename(item, entry, name);
      });

      projectOpt.addEventListener("click", (e) => {
        e.stopPropagation();
        const isOpen = projectList.classList.toggle("open");
        if (isOpen) refreshProjectPicker(projectList, entry);
      });

      deleteOpt.addEventListener("click", (e) => {
        e.stopPropagation();
        closeAllMenus();
        deleteHistoryEntry(entry.id);
      });

      item.addEventListener("click", () => reopenHistoryEntry(entry));

      historyList.appendChild(item);
    });
  }

  function closeProjectConfirm() {
    if (!openProjectConfirm) return;
    openProjectConfirm.remove();
    openProjectConfirm = null;
  }

  // "Are you sure?" popover for deleting a project, anchored to the right of
  // its chip. It's appended to the filter row rather than to the chip itself,
  // because the chip is a <button> and can't legally contain the Yes/No
  // buttons — so the position is measured from the chip instead.
  function openDeleteProjectConfirm(chip, project) {
    closeProjectConfirm();

    const box = document.createElement("div");
    box.className = "project-confirm";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", `Delete project ${project.name}`);
    // Clicks inside must not reach the document listener that dismisses it.
    box.addEventListener("click", (e) => e.stopPropagation());

    const message = document.createElement("p");
    message.className = "project-confirm-msg";
    message.textContent = `Delete "${project.name}"?`;
    box.appendChild(message);

    const note = document.createElement("p");
    note.className = "project-confirm-note";
    note.textContent = "Its chats will be kept.";
    box.appendChild(note);

    const row = document.createElement("div");
    row.className = "project-confirm-row";

    const yesBtn = document.createElement("button");
    yesBtn.type = "button";
    yesBtn.className = "project-confirm-btn danger";
    yesBtn.textContent = "Yes";
    yesBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      closeProjectConfirm();
      deleteProject(project.id);
      refreshHistoryUI();
    });
    row.appendChild(yesBtn);

    const noBtn = document.createElement("button");
    noBtn.type = "button";
    noBtn.className = "project-confirm-btn";
    noBtn.textContent = "No";
    noBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      closeProjectConfirm();
    });
    row.appendChild(noBtn);

    box.appendChild(row);
    projectFilterRow.appendChild(box);

    // Measured after insertion so the box's own width is known. Preference is
    // to the right of the chip; if the drawer is too narrow for that, it drops
    // below the chip rather than spilling off the edge.
    const gap = 6;
    const rowWidth = projectFilterRow.clientWidth;
    const rightOfChip = chip.offsetLeft + chip.offsetWidth + gap;

    if (rightOfChip + box.offsetWidth <= rowWidth) {
      box.style.left = `${rightOfChip}px`;
      box.style.top = `${chip.offsetTop}px`;
    } else {
      const clamped = Math.min(chip.offsetLeft, Math.max(0, rowWidth - box.offsetWidth));
      box.style.left = `${clamped}px`;
      box.style.top = `${chip.offsetTop + chip.offsetHeight + gap}px`;
    }

    openProjectConfirm = box;
    // "No" takes focus, so a stray Enter cancels rather than deletes.
    noBtn.focus();
  }

  function renderProjectFilters() {
    if (!projectFilterRow) return;
    // The row is about to be emptied, which would strip the popover's anchor.
    closeProjectConfirm();
    projectFilterRow.textContent = "";
    const projects = loadProjects();

    const allChip = document.createElement("button");
    allChip.type = "button";
    allChip.className = `project-chip${currentProjectFilter === null ? " active" : ""}`;
    allChip.textContent = "All";
    allChip.addEventListener("click", () => {
      currentProjectFilter = null;
      refreshHistoryUI();
    });
    projectFilterRow.appendChild(allChip);

    projects.forEach((project) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = `project-chip${currentProjectFilter === project.id ? " active" : ""}`;

      const label = document.createElement("span");
      label.textContent = project.name;
      chip.appendChild(label);

      const remove = document.createElement("span");
      remove.className = "project-chip-remove";
      remove.innerHTML = "&times;";
      remove.title = "Delete project";
      remove.addEventListener("click", (e) => {
        e.stopPropagation();
        openDeleteProjectConfirm(chip, project);
      });
      chip.appendChild(remove);

      chip.addEventListener("click", () => {
        currentProjectFilter = project.id;
        refreshHistoryUI();
      });

      projectFilterRow.appendChild(chip);
    });

    const addChip = document.createElement("button");
    addChip.type = "button";
    addChip.className = "project-chip project-chip-add";
    addChip.setAttribute("aria-label", "New project");
    addChip.title = "New project";
    addChip.textContent = "+ Project";
    addChip.addEventListener("click", () => {
      startNewProjectInline(projectFilterRow, addChip, (id) => {
        currentProjectFilter = id;
        refreshHistoryUI();
      });
    });
    projectFilterRow.appendChild(addChip);
  }

  function refreshHistoryUI() {
    renderProjectFilters();
    const entries = loadHistory();
    const filtered = currentProjectFilter
      ? entries.filter((e) => e.projectId === currentProjectFilter)
      : entries;
    renderHistoryList(filtered);
  }

  function openHistory() {
    refreshHistoryUI();
    historyBackdrop.hidden = false;
    historyDrawer.hidden = false;
    // Force reflow so the slide-in transition plays from the off-screen state.
    void historyDrawer.offsetWidth;
    historyBackdrop.classList.add("open");
    historyDrawer.classList.add("open");
    historyCloseBtn.focus();
  }

  function closeHistory() {
    historyBackdrop.classList.remove("open");
    historyDrawer.classList.remove("open");
    setTimeout(() => {
      if (!historyDrawer.classList.contains("open")) {
        historyBackdrop.hidden = true;
        historyDrawer.hidden = true;
      }
    }, 250);
  }

  historyOpenBtn.addEventListener("click", openHistory);
  historyCloseBtn.addEventListener("click", closeHistory);
  historyBackdrop.addEventListener("click", closeHistory);
  // Any click that isn't stopped by a kebab or an open menu closes all menus.
  document.addEventListener("click", closeAllMenus);
  document.addEventListener("click", closeProjectConfirm);
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    // An open confirm takes the Escape, so one press doesn't also shut the
    // drawer out from under the user.
    if (openProjectConfirm) {
      closeProjectConfirm();
      return;
    }
    if (historyDrawer.classList.contains("open")) {
      closeHistory();
    }
  });

  // New chat: clear all pages, the Result card, and reset the form to blank.
  function newChat() {
    // The next successful Analyze starts a fresh history entry rather than
    // updating whatever chat was open before.
    currentEntryId = null;
    clearPages();
    pasteInput.value = "";
    if (!imageLightbox.hidden) closeLightbox();

    outputOriginal.textContent = "";
    outputRewritten.textContent = "Rewritten text will show up here.";
    outputRewritten.classList.add("placeholder");
    outputRewritten.classList.remove("fade-in");
    // Stop first — stopSpeaking() re-enables the button, so disabling after it
    // is what leaves the reset card in the right state.
    if (isTtsBusy()) stopSpeaking();
    readAloudBtn.disabled = true;
    downloadBtn.disabled = true;

    quizPanel.hidden = true;
    quizBody.classList.remove("open");
    quizContent.textContent = "";

    switchTab("upload");
    setStatus("");
    updateSimplifyAvailability();
  }

  newChatBtn.addEventListener("click", newChat);

  refreshLanguageOptions();
  updateStepper();
})();
