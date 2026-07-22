// tools/course-copilot-gate/test/feedback-server.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "../server.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const gateDir = path.resolve(__dirname, "..");
const mockTutor = path.join(gateDir, "mock-grok.mjs");
const mockValidator = path.join(gateDir, "mock-validator-grok.mjs");
const mockGh = path.join(gateDir, "mock-gh.mjs");
const docsRoot = path.join(gateDir, "../..", "docs");

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "fb-server-"));
}

async function withServer(options, fn) {
  const created = createServer({
    host: "127.0.0.1",
    port: 0,
    docsRoot,
    grokBin: process.execPath,
    extraArgs: [mockTutor],
    feedbackGrokBin: process.execPath,
    feedbackGrokExtraArgs: [mockValidator],
    ghBin: process.execPath,
    ghExtraArgs: [mockGh],
    feedbackGithubRepo: "xliberty2008x/training-agents",
    feedbackEnabled: true,
    feedbackPassive: true,
    feedbackIntervalMs: 200,
    maxTurns: 2,
    timeoutMs: 15_000,
    ...options,
  });
  await created.listen();
  const { port } = created.server.address();
  const base = `http://127.0.0.1:${port}`;
  try {
    return await fn({ base, created });
  } finally {
    if (created.feedbackRunner) created.feedbackRunner.stop();
    await created.close();
  }
}

async function jsonFetch(url, init) {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => null);
  return { res, body };
}

test("POST /feedback queues and returns immediately", async () => {
  const root = tempRoot();
  await withServer({ repoRoot: root }, async ({ base }) => {
    const { res, body } = await jsonFetch(`${base}/feedback`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        comment: "VALUABLE: quiz is broken on this lesson",
        context: { lessonId: "m2l3", course: "sft-interactive-playbook" },
      }),
    });
    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.queued, true);
    assert.ok(body.id);
  });
});

test("feedback job creates notification without blocking chat", async () => {
  const root = tempRoot();
  await withServer({ repoRoot: root }, async ({ base }) => {
    await jsonFetch(`${base}/feedback`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        comment: "VALUABLE: factual error in intro paragraph",
        context: { lessonId: "m1l1" },
      }),
    });
    // Poll until notification or timeout (~4s)
    let unseen = [];
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 100));
      const { body } = await jsonFetch(`${base}/feedback/notifications`);
      unseen = body.notifications || [];
      if (unseen.length) break;
    }
    assert.ok(unseen.length >= 1, "expected notification");
    const id = unseen[0].id;
    const ack = await jsonFetch(`${base}/feedback/notifications/ack`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: [id] }),
    });
    assert.equal(ack.body.ok, true);
    const after = await jsonFetch(`${base}/feedback/notifications`);
    assert.equal((after.body.notifications || []).length, 0);
  });
});

test("POST /feedback empty comment 400", async () => {
  const root = tempRoot();
  await withServer({ repoRoot: root }, async ({ base }) => {
    const { res, body } = await jsonFetch(`${base}/feedback`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ comment: "  ", context: {} }),
    });
    assert.equal(res.status, 400);
    assert.equal(body.ok, false);
  });
});
