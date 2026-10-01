// Small, dependency-free helpers kept separate from main.js so they can be
// unit-tested with Node's built-in test runner (no DOM/Vite env required).

export function esc(s = "") {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Human-readable file size, used by low-data "tap to load" media placeholders
// so people on metered connections can see the cost before downloading.
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unitIndex]}`;
}

export function isOfflineError(err, online = typeof navigator === "undefined" ? true : navigator.onLine) {
  return !online || err?.name === "ConnectionError" || /network|fetch/i.test(err?.message || "");
}
