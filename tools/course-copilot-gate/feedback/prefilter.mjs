const DEFECT_RE =
  /\b(wrong|incorrect|error|bug|broken|contradict|contradicts|typo|missing step|quiz is|cannot run|doesn't work|does not work|outdated|factually)\b/i;

/**
 * Cheap gate before enqueue. Explicit feedback always passes when text non-empty.
 * Passive requires a defect-ish claim; default no.
 */
export function shouldEnqueuePassive({ source, text } = {}) {
  const t = text != null ? String(text).trim() : "";
  if (!t) return false;
  if (source === "explicit") return true;
  if (source !== "passive") return false;
  return DEFECT_RE.test(t);
}
