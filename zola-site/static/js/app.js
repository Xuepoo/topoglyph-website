import init, {
  AtlasHandle,
  AnimationBuilder,
  decodeAnimation,
  render_image,
  renderWithAtlas,
} from "/wasm/topoglyph_wasm_engine.js";

// ---------------------------------------------------------------------------
// Shared state / boot
// ---------------------------------------------------------------------------

function t(key, params) {
  let s = (window.I18N && window.I18N[key]) || key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = s.split(`{${k}}`).join(String(v));
    }
  }
  return s;
}

let wasmReady = false;

async function boot() {
  try {
    await init();
    wasmReady = true;
    setImageStatus(t("js_ready"));
    setVideoStatus(t("js_ready"));
    setAtlasStatus(t("js_ready"));
    updateImageButtons();
    updateVideoButtons();
    updateAtlasButtons();
  } catch (e) {
    const msg = t("js_wasm_load_failed") + e;
    setImageStatus(msg, true);
    setVideoStatus(msg, true);
    setAtlasStatus(msg, true);
  }
}

function setStatusFor(elId, message, isError) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.innerHTML = message;
  el.classList.toggle("is-error", Boolean(isError));
}
const setImageStatus = (m, e) => setStatusFor("status-line", m, e);
const setVideoStatus = (m, e) => setStatusFor("video-status-line", m, e);
const setAtlasStatus = (m, e) => setStatusFor("atlas-status-line", m, e);

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const tab = btn.dataset.tab;
    document.querySelectorAll(".tab-btn").forEach((b) => {
      b.classList.toggle("is-active", b === btn);
    });
    document.querySelectorAll(".tab-panel").forEach((panel) => {
      panel.classList.toggle("is-hidden", panel.dataset.tabPanel !== tab);
    });
  });
});

// ---------------------------------------------------------------------------
// Charset control wiring (shared across the three scoped copies of the
// charset_controls.html partial: "", "video-", "atlas-")
// ---------------------------------------------------------------------------

function wireCharsetControls(prefix) {
  const charsetSelect = document.getElementById(`${prefix}opt-charset`);
  if (!charsetSelect) return;

  const customField = document.querySelector(
    `.custom-chars-field[data-scope="${prefix}"]`,
  );
  const fontField = document.querySelector(
    `.font-field[data-scope="${prefix}"]`,
  );
  const glyphModeField = document.querySelector(
    `.glyph-mode-field[data-scope="${prefix}"]`,
  );

  function updateVisibility() {
    const isBuiltinLines = charsetSelect.value === "lines";
    const isCustom = charsetSelect.value === "custom";
    if (customField) customField.style.display = isCustom ? "" : "none";
    if (fontField) fontField.style.display = isBuiltinLines ? "none" : "";
    if (glyphModeField)
      glyphModeField.style.display = isBuiltinLines ? "none" : "";
  }
  charsetSelect.addEventListener("change", updateVisibility);
  updateVisibility();
}
wireCharsetControls("");
wireCharsetControls("video-");
wireCharsetControls("atlas-");

/**
 * Reads a scoped set of charset controls and builds an AtlasHandle. Caches
 * nothing here — callers that need the same atlas across many calls (video
 * frame-by-frame conversion) should build it once themselves and hold the
 * handle, rather than calling this per-frame.
 */
async function buildAtlasFromControls(prefix) {
  const charset = document.getElementById(`${prefix}opt-charset`).value;
  if (charset !== "custom") {
    const fontInput = document.getElementById(`${prefix}opt-font`);
    const fontFile = fontInput?.files?.[0];
    if (!fontFile) {
      return AtlasHandle.builtin(charset);
    }
  }
  
  const customChars = document.getElementById(`${prefix}opt-custom-chars`)?.value || "";
  const fontInput = document.getElementById(`${prefix}opt-font`);
  const fontFile = fontInput?.files?.[0];
  if (!fontFile) {
    throw new Error(t("js_font_needed"));
  }
  const fontBytes = new Uint8Array(await fontFile.arrayBuffer());
  return AtlasHandle.fromFont(charset, customChars, fontBytes);
}

function charsetLabel(charset) {
  switch (charset) {
    case "ascii":
      return t("js_charset_ascii");
    case "blocks":
      return t("js_charset_blocks");
    case "braille":
      return t("js_charset_braille");
    case "custom":
      return t("js_charset_custom");
    default:
      return charset;
  }
}

// ---------------------------------------------------------------------------
// Image mode
// ---------------------------------------------------------------------------

