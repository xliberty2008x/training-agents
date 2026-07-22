import fs from "node:fs";
import crypto from "node:crypto";
import { queuePath, feedbackDir } from "./paths.mjs";

function readAll(repoRoot) {
  const file = queuePath(repoRoot);
  try {
    const raw = fs.readFileSync(file, "utf8");
    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (err) {
    if (err && err.code === "ENOENT") return [];
    throw err;
  }
}

function writeAll(repoRoot, jobs) {
  fs.mkdirSync(feedbackDir(repoRoot), { recursive: true });
  const body = jobs.map((j) => JSON.stringify(j)).join("\n") + (jobs.length ? "\n" : "");
  fs.writeFileSync(queuePath(repoRoot), body, "utf8");
}

export function enqueueJob(repoRoot, jobInput, opts = {}) {
  const maxPending = opts.maxPending != null ? Number(opts.maxPending) : 50;
  let jobs = readAll(repoRoot);
  let pending = jobs.filter((j) => j.status === "pending");

  while (pending.length >= maxPending) {
    const dropPassive = pending.find((j) => j.source === "passive");
    const drop = dropPassive || pending[0];
    jobs = jobs.map((j) =>
      j.id === drop.id
        ? { ...j, status: "skipped", result: "queue_full", updatedAt: new Date().toISOString() }
        : j,
    );
    pending = jobs.filter((j) => j.status === "pending");
  }

  const job = {
    id: crypto.randomUUID(),
    source: jobInput.source === "passive" ? "passive" : "explicit",
    text: String(jobInput.text || "").trim(),
    context: jobInput.context && typeof jobInput.context === "object" ? jobInput.context : {},
    status: "pending",
    result: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  jobs.push(job);
  writeAll(repoRoot, jobs);
  return job;
}

export function claimNextPending(repoRoot) {
  const jobs = readAll(repoRoot);
  const idx = jobs.findIndex((j) => j.status === "pending");
  if (idx < 0) return null;
  jobs[idx] = {
    ...jobs[idx],
    status: "processing",
    updatedAt: new Date().toISOString(),
  };
  writeAll(repoRoot, jobs);
  return jobs[idx];
}

export function markJob(repoRoot, id, patch) {
  const jobs = readAll(repoRoot);
  const idx = jobs.findIndex((j) => j.id === id);
  if (idx < 0) return null;
  jobs[idx] = {
    ...jobs[idx],
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  writeAll(repoRoot, jobs);
  return jobs[idx];
}

export function countByStatus(repoRoot) {
  const jobs = readAll(repoRoot);
  const out = {};
  for (const j of jobs) {
    out[j.status] = (out[j.status] || 0) + 1;
  }
  return out;
}
