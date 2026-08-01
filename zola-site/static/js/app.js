import init, {
  AtlasHandle,
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
    setAtlasStatus(t("js_ready"));
    updateImageButtons();
    updateAtlasButtons();
  } catch (e) {
    const msg = t("js_wasm_load_failed") + e;
    setImageStatus(msg, true);
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
    if (fontField) fontField.style.display = isCustom ? "" : "none";
    if (glyphModeField)
      glyphModeField.style.display = isCustom ? "" : "none";
  }
  charsetSelect.addEventListener("change", updateVisibility);
  updateVisibility();
}
wireCharsetControls("");
wireCharsetControls("atlas-");

/**
 * Reads a scoped set of charset controls and builds an AtlasHandle.
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
  const wStr = document.getElementById(`${prefix}opt-width`).value;
  const hStr = document.getElementById(`${prefix}opt-height`).value;
  return {
    width: wStr ? parseInt(wStr, 10) : null,
    height: hStr ? parseInt(hStr, 10) : null,
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
// Reset size button
// ---------------------------------------------------------------------------
document.getElementById("btn-reset-size")?.addEventListener("click", () => {
  document.getElementById("opt-width").value = "";
  document.getElementById("opt-height").value = "";
  saveState();
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

function saveState() {
  const state = {};
  document.querySelectorAll('input[id*="opt-"], select[id*="opt-"]').forEach(el => {
    if (el.type === 'file') return;
    state[el.id] = el.type === 'checkbox' ? el.checked : el.value;
  });
  const activeTab = document.querySelector('.tab-btn.is-active')?.dataset.tab;
  if (activeTab) state._activeTab = activeTab;
  localStorage.setItem('topoglyph-state', JSON.stringify(state));
}
function restoreState() {
  try {
    const raw = localStorage.getItem('topoglyph-state');
    if (!raw) return;
    const state = JSON.parse(raw);
    Object.entries(state).forEach(([id, val]) => {
      if (id === '_activeTab') {
        const btn = document.querySelector(`.tab-btn[data-tab="${val}"]`);
        if (btn) btn.click();
        return;
      }
      const el = document.getElementById(id);
      if (!el) return;
      if (el.type === 'checkbox') el.checked = val;
      else el.value = val;
      el.dispatchEvent(new Event('input'));
      el.dispatchEvent(new Event('change'));
    });
  } catch (e) {}
}
document.querySelectorAll('input[id*="opt-"], select[id*="opt-"]').forEach(el => {
  el.addEventListener('change', saveState);
  el.addEventListener('input', saveState);
});
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', saveState);
});
restoreState();
boot();
const btnFullscreen = document.getElementById("btn-fullscreen");
if (btnFullscreen) {
  btnFullscreen.addEventListener("click", () => {
    const editorArea = document.querySelector(".editor-area");
    if (!document.fullscreenElement) {
      editorArea.requestFullscreen().catch(err => {});
    } else {
      document.exitFullscreen();
    }
  });
}

