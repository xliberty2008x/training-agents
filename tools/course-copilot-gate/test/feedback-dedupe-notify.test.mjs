import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  fingerprint,
  isDuplicate,
  rememberFingerprint,
} from "../feedback/dedupe.mjs";
import {
  appendNotification,
  listUnseen,
  ackNotifications,
} from "../feedback/notify.mjs";

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "fb-dedupe-"));
}

test("fingerprint stable for same lesson+claim", () => {
  const a = fingerprint({ lessonId: "m2l3", claim: "  Quiz option C is wrong " });
  const b = fingerprint({ lessonId: "m2l3", claim: "quiz option c is wrong" });
  assert.equal(a, b);
});

test("dedupe remembers and detects", () => {
  const root = tempRoot();
  const fp = fingerprint({ lessonId: "m1l1", claim: "missing step 2" });
  assert.equal(isDuplicate(root, fp), false);
  rememberFingerprint(root, fp);
  assert.equal(isDuplicate(root, fp), true);
});

test("notifications append list and ack", () => {
  const root = tempRoot();
  const n = appendNotification(root, {
    number: 42,
    url: "https://github.com/xliberty2008x/training-agents/issues/42",
    title: "m2l3 quiz wording",
  });
  assert.ok(n.id);
  assert.equal(listUnseen(root).length, 1);
  ackNotifications(root, [n.id]);
  assert.equal(listUnseen(root).length, 0);
});
