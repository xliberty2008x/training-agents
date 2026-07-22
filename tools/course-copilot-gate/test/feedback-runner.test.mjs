import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { enqueueJob } from "../feedback/queue.mjs";
import { listUnseen } from "../feedback/notify.mjs";
import { processNextJob, createFeedbackRunner } from "../feedback/runner.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mockValidator = path.join(__dirname, "..", "mock-validator-grok.mjs");
const mockGh = path.join(__dirname, "..", "mock-gh.mjs");

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "fb-runner-"));
}

test("processNextJob creates issue and notification when valuable", async () => {
  const root = tempRoot();
  enqueueJob(root, {
    source: "explicit",
    text: "VALUABLE: quiz option C is wrong",
    context: { lessonId: "m2l3" },
  });
  const outcome = await processNextJob({
    repoRoot: root,
    cwd: path.resolve(__dirname, "../.."),
    grokBin: process.execPath,
    grokExtraArgs: [mockValidator],
    ghBin: process.execPath,
    ghExtraArgs: [mockGh],
    githubRepo: "xliberty2008x/training-agents",
  });
  assert.equal(outcome.processed, true);
  assert.equal(outcome.created, true);
  assert.equal(listUnseen(root).length, 1);
});

test("processNextJob discards non-valuable without notification", async () => {
  const root = tempRoot();
  enqueueJob(root, {
    source: "explicit",
    text: "just a soft preference about tone",
    context: { lessonId: "m1l1" },
  });
  const outcome = await processNextJob({
    repoRoot: root,
    cwd: path.resolve(__dirname, "../.."),
    grokBin: process.execPath,
    grokExtraArgs: [mockValidator],
    ghBin: process.execPath,
    ghExtraArgs: [mockGh],
    githubRepo: "xliberty2008x/training-agents",
  });
  assert.equal(outcome.processed, true);
  assert.equal(outcome.created, false);
  assert.equal(listUnseen(root).length, 0);
});