let imageBytes = null;

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("file-input");
const filenameEl = document.getElementById("filename");
const btnRender = document.getElementById("btn-render");
const btnCopyText = document.getElementById("btn-copy-text");
const btnCopyHtml = document.getElementById("btn-copy-html");
const btnDownloadPng = document.getElementById("btn-download-png");
const outputPre = document.getElementById("output-pre");
const outputMeta = document.getElementById("output-meta");

function updateImageButtons() {
  btnRender.disabled = !wasmReady || imageBytes === null;
}

function bindRangeDisplay(rangeId, displayId) {
  const range = document.getElementById(rangeId);
  const display = document.getElementById(displayId);
  if (!range || !display) return;
  range.addEventListener("input", () => {
    display.textContent = range.value;
  });
}
bindRangeDisplay("opt-tolerance", "val-tolerance");
bindRangeDisplay("opt-chaikin", "val-chaikin");
bindRangeDisplay("opt-topk", "val-topk");
bindRangeDisplay("opt-relaxation", "val-relaxation");
bindRangeDisplay("video-opt-fps", "video-opt-fps-value");

function wireDropzone(dropzoneEl, fileInputEl, onFile) {
  dropzoneEl.addEventListener("click", () => fileInputEl.click());
  fileInputEl.addEventListener("change", (e) => onFile(e.target.files[0]));
  ["dragenter", "dragover"].forEach((evt) => {
    dropzoneEl.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzoneEl.classList.add("is-dragover");
    });
  });
  ["dragleave", "drop"].forEach((evt) => {
    dropzoneEl.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzoneEl.classList.remove("is-dragover");
    });
  });
  dropzoneEl.addEventListener("drop", (e) => {
    const file = e.dataTransfer.files[0];
    if (file) onFile(file);
  });
}

async function handleImageFile(file) {
  if (!file) return;
  imageBytes = new Uint8Array(await file.arrayBuffer());
  filenameEl.textContent = file.name;
  updateImageButtons();
  setImageStatus(t("js_ready"));

  // Auto-calculate aspect ratio
  if (file.type.startsWith('image/')) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const aspectRatio = img.naturalWidth / img.naturalHeight;
      // Characters are 1:2 aspect ratio, so grid_width = grid_height * aspectRatio * 2
      // We'll keep width at 120 and scale height, clamped between 10 and 200.
      const targetWidth = 120;
      let targetHeight = Math.round(targetWidth / (aspectRatio * 2));
      targetHeight = Math.max(10, Math.min(targetHeight, 200));
      
      const widthInput = document.getElementById('opt-width');
      const heightInput = document.getElementById('opt-height');
      if (widthInput && heightInput) {
        widthInput.value = targetWidth;
        heightInput.value = targetHeight;
      }
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }
}

wireDropzone(dropzone, fileInput, handleImageFile);

// Paste support
document.addEventListener("paste", (e) => {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) {
        // Automatically switch to Image tab if paste happens
        const imageTabBtn = document.querySelector('.tab-btn[data-tab="image"]');
        if (imageTabBtn && !imageTabBtn.classList.contains('is-active')) {
          imageTabBtn.click();
        }
        handleImageFile(file);
        break; // Only handle the first image
      }
    }
  }
});

function readImageRenderOptions(prefix) {
  return {
    width: parseInt(document.getElementById(`${prefix}opt-width`).value, 10),
    height: parseInt(document.getElementById(`${prefix}opt-height`).value, 10),
    tolerance: parseFloat(
      document.getElementById(`${prefix}opt-tolerance`)?.value ?? "0.5",
    ),
    chaikin_iters: parseInt(
      document.getElementById(`${prefix}opt-chaikin`)?.value ?? "1",
      10,
    ),
    invert: document.getElementById(`${prefix}opt-invert`)?.checked ?? false,
    color: document.getElementById(`${prefix}opt-color`)?.checked ?? false,
    top_k: parseInt(
      document.getElementById(`${prefix}opt-top-k`)?.value ?? "8",
      10,
    ),
    relaxation_rounds: parseInt(
      document.getElementById(`${prefix}opt-relaxation`)?.value ?? "3",
      10,
    ),
    preset: document.getElementById(`${prefix}opt-preset`).value,
    glyph_mode:
      document.getElementById(`${prefix}opt-glyph-mode`)?.value ?? "set",
    output_format: document.getElementById(`${prefix}opt-color`)?.checked
      ? "html"
      : "text",
  };
}

