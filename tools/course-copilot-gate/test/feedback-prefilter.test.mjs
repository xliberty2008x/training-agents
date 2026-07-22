import test from "node:test";
import assert from "node:assert/strict";
import { shouldEnqueuePassive } from "../feedback/prefilter.mjs";

test("explicit source always enqueues", () => {
  assert.equal(shouldEnqueuePassive({ source: "explicit", text: "meh" }), true);
});

test("passive normal study question does not enqueue", () => {
  assert.equal(
    shouldEnqueuePassive({
      source: "passive",
      text: "Can you explain what SFT means in this lesson?",
    }),
    false,
  );
});

test("passive clear defect claim enqueues", () => {
  assert.equal(
    shouldEnqueuePassive({
      source: "passive",
      text: "The quiz is broken — option C contradicts the lesson body.",
    }),
    true,
  );
});

test("empty text never enqueues", () => {
  assert.equal(shouldEnqueuePassive({ source: "passive", text: "   " }), false);
});
