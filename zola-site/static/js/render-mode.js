// ---------------------------------------------------------------------------
// Render-mode helpers shared by app.js and its unit tests.
//
// TopoGlyph 0.4.0 added `--render-mode match|rounded|centerline` plus a set of
// line-art knobs (foreground, threshold, min-region-area, crop, trim, padding).
// The CLI rejects impossible combinations, and the wasm bridge mirrors those
// checks, so the UI must only ever send valid combinations — that normalizing
// step lives here so it can be tested without a DOM.
// ---------------------------------------------------------------------------

export const RENDER_MODES = ["match", "rounded", "centerline"];

/**
 * Whether a control tagged `data-mode-when="<modes>"` is visible in `mode`.
 */
export function visibleForMode(mode, modeWhen) {
  return String(modeWhen ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .includes(mode);
}

function clampInt(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

/**
 * Normalizes the raw control values into the option subset the wasm engine
 * accepts, mirroring `topoglyph-cli render`:
 *
 * - `render_mode` falls back to `match` for anything unknown.
 * - `threshold` is a 1..=255 coverage cut-off (the CLI rejects 0).
 * - `min_region_area` only exists for `rounded`, otherwise it is dropped.
 * - `crop` only exists for `rounded`/`centerline`, otherwise it is dropped.
 * - `padding` is a non-negative cell count and implies trimming.
 */
export function normalizeRenderModeOptions(mode, raw) {
  const renderMode = RENDER_MODES.includes(mode) ? mode : "match";
  const minRegionArea = clampInt(raw?.min_region_area, 0, 4096, 0);
  return {
    render_mode: renderMode,
    foreground: raw?.foreground || "auto",
    threshold: clampInt(raw?.threshold, 1, 255, 128),
    min_region_area: renderMode === "rounded" ? minRegionArea : 0,
    crop: renderMode !== "match" && Boolean(raw?.crop),
    trim: Boolean(raw?.trim),
    padding: clampInt(raw?.padding, 0, 1024, 0),
  };
}
