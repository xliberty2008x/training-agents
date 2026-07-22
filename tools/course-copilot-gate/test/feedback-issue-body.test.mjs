import test from "node:test";
import assert from "node:assert/strict";
import { buildIssueBody } from "../feedback/issue-body.mjs";

test("buildIssueBody includes Source, Lesson, Learner report, Auto-proposed footer", () => {
  const body = buildIssueBody({
    job: {
      source: "explicit",
      text: "quiz option C is wrong",
      context: {
        course: "sft-interactive-playbook",
        lessonId: "m2l3",
        lessonTitle: "Chat templates",
        module: "Module 2",
        view: "lesson",
      },
    },
    verdict: {
      body: "Option C contradicts the lesson.",
    },
  });

  assert.match(body, /Option C contradicts the lesson\./);
  assert.match(body, /Source: explicit/);
  assert.match(body, /Course: sft-interactive-playbook/);
  assert.match(body, /Lesson: m2l3 \(Chat templates\)/);
  assert.match(body, /Module: Module 2/);
  assert.match(body, /View: lesson/);
  assert.match(body, /Learner report:/);
  assert.match(body, /quiz option C is wrong/);
  assert.match(body, /_Auto-proposed by the course feedback pipeline\._/);
});

test("buildIssueBody handles missing job/verdict with safe placeholders", () => {
  const body = buildIssueBody();
  assert.match(body, /Source: unknown/);
  assert.match(body, /Course: —/);
  assert.match(body, /Lesson: — \(—\)/);
  assert.match(body, /Learner report:\n—/);
  assert.match(body, /_Auto-proposed by the course feedback pipeline\._/);
});
