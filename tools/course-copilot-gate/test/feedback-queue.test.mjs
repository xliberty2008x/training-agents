import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  enqueueJob,
  claimNextPending,
  markJob,
  countByStatus,
} from "../feedback/queue.mjs";

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "fb-queue-"));
}

test("enqueue and claim next pending", () => {
  const root = tempRoot();
  const job = enqueueJob(root, {
    source: "explicit",
    text: "Lesson m1l1 has a typo in the title",
    context: { lessonId: "m1l1" },
  });
  assert.ok(job.id);
  assert.equal(job.status, "pending");
  const claimed = claimNextPending(root);
  assert.equal(claimed.id, job.id);
  assert.equal(claimed.status, "processing");
  markJob(root, job.id, { status: "done", result: "created" });
  assert.equal(claimNextPending(root), null);
});

test("queue cap drops oldest passive first", () => {
  const root = tempRoot();
  for (let i = 0; i < 3; i++) {
    enqueueJob(root, {
      source: "passive",
      text: `quiz is broken ${i}`,
      context: {},
    }, { maxPending: 2 });
  }
  const c = countByStatus(root);
  assert.ok(c.pending <= 2);
});