btnRender.addEventListener("click", async () => {
  if (!imageBytes) return;
  btnRender.disabled = true;
  setImageStatus(t("js_rendering"));

  try {
    const options = readImageRenderOptions("");
    const start = performance.now();

    let result;
    const charset = document.getElementById("opt-charset").value;
    if (charset === "lines") {
      result = render_image(imageBytes, options);
    } else {
      const atlas = await buildAtlasFromControls("");
      result = renderWithAtlas(imageBytes, options, atlas);
    }
    const elapsed = (performance.now() - start).toFixed(0);

    outputPre.classList.remove("empty-state");
    if (options.output_format === "html") {
      outputPre.innerHTML = result.text;
    } else {
      outputPre.textContent = result.text;
    }
    outputMeta.textContent = `${result.columns}x${result.rows} \u00b7 ${elapsed}ms`;
    btnCopyText.disabled = false;
    btnCopyHtml.disabled = false;
    btnDownloadPng.disabled = false;
    setImageStatus(t("js_ready"));
  } catch (e) {
    setImageStatus(t("js_render_failed") + (e?.message ?? e), true);
  } finally {
    updateImageButtons();
  }
});

btnCopyText.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(outputPre.textContent);
    setImageStatus(t("js_copied"));
  } catch (e) {
    setImageStatus(t("js_copy_failed") + (e?.message ?? e), true);
  }
});

btnCopyHtml.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(outputPre.innerHTML);
    setImageStatus(t("js_copied"));
  } catch (e) {
    setImageStatus(t("js_copy_failed") + (e?.message ?? e), true);
  }
});

