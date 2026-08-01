import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateCellAspect,
  measureOutputCellAspect,
} from "./output-aspect.js";

test("calculateCellAspect resolves a measured monospace cell ratio", () => {
  assert.equal(calculateCellAspect(84, 14, 10), 0.6);
});

test("calculateCellAspect rejects invalid or implausible measurements", () => {
  for (const args of [
    [0, 14, 10],
    [84, 0, 10],
    [84, 14, 0],
    [Number.NaN, 14, 10],
    [154, 14, 10],
  ]) {
    assert.equal(calculateCellAspect(...args), 0.5);
  }
});

test("measureOutputCellAspect measures and removes its browser probe", () => {
  let appended = null;
  let removed = false;
  const probe = {
    className: "",
    textContent: "",
    getBoundingClientRect: () => ({ width: 84, height: 14 }),
    remove: () => {
      removed = true;
    },
  };
  const documentRef = {
    createElement: (tagName) => {
      assert.equal(tagName, "span");
      return probe;
    },
    body: {
      append: (element) => {
        appended = element;
      },
    },
  };

  assert.equal(measureOutputCellAspect(documentRef), 0.6);
  assert.equal(probe.className, "output-cell-probe");
  assert.equal(probe.textContent, "0000000000");
  assert.equal(appended, probe);
  assert.equal(removed, true);
});
