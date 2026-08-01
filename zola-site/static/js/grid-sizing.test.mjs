import assert from "node:assert/strict";
import test from "node:test";

import { describeGridSizing } from "./grid-sizing.js";

test("blank dimensions use 120 columns and aspect-derived rows", () => {
  assert.deepEqual(describeGridSizing("", ""), {
    kind: "auto",
    key: "js_grid_auto_size",
    params: { columns: 120 },
  });
});

test("an explicit width keeps rows aspect-derived", () => {
  assert.deepEqual(describeGridSizing("160", ""), {
    kind: "auto",
    key: "js_grid_auto_size",
    params: { columns: 160 },
  });
});

test("an explicit height fixes the effective grid", () => {
  assert.deepEqual(describeGridSizing("", "60"), {
    kind: "fixed",
    key: "js_grid_fixed_size",
    params: { columns: 120, rows: 60 },
  });

  assert.deepEqual(describeGridSizing("100", "40"), {
    kind: "fixed",
    key: "js_grid_fixed_size",
    params: { columns: 100, rows: 40 },
  });
});
