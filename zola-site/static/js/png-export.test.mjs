import assert from "node:assert/strict";
import test from "node:test";

import {
  PngExportError,
  canvasToPngBlob,
  collectTextRuns,
  drawTextRuns,
  renderTextArtCanvas,
} from "./png-export.js";

function text(value) {
  return { nodeType: 3, nodeValue: value };
}

function element(color, ...childNodes) {
  return { nodeType: 1, color, childNodes };
}

function taggedElement(tagName, color, ...childNodes) {
  return { nodeType: 1, tagName, color, childNodes };
}

function recordingContext() {
  const calls = [];
  return {
    calls,
    fillStyle: "",
    font: "",
    textBaseline: "",
    fillRect(...args) {
      calls.push({ method: "fillRect", args, color: this.fillStyle });
    },
    fillText(value, x, y) {
      calls.push({ method: "fillText", value, x, y, color: this.fillStyle });
    },
    measureText(value) {
      return { width: [...value].length * 10, actualBoundingBoxAscent: 8 };
    },
    scale(x, y) {
      calls.push({ method: "scale", args: [x, y] });
    },
  };
}

test("collectTextRuns preserves nested inline colors and line breaks", () => {
  const root = element(
    "black",
    text("A"),
    element("red", text("B\n")),
    text("C"),
  );

  assert.deepEqual(
    collectTextRuns(root, (node) => node.color),
    [
      { text: "A", color: "black" },
      { text: "B\n", color: "red" },
      { text: "C", color: "black" },
    ],
  );
});

test("collectTextRuns ignores non-rendered style and script contents", () => {
  const root = element(
    "black",
    taggedElement("STYLE", "black", text("pre{font-family:monospace}")),
    text("visible"),
    taggedElement("SCRIPT", "black", text("alert('hidden')")),
  );

  assert.deepEqual(
    collectTextRuns(root, (node) => node.color),
    [{ text: "visible", color: "black" }],
  );
});

test("drawTextRuns expands tabs and advances by computed line height", () => {
  const context = recordingContext();

  drawTextRuns(
    context,
    [
      { text: "ab\t", color: "black" },
      { text: "c\nd", color: "red" },
    ],
    { left: 2, top: 4, lineHeight: 12, fontSize: 10, tabSize: 4 },
  );

  assert.deepEqual(
    context.calls.filter((call) => call.method === "fillText"),
    [
      { method: "fillText", value: "ab", x: 2, y: 12, color: "black" },
      { method: "fillText", value: "c", x: 42, y: 12, color: "red" },
      { method: "fillText", value: "d", x: 2, y: 24, color: "red" },
    ],
  );
});

test("renderTextArtCanvas uses scroll bounds and clamps backing scale", async () => {
  const context = recordingContext();
  const canvas = { style: {}, getContext: () => context };
  const root = element("black", text("AB\nCD"));
  Object.assign(root, {
    textContent: "AB\nCD",
    scrollWidth: 120,
    clientWidth: 100,
    scrollHeight: 60,
    clientHeight: 50,
  });
  let fontsReadyRead = false;
  const documentRef = {
    documentElement: {},
    fonts: {
      get ready() {
        fontsReadyRead = true;
        return Promise.resolve();
      },
    },
    createElement: (tag) => {
      assert.equal(tag, "canvas");
      return canvas;
    },
  };
  const preStyle = {
    color: "rgb(1, 2, 3)",
    fontStyle: "normal",
    fontWeight: "400",
    fontSize: "10px",
    fontFamily: "monospace",
    lineHeight: "12px",
    paddingLeft: "4px",
    paddingTop: "6px",
  };
  const rootStyle = {
    getPropertyValue: (name) => (name === "--page-bg" ? "#ffffff" : ""),
  };

  const result = await renderTextArtCanvas(root, {
    documentRef,
    getStyle: (node) =>
      node === documentRef.documentElement ? rootStyle : preStyle,
    pixelRatio: 3,
  });

  assert.equal(result, canvas);
  assert.equal(fontsReadyRead, true);
  assert.equal(canvas.width, 240);
  assert.equal(canvas.height, 120);
  assert.equal(canvas.style.width, "120px");
  assert.equal(canvas.style.height, "60px");
  assert.deepEqual(context.calls[0], { method: "scale", args: [2, 2] });
  assert.deepEqual(context.calls[1], {
    method: "fillRect",
    args: [0, 0, 120, 60],
    color: "#ffffff",
  });
});

test("renderTextArtCanvas rejects blank output", async () => {
  const root = element("black", text("  \n"));
  Object.assign(root, {
    textContent: "  \n",
    scrollWidth: 100,
    clientWidth: 100,
    scrollHeight: 50,
    clientHeight: 50,
  });

  await assert.rejects(
    renderTextArtCanvas(root, {
      documentRef: { fonts: { ready: Promise.resolve() }, documentElement: {} },
    }),
    (error) => error instanceof PngExportError && error.code === "EMPTY_OUTPUT",
  );
});

test("renderTextArtCanvas rejects unsafe backing dimensions", async () => {
  const root = element("black", text("A"));
  Object.assign(root, {
    textContent: "A",
    scrollWidth: 9_000,
    clientWidth: 9_000,
    scrollHeight: 100,
    clientHeight: 100,
  });

  await assert.rejects(
    renderTextArtCanvas(root, {
      documentRef: { fonts: { ready: Promise.resolve() }, documentElement: {} },
      pixelRatio: 2,
    }),
    (error) =>
      error instanceof PngExportError && error.code === "OUTPUT_TOO_LARGE",
  );
});

test("canvasToPngBlob resolves PNG data and rejects encoder failure", async () => {
  const blob = { size: 42, type: "image/png" };
  assert.equal(
    await canvasToPngBlob({
      toBlob: (callback, type) => callback(type === "image/png" ? blob : null),
    }),
    blob,
  );

  await assert.rejects(
    canvasToPngBlob({ toBlob: (callback) => callback(null) }),
    (error) =>
      error instanceof PngExportError && error.code === "ENCODE_FAILED",
  );
});
