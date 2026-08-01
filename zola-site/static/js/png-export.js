const MAX_CANVAS_DIMENSION = 16_384;
const MAX_CANVAS_PIXELS = 67_108_864;
const NON_RENDERED_TAGS = new Set(["NOSCRIPT", "SCRIPT", "STYLE", "TEMPLATE"]);

export class PngExportError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PngExportError";
    this.code = code;
  }
}

export function collectTextRuns(root, getColor) {
  const runs = [];
  const rootColor = getColor(root);

  function visit(node, inheritedColor) {
    if (node.nodeType === 3) {
      if (node.nodeValue) {
        runs.push({ text: node.nodeValue, color: inheritedColor });
      }
      return;
    }

    if (node.nodeType !== 1) return;
    if (NON_RENDERED_TAGS.has(node.tagName)) return;
    const color = getColor(node) || inheritedColor;
    for (const child of node.childNodes ?? []) {
      visit(child, color);
    }
  }

  visit(root, rootColor);
  return runs;
}

export function drawTextRuns(
  context,
  runs,
  { left, top, lineHeight, fontSize, tabSize = 8 },
) {
  const metrics = context.measureText("M");
  const ascent = metrics.actualBoundingBoxAscent || fontSize * 0.8;
  let x = left;
  let y = top + ascent;
  let column = 0;

  for (const run of runs) {
    context.fillStyle = run.color;
    const parts = run.text.split(/(\r\n|\r|\n|\t)/u);

    for (const part of parts) {
      if (!part) continue;
      if (part === "\r\n" || part === "\r" || part === "\n") {
        x = left;
        y += lineHeight;
        column = 0;
        continue;
      }
      if (part === "\t") {
        const spaces = tabSize - (column % tabSize);
        x += context.measureText(" ".repeat(spaces)).width;
        column += spaces;
        continue;
      }

      context.fillText(part, x, y);
      x += context.measureText(part).width;
      column += [...part].length;
    }
  }
}

function parsePixels(value, fallback = 0) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function backingScale(pixelRatio) {
  return Math.min(Math.max(pixelRatio || 1, 1), 2);
}

export async function renderTextArtCanvas(pre, options = {}) {
  if (!pre?.textContent?.trim()) {
    throw new PngExportError("EMPTY_OUTPUT", "Nothing to export");
  }

  const documentRef = options.documentRef ?? globalThis.document;
  await documentRef.fonts?.ready;

  const cssWidth = Math.max(pre.scrollWidth, pre.clientWidth);
  const cssHeight = Math.max(pre.scrollHeight, pre.clientHeight);
  const scale = backingScale(
    options.pixelRatio ?? globalThis.window?.devicePixelRatio ?? 1,
  );
  const width = Math.ceil(cssWidth * scale);
  const height = Math.ceil(cssHeight * scale);

  if (
    width > MAX_CANVAS_DIMENSION ||
    height > MAX_CANVAS_DIMENSION ||
    width * height > MAX_CANVAS_PIXELS
  ) {
    throw new PngExportError(
      "OUTPUT_TOO_LARGE",
      "Output is too large to export",
    );
  }

  const canvas = documentRef.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new PngExportError("CONTEXT_UNAVAILABLE", "Canvas 2D is unavailable");
  }

  const getStyle =
    options.getStyle ??
    documentRef.defaultView?.getComputedStyle.bind(documentRef.defaultView);
  const style = getStyle(pre);
  const rootStyle = getStyle(documentRef.documentElement);
  const fontSize = parsePixels(style.fontSize, 11);
  const lineHeight = parsePixels(style.lineHeight, fontSize * 1.2);
  const backgroundColor =
    options.backgroundColor ||
    rootStyle.getPropertyValue("--page-bg").trim() ||
    "#ffffff";

  context.scale(scale, scale);
  context.fillStyle = backgroundColor;
  context.fillRect(0, 0, cssWidth, cssHeight);
  context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  context.textBaseline = "alphabetic";

  const runs = collectTextRuns(
    pre,
    (node) => getStyle(node).color || style.color,
  );
  drawTextRuns(context, runs, {
    left: parsePixels(style.paddingLeft),
    top: parsePixels(style.paddingTop),
    lineHeight,
    fontSize,
  });

  return canvas;
}

export function canvasToPngBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new PngExportError("ENCODE_FAILED", "PNG encoding failed"));
      }
    }, "image/png");
  });
}

export function downloadPngBlob(
  blob,
  filename,
  {
    documentRef = globalThis.document,
    urlRef = globalThis.URL,
    setTimeoutRef = globalThis.setTimeout,
  } = {},
) {
  const url = urlRef.createObjectURL(blob);
  const anchor = documentRef.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.hidden = true;
  documentRef.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeoutRef(() => urlRef.revokeObjectURL(url), 0);
}
