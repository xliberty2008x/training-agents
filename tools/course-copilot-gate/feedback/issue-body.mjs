/**
 * Deterministic GitHub issue body from job context + model verdict.
 * Appends source/lesson metadata and the learner report so every issue
 * is reviewable even when the model body is thin.
 */
export function buildIssueBody({ job, verdict } = {}) {
  const ctx = (job && job.context) || {};
  const modelBody = verdict && verdict.body ? String(verdict.body).trim() : "";
  const learner = job && job.text != null ? String(job.text).trim() : "";
  return [
    modelBody,
    "",
    "---",
    `Source: ${job && job.source ? job.source : "unknown"}`,
    `Course: ${ctx.course || "—"}`,
    `Lesson: ${ctx.lessonId || "—"} (${ctx.lessonTitle || "—"})`,
    `Module: ${ctx.module || "—"}`,
    `View: ${ctx.view || "—"}`,
    "",
    "Learner report:",
    learner || "—",
    "",
    "_Auto-proposed by the course feedback pipeline._",
  ].join("\n");
}
