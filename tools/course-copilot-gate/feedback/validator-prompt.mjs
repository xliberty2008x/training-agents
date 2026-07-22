/**
 * Build a one-shot triage prompt for course-content feedback validation.
 * The model must reply with JSON only (optionally fenced).
 */
export function buildValidatorPrompt({ job } = {}) {
  const j = job && typeof job === "object" ? job : {};
  const ctx = j.context && typeof j.context === "object" ? j.context : {};
  const str = (v) => (v != null ? String(v) : "");

  return [
    "You are a strict course-content triage agent for an SFT / agent training course.",
    "Decide whether the learner feedback is valuable enough to file as a GitHub issue.",
    "",
    "Valuable feedback describes a concrete course defect: factual errors, wrong quiz",
    "answers, broken steps, contradictions, typos that change meaning, missing content,",
    "or outdated instructions. Discard vague opinions, tutoring questions, off-topic",
    "chat, praise without a defect, and duplicate-style noise.",
    "",
    "Reply with JSON only (no prose outside the JSON). You may wrap it in a ```json fence.",
    "Schema:",
    "{",
    '  "valuable": boolean,',
    '  "title": string,   // short issue title when valuable; empty string when not',
    '  "body": string,    // issue body when valuable; empty string when not',
    '  "labels": string[],',
    '  "reason": string   // brief triage rationale',
    "}",
    "",
    "If valuable is true, title and body must both be non-empty.",
    "If valuable is false, still provide a short reason.",
    "",
    "## Feedback job",
    `source: ${str(j.source)}`,
    `text: ${str(j.text)}`,
    `lessonId: ${str(ctx.lessonId)}`,
    `module: ${str(ctx.module)}`,
    `lessonTitle: ${str(ctx.lessonTitle)}`,
    `view: ${str(ctx.view)}`,
    `course: ${str(ctx.course)}`,
  ].join("\n");
}

function defaultVerdict(reason) {
  return {
    valuable: false,
    title: "",
    body: "",
    labels: [],
    reason: reason || "unparseable validator output",
  };
}

function extractJsonCandidate(text) {
  const raw = text != null ? String(text) : "";
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();

  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return raw.slice(start, end + 1).trim();
  }
  return raw.trim();
}

/**
 * Parse validator model output into a structured verdict.
 * Garbage / incomplete valuable verdicts become valuable=false.
 */
export function parseVerdict(text) {
  const candidate = extractJsonCandidate(text);
  if (!candidate) return defaultVerdict("empty validator output");

  let parsed;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return defaultVerdict("unparseable validator output");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return defaultVerdict("unparseable validator output");
  }

  const valuable = parsed.valuable === true;
  const title = parsed.title != null ? String(parsed.title).trim() : "";
  const body = parsed.body != null ? String(parsed.body).trim() : "";
  const reason =
    parsed.reason != null ? String(parsed.reason) : valuable ? "" : "not valuable";
  const labels = Array.isArray(parsed.labels)
    ? parsed.labels.map((l) => String(l))
    : [];

  if (valuable) {
    if (!title || !body) {
      return defaultVerdict("valuable verdict missing title or body");
    }
    return { valuable: true, title, body, labels, reason: reason || "valuable" };
  }

  return {
    valuable: false,
    title: "",
    body: "",
    labels,
    reason: reason || "not valuable",
  };
}
