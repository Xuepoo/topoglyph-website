const FALLBACK_CELL_ASPECT = 0.5;
const MIN_CELL_ASPECT = 0.25;
const MAX_CELL_ASPECT = 1;
const PROBE_CHARACTERS = "0000000000";

export function calculateCellAspect(totalWidth, lineHeight, sampleCount) {
  if (
    !Number.isFinite(totalWidth) ||
    !Number.isFinite(lineHeight) ||
    !Number.isFinite(sampleCount) ||
    totalWidth <= 0 ||
    lineHeight <= 0 ||
    sampleCount <= 0
  ) {
    return FALLBACK_CELL_ASPECT;
  }

  const aspect = totalWidth / sampleCount / lineHeight;
  return aspect >= MIN_CELL_ASPECT && aspect <= MAX_CELL_ASPECT
    ? aspect
    : FALLBACK_CELL_ASPECT;
}

export function measureOutputCellAspect(documentRef = document) {
  const probe = documentRef.createElement("span");
  probe.className = "output-cell-probe";
  probe.textContent = PROBE_CHARACTERS;
  documentRef.body.append(probe);

  try {
    const bounds = probe.getBoundingClientRect();
    return calculateCellAspect(
      bounds.width,
      bounds.height,
      PROBE_CHARACTERS.length,
    );
  } finally {
    probe.remove();
  }
}
