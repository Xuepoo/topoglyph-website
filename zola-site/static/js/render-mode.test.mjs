import assert from "node:assert/strict";
import test from "node:test";

import { RENDER_MODES, normalizeRenderModeOptions, visibleForMode } from "./render-mode.js";

test("all three render modes are known", () => {
  assert.deepEqual(RENDER_MODES, ["match", "rounded", "centerline"]);
});

test("visibleForMode matches the data-mode-when attribute", () => {
  assert.equal(visibleForMode("rounded", "rounded centerline"), true);
  assert.equal(visibleForMode("match", "rounded centerline"), false);
  assert.equal(visibleForMode("rounded", "rounded"), true);
  assert.equal(visibleForMode("centerline", "rounded"), false);
  assert.equal(visibleForMode("match", ""), false);
  assert.equal(visibleForMode("match", undefined), false);
});

test("unknown modes fall back to match", () => {
  assert.equal(normalizeRenderModeOptions("bogus", {}).render_mode, "match");
  assert.equal(normalizeRenderModeOptions(undefined, {}).render_mode, "match");
});

test("threshold is clamped into the 1..=255 range the engine accepts", () => {
  assert.equal(normalizeRenderModeOptions("rounded", { threshold: 0 }).threshold, 1);
  assert.equal(normalizeRenderModeOptions("rounded", { threshold: 999 }).threshold, 255);
  assert.equal(normalizeRenderModeOptions("rounded", { threshold: "77" }).threshold, 77);
  assert.equal(normalizeRenderModeOptions("rounded", {}).threshold, 128);
  assert.equal(normalizeRenderModeOptions("rounded", { threshold: "x" }).threshold, 128);
});

test("min_region_area only survives in rounded mode", () => {
  assert.equal(normalizeRenderModeOptions("rounded", { min_region_area: 3 }).min_region_area, 3);
  assert.equal(normalizeRenderModeOptions("centerline", { min_region_area: 3 }).min_region_area, 0);
  assert.equal(normalizeRenderModeOptions("match", { min_region_area: 3 }).min_region_area, 0);
  assert.equal(normalizeRenderModeOptions("rounded", { min_region_area: -5 }).min_region_area, 0);
});

test("crop is dropped for the match pipeline", () => {
  assert.equal(normalizeRenderModeOptions("match", { crop: true }).crop, false);
  assert.equal(normalizeRenderModeOptions("rounded", { crop: true }).crop, true);
  assert.equal(normalizeRenderModeOptions("centerline", { crop: true }).crop, true);
});

test("padding and trim are passed through", () => {
  const padded = normalizeRenderModeOptions("rounded", { padding: 2, trim: false });
  assert.equal(padded.padding, 2);
  assert.equal(padded.trim, false);
  assert.equal(normalizeRenderModeOptions("rounded", { padding: -1 }).padding, 0);
  assert.equal(normalizeRenderModeOptions("rounded", { padding: 5000 }).padding, 1024);
  assert.equal(normalizeRenderModeOptions("rounded", { trim: true }).trim, true);
});

test("foreground defaults to auto", () => {
  assert.equal(normalizeRenderModeOptions("rounded", {}).foreground, "auto");
  assert.equal(normalizeRenderModeOptions("rounded", { foreground: "alpha" }).foreground, "alpha");
});
