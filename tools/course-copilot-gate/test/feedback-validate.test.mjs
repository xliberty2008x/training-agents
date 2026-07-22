import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseVerdict, buildValidatorPrompt } from "../feedback/validator-prompt.mjs";
import { runValidator } from "../feedback/validate.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mockValidator = path.join(__dirname, "..", "mock-validator-grok.mjs");

test("parseVerdict reads fenced JSON", () => {
  const v = parseVerdict('Here you go:\n```json\n{"valuable":true,"title":"T","body":"B","labels":[],"reason":"x"}\n```');
  assert.equal(v.valuable, true);
  assert.equal(v.title, "T");
});

test("parseVerdict defaults not valuable on garbage", () => {
  const v = parseVerdict("sorry no json");
  assert.equal(v.valuable, false);
});

test("runValidator with mock returns structured verdict", async () => {
  const result = await runValidator({
    grokBin: process.execPath,
    extraArgs: [mockValidator],
    cwd: path.resolve(__dirname, "../.."),
    job: {
      source: "explicit",
      text: "VALUABLE: quiz option C is wrong on m2l3",
      context: { lessonId: "m2l3", lessonTitle: "Demo" },
    },
    timeoutMs: 10_000,
    maxTurns: 2,
  });
  assert.equal(result.ok, true);
  assert.equal(result.verdict.valuable, true);
  assert.ok(result.verdict.title);
});