btnDownloadPng.addEventListener("click", () => {
  setImageStatus("Rendering PNG...");
  const width = outputPre.offsetWidth;
  const height = outputPre.offsetHeight;
  
  // Get computed styles to preserve accurate look
  const computedStyle = window.getComputedStyle(outputPre);
  const bgColor = window.getComputedStyle(document.documentElement).getPropertyValue('--page-bg') || '#121212';
  const textColor = window.getComputedStyle(document.documentElement).getPropertyValue('--ink') || '#e8e8e8';
  const fontFamily = computedStyle.fontFamily.replace(/"/g, "'");
  const fontSize = computedStyle.fontSize;
  const lineHeight = computedStyle.lineHeight;
  
  const htmlStr = new XMLSerializer().serializeToString(outputPre);
  
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <foreignObject width="100%" height="100%">
        <div xmlns="http://www.w3.org/1999/xhtml">
          <style>
            pre {
              margin: 0;
              padding: 20px;
              font-family: ${fontFamily};
              font-size: ${fontSize};
              line-height: ${lineHeight};
              color: ${textColor};
              white-space: pre;
              background: ${bgColor};
              width: 100%;
              height: 100%;
              box-sizing: border-box;
            }
          </style>
          ${htmlStr}
        </div>
      </foreignObject>
    </svg>
  `;
  
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0);
    URL.revokeObjectURL(url);
    
    const pngUrl = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = pngUrl;
    a.download = "topoglyph-output.png";
    a.click();
    setImageStatus(t("js_ready"));
  };
  img.onerror = () => {
    setImageStatus("Failed to render PNG", true);
    URL.revokeObjectURL(url);
  };
  img.src = url;
});

// Zoom support for editor view
let currentZoom = 11; // Matches 11px default in CSS
outputPre.addEventListener("wheel", (e) => {
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    if (e.deltaY < 0) {
      currentZoom = Math.min(currentZoom + 1, 48);
    } else {
      currentZoom = Math.max(currentZoom - 1, 4);
    }
    outputPre.style.fontSize = `${currentZoom}px`;
  }
});

// ---------------------------------------------------------------------------
// Video / GIF mode
// ---------------------------------------------------------------------------

let videoFile = null;
let lastTglyphText = "";
let playbackTimer = null;
let playbackFrameIndex = 0;
let decodedPlayback = null;
let isPlaying = false;

const videoDropzone = document.getElementById("dropzone-video");
const videoFileInput = document.getElementById("file-input-video");
const videoFilenameEl = document.getElementById("filename-video");
const videoEl = document.getElementById("video-source");
const frameCanvas = document.getElementById("video-frame-canvas");
const btnConvertVideo = document.getElementById("btn-convert-video");
const btnDownloadTglyph = document.getElementById("btn-download-tglyph");
const btnPlayPause = document.getElementById("btn-play-pause");
const videoOutputPre = document.getElementById("video-output-pre");
const videoOutputMeta = document.getElementById("video-output-meta");
const progressTrack = document.getElementById("video-progress-track");
const progressFill = document.getElementById("video-progress-fill");

function updateVideoButtons() {
  btnConvertVideo.disabled = !wasmReady || videoFile === null;
}

wireDropzone(videoDropzone, videoFileInput, (file) => {
  if (!file) return;
  videoFile = file;
  videoFilenameEl.textContent = file.name;
  updateVideoButtons();
  setVideoStatus(t("js_ready"));
});

/**
 * Grabs `sampleFps` frames per second of `file` (a <video>-decodable video,
 * or an animated GIF — Chromium/Firefox both play GIFs through the same
 * <video> element) by seeking through its duration and drawing each frame
 * onto an offscreen canvas, yielding PNG bytes one at a time. There is no
 * in-browser FFmpeg: this is genuinely all the native <video>/<canvas>
 * decoding the browser already has, matching the module docs on
 * `AnimationBuilder`.
 */
async function* extractFrames(file, sampleFps) {
  const url = URL.createObjectURL(file);
  try {
    videoEl.src = url;
    await new Promise((resolve, reject) => {
      videoEl.onloadedmetadata = resolve;
      videoEl.onerror = () => reject(new Error(t("js_decode_failed")));
    });

    const duration = videoEl.duration;
    const totalFrames = Math.max(1, Math.floor(duration * sampleFps));
    frameCanvas.width = videoEl.videoWidth;
    frameCanvas.height = videoEl.videoHeight;
    const ctx = frameCanvas.getContext("2d");

    for (let i = 0; i < totalFrames; i++) {
      const t = i / sampleFps;
      await new Promise((resolve) => {
        videoEl.onseeked = resolve;
        videoEl.currentTime = Math.min(t, Math.max(duration - 0.001, 0));
      });
      ctx.drawImage(videoEl, 0, 0, frameCanvas.width, frameCanvas.height);
      const blob = await new Promise((resolve) =>
        frameCanvas.toBlob(resolve, "image/png"),
      );
      const bytes = new Uint8Array(await blob.arrayBuffer());
      yield { bytes, index: i, total: totalFrames };
    }
  } finally {
    URL.revokeObjectURL(url);
  }
}

btnConvertVideo.addEventListener("click", async () => {
  if (!videoFile) return;
  btnConvertVideo.disabled = true;
  btnDownloadTglyph.disabled = true;
  btnPlayPause.disabled = true;
  stopPlayback();
  progressTrack.style.display = "";
  progressFill.style.width = "0%";
  setVideoStatus(t("js_extracting"));

  try {
    const atlas = await buildAtlasFromControls("video-");
    const builder = new AnimationBuilder();
    const sampleFps = parseInt(
      document.getElementById("video-opt-fps").value,
      10,
    );
    const options = readImageRenderOptions("video-");

    let lastTotal = 1;
    for await (const frame of extractFrames(videoFile, sampleFps)) {
      builder.pushFrame(frame.bytes, options, atlas);
      lastTotal = frame.total;
      const pct = Math.round(((frame.index + 1) / frame.total) * 100);
      progressFill.style.width = pct + "%";
      setVideoStatus(
        t("js_converting_frame", {
          current: frame.index + 1,
          total: frame.total,
        }),
      );
    }

    setVideoStatus(t("js_encoding"));
    lastTglyphText = builder.finish(sampleFps, options.color);

    decodedPlayback = decodeAnimation(lastTglyphText);
    playbackFrameIndex = 0;
    renderPlaybackFrame();

    videoOutputMeta.textContent = `${decodedPlayback.width}x${decodedPlayback.height} \u00b7 ${decodedPlayback.frames.length} ${t("js_frames_meta")} \u00b7 ${(lastTglyphText.length / 1024).toFixed(1)}KB`;
    btnDownloadTglyph.disabled = false;
    btnPlayPause.disabled = false;
    setVideoStatus(t("js_done", { count: lastTotal }));
  } catch (e) {
    setVideoStatus(t("js_conversion_failed") + (e?.message ?? e), true);
  } finally {
    updateVideoButtons();
    progressTrack.style.display = "none";
  }
});

function renderPlaybackFrame() {
  if (!decodedPlayback) return;
  videoOutputPre.classList.remove("empty-state");
  videoOutputPre.textContent = decodedPlayback.frames[playbackFrameIndex];
}

function stopPlayback() {
  isPlaying = false;
  btnPlayPause.textContent = t("js_play");
  if (playbackTimer !== null) {
    clearTimeout(playbackTimer);
    playbackTimer = null;
  }
}

function stepPlayback() {
  if (!isPlaying || !decodedPlayback) return;
  playbackFrameIndex = (playbackFrameIndex + 1) % decodedPlayback.frames.length;
  renderPlaybackFrame();
  const frameDurationMs = 1000 / Math.max(decodedPlayback.fps, 1);
  playbackTimer = setTimeout(stepPlayback, frameDurationMs);
}

btnPlayPause.addEventListener("click", () => {
  if (!decodedPlayback) return;
  if (isPlaying) {
    stopPlayback();
  } else {
    isPlaying = true;
    btnPlayPause.textContent = t("js_pause");
    stepPlayback();
  }
});

btnDownloadTglyph.addEventListener("click", () => {
  const blob = new Blob([lastTglyphText], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "topoglyph-animation.tglyph";
  a.click();
  URL.revokeObjectURL(url);
});

// ---------------------------------------------------------------------------
// Glyph atlas preview mode
// ---------------------------------------------------------------------------

const btnInspectAtlas = document.getElementById("btn-inspect-atlas");
const glyphGrid = document.getElementById("glyph-grid");
const atlasOutputMeta = document.getElementById("atlas-output-meta");

function updateAtlasButtons() {
  btnInspectAtlas.disabled = !wasmReady;
}

function renderGlyphMask(bits) {
  // bits is a flat 16x32 boolean array, row-major.
  const svgNs = "http://www.w3.org/2000/svg";
  const cell = 3;
  const svg = document.createElementNS(svgNs, "svg");
  svg.setAttribute("width", 16 * cell);
  svg.setAttribute("height", 32 * cell);
  svg.setAttribute("viewBox", `0 0 ${16 * cell} ${32 * cell}`);
  svg.classList.add("glyph-mask");

  const bg = document.createElementNS(svgNs, "rect");
  bg.setAttribute("width", 16 * cell);
  bg.setAttribute("height", 32 * cell);
  bg.setAttribute("fill", "#fff");
  svg.appendChild(bg);

  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 16; x++) {
      if (bits[y * 16 + x]) {
        const rect = document.createElementNS(svgNs, "rect");
        rect.setAttribute("x", x * cell);
        rect.setAttribute("y", y * cell);
        rect.setAttribute("width", cell);
        rect.setAttribute("height", cell);
        rect.setAttribute("fill", "#1b1b18");
        svg.appendChild(rect);
      }
    }
  }
  return svg;
}

function renderGlyphCards(summary) {
  glyphGrid.innerHTML = "";
  for (const glyph of summary.glyphs) {
    const card = document.createElement("div");
    card.className = "glyph-card";

    const tokenEl = document.createElement("div");
    tokenEl.className = "glyph-token";
    tokenEl.textContent = glyph.token || "\u2423"; // visible placeholder for space
    card.appendChild(tokenEl);

    card.appendChild(renderGlyphMask(glyph.mask_bits));

    const meta = document.createElement("div");
    meta.className = "glyph-meta";
    meta.innerHTML = `
      <div>${t("js_ports_meta")}: ${glyph.ports.join(", ") || "none"}</div>
      <div>${t("js_width_meta")}: ${glyph.cell_width}</div>
      <div>${t("js_density_meta")}: ${glyph.density.toFixed(2)}</div>
      <div>${t("js_curvature_meta")}: ${glyph.curvature.toFixed(2)}</div>
      <div>${t("js_strokes_meta")}: ${glyph.stroke_count}</div>
    `;
    card.appendChild(meta);

    glyphGrid.appendChild(card);
  }
}

btnInspectAtlas.addEventListener("click", async () => {
  btnInspectAtlas.disabled = true;
  setAtlasStatus(t("js_building_atlas"));
  try {
    const atlas = await buildAtlasFromControls("atlas-");
    const summary = atlas.inspect();
    renderGlyphCards(summary);
    atlasOutputMeta.textContent = `${summary.font_id} \u00b7 ${summary.glyphs.length} ${t("js_glyphs_meta")}`;
    setAtlasStatus(t("js_ready"));
  } catch (e) {
    setAtlasStatus(t("js_inspect_failed") + (e?.message ?? e), true);
  } finally {
    updateAtlasButtons();
  }
});

boot();
