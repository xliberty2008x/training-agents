// tools/course-copilot-gate/feedback/runner.mjs
import { claimNextPending, markJob } from "./queue.mjs";
import { runValidator } from "./validate.mjs";
import { createGithubIssue } from "./create-issue.mjs";
import { fingerprint, isDuplicate, rememberFingerprint } from "./dedupe.mjs";
import { appendNotification } from "./notify.mjs";

/**
 * Claim one pending job and run: validate → dedupe → gh issue → notify.
 */
export async function processNextJob(opts = {}) {
  const {
    repoRoot,
    cwd,
    grokBin,
    grokExtraArgs = [],
    ghBin = "gh",
    ghExtraArgs = [],
    githubRepo = "xliberty2008x/training-agents",
    validatorTimeoutMs = 120000,
    ghTimeoutMs = 30000,
    enabled = true,
  } = opts;

  if (!enabled) return { processed: false, created: false, reason: "disabled" };

  const job = claimNextPending(repoRoot);
  if (!job) return { processed: false, created: false, reason: "empty" };

  try {
    const validation = await runValidator({
      grokBin,
      extraArgs: grokExtraArgs,
      cwd: cwd || repoRoot,
      job,
      timeoutMs: validatorTimeoutMs,
    });

    if (!validation.ok || !validation.verdict.valuable) {
      markJob(repoRoot, job.id, {
        status: "done",
        result: "discarded",
        reason: validation.verdict?.reason || validation.error || "not_valuable",
      });
      return { processed: true, created: false, reason: "discarded", jobId: job.id };
    }

    const claim = validation.verdict.title || job.text;
    const lessonId = job.context?.lessonId || null;
    const fp = fingerprint({ lessonId, claim });
    if (isDuplicate(repoRoot, fp)) {
      markJob(repoRoot, job.id, {
        status: "done",
        result: "duplicate",
      });
      return { processed: true, created: false, reason: "duplicate", jobId: job.id };
    }

    let create = await createGithubIssue({
      ghBin,
      ghExtraArgs,
      repo: githubRepo,
      title: validation.verdict.title,
      body: validation.verdict.body,
      labels: validation.verdict.labels,
      timeoutMs: ghTimeoutMs,
    });

    // One retry without labels if labels failed
    if (!create.ok && /label/i.test(String(create.error || ""))) {
      create = await createGithubIssue({
        ghBin,
        ghExtraArgs,
        repo: githubRepo,
        title: validation.verdict.title,
        body: validation.verdict.body,
        labels: [],
        timeoutMs: ghTimeoutMs,
      });
    }

    if (!create.ok) {
      markJob(repoRoot, job.id, {
        status: "done",
        result: "gh_failed",
        reason: create.error,
      });
      return { processed: true, created: false, reason: "gh_failed", jobId: job.id };
    }

    rememberFingerprint(repoRoot, fp);
    appendNotification(repoRoot, {
      number: create.number,
      url: create.url,
      title: validation.verdict.title,
    });
    markJob(repoRoot, job.id, {
      status: "done",
      result: "created",
      issueNumber: create.number,
      issueUrl: create.url,
    });
    return {
      processed: true,
      created: true,
      jobId: job.id,
      url: create.url,
      number: create.number,
    };
  } catch (err) {
    markJob(repoRoot, job.id, {
      status: "done",
      result: "error",
      reason: err && err.message ? err.message : String(err),
    });
    return { processed: true, created: false, reason: "error", jobId: job.id };
  }
}

/**
 * Start a polling runner. Returns { stop }.
 * Does NOT share the chat mutex.
 */
export function createFeedbackRunner(opts = {}) {
  const intervalMs = opts.intervalMs != null ? Number(opts.intervalMs) : 1500;
  let stopped = false;
  let tickBusy = false;

  const timer = setInterval(() => {
    if (stopped || tickBusy) return;
    tickBusy = true;
    Promise.resolve()
      .then(() => processNextJob(opts))
      .catch((err) => {
        console.error("[feedback-runner]", err);
      })
      .finally(() => {
        tickBusy = false;
      });
  }, intervalMs);
  if (typeof timer.unref === "function") timer.unref();

  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}
