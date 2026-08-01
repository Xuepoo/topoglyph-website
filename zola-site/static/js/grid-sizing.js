const DEFAULT_COLUMNS = 120;

function parseDimension(value) {
  if (value === "") return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function describeGridSizing(widthValue, heightValue) {
  const columns = parseDimension(widthValue) ?? DEFAULT_COLUMNS;
  const rows = parseDimension(heightValue);

  if (rows === null) {
    return {
      kind: "auto",
      key: "js_grid_auto_size",
      params: { columns },
    };
  }

  return {
    kind: "fixed",
    key: "js_grid_fixed_size",
    params: { columns, rows },
  };
}
