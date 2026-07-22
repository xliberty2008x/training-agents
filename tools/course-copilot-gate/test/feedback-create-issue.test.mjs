import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createGithubIssue } from "../feedback/create-issue.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mockGh = path.join(__dirname, "..", "mock-gh.mjs");

test("createGithubIssue parses mock gh url", async () => {
  const result = await createGithubIssue({
    ghBin: process.execPath,
    ghExtraArgs: [mockGh],
    repo: "xliberty2008x/training-agents",
    title: "m2l3: quiz option C",
    body: "Details here",
    timeoutMs: 5000,
  });
  assert.equal(result.ok, true);
  assert.equal(result.number, 99);
  assert.match(result.url, /issues\/99/);
});
