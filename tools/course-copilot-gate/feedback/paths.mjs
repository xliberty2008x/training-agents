import path from "node:path";

export function feedbackDir(repoRoot) {
  return path.join(repoRoot, "workspaces", "course-copilot");
}

export function queuePath(repoRoot) {
  return path.join(feedbackDir(repoRoot), "feedback-queue.jsonl");
}

export function notificationsPath(repoRoot) {
  return path.join(feedbackDir(repoRoot), "feedback-notifications.json");
}

export function dedupePath(repoRoot) {
  return path.join(feedbackDir(repoRoot), "feedback-dedupe.json");
}
