# Course Feedback → GitHub Issues Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a background course-content feedback pipeline to the course-copilot gate: dock Feedback form, conservative post-chat candidates, one-shot Grok validation, `gh issue create` on `xliberty2008x/training-agents`, toast only when an issue is created.

**Architecture:** Extend the existing Node gate with pure feedback modules (queue, prefilter, dedupe, notify, validate, create-issue, runner). Feedback work runs off the chat mutex. The durable tutor session never creates issues. Dock polls `/feedback/notifications` and shows a minimal toast.

**Tech Stack:** Node.js stdlib (`http`, `fs`, `child_process`), existing gate + `node:test`, browser dock JS, headless Grok CLI (mocked in tests), `gh` CLI (mocked in tests).

**Spec:** `docs/superpowers/specs/2026-07-22-course-feedback-issues-design.md`

---

## File map

| Path | Responsibility |
|---|---|
| `tools/course-copilot-gate/feedback/paths.mjs` | Workspace paths under `workspaces/course-copilot/` |
| `tools/course-copilot-gate/feedback/prefilter.mjs` | Cheap passive heuristic (explicit always passes) |
| `tools/course-copilot-gate/feedback/dedupe.mjs` | Fingerprint + local dedupe store |
| `tools/course-copilot-gate/feedback/notify.mjs` | Notification ring buffer + list/ack |
| `tools/course-copilot-gate/feedback/queue.mjs` | JSONL job queue + status transitions |
| `tools/course-copilot-gate/feedback/validator-prompt.mjs` | Build validator prompt; parse JSON verdict |
| `tools/course-copilot-gate/feedback/validate.mjs` | Spawn one-shot Grok for validation |
| `tools/course-copilot-gate/feedback/create-issue.mjs` | Run `gh issue create` |
| `tools/course-copilot-gate/feedback/runner.mjs` | Single-worker process loop |
| `tools/course-copilot-gate/mock-validator-grok.mjs` | Mock CLI returning structured verdict JSON |
| `tools/course-copilot-gate/mock-gh.mjs` | Mock `gh issue create` |
| `tools/course-copilot-gate/server.mjs` | Routes + post-chat enqueue + start runner |
| `tools/course-copilot-gate/test/feedback-*.test.mjs` | Unit + HTTP tests |
| `docs/sft-course-copilot.js` | Feedback panel, poll, toast, pure markup helpers |
| `docs/sft-interactive-playbook.html` | Feedback + toast CSS |
| `docs/sft-course-check.mjs` | Assert Feedback wiring helpers if exported |
| `tools/course-copilot-gate/README.md` | `gh auth`, feedback behavior |

**Runtime only (gitignored):** `workspaces/course-copilot/feedback-queue.jsonl`, `feedback-notifications.json`, `feedback-dedupe.json`

---

### Task 1: Paths + prefilter (pure)

**Files:**
- Create: `tools/course-copilot-gate/feedback/paths.mjs`
- Create: `tools/course-copilot-gate/feedback/prefilter.mjs`
- Create: `tools/course-copilot-gate/test/feedback-prefilter.test.mjs`

- [ ] **Step 1: Write failing prefilter tests**

```js
// tools/course-copilot-gate/test/feedback-prefilter.test.mjs
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
```

- [ ] **Step 2: Run test — expect FAIL (module missing)**

Run: `node --test tools/course-copilot-gate/test/feedback-prefilter.test.mjs`  
Expected: FAIL cannot find module `../feedback/prefilter.mjs`

- [ ] **Step 3: Implement paths + prefilter**

```js
// tools/course-copilot-gate/feedback/paths.mjs
import path from "node:path";

export function feedbackDir(repoRoot) {
  return path.join(repoRoot, "workspaces", "course-copilot");
}

export function queuePath(repoRoot) {
  return path.join(feedbackDir(repoRoot), "feedback-queue.jsonl");
}

export function notificationsPath(repoRoot) {
  return path.join(feedbackDir(repoRoot), "feedback-notifications.json");
}

export function dedupePath(repoRoot) {
  return path.join(feedbackDir(repoRoot), "feedback-dedupe.json");
}
```

```js
// tools/course-copilot-gate/feedback/prefilter.mjs
const DEFECT_RE =
  /\b(wrong|incorrect|error|bug|broken|contradict|contradicts|typo|missing step|quiz is|cannot run|doesn't work|does not work|outdated|factually)\b/i;

/**
 * Cheap gate before enqueue. Explicit feedback always passes when text non-empty.
 * Passive requires a defect-ish claim; default no.
 */
export function shouldEnqueuePassive({ source, text } = {}) {
  const t = text != null ? String(text).trim() : "";
  if (!t) return false;
  if (source === "explicit") return true;
  if (source !== "passive") return false;
  return DEFECT_RE.test(t);
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `node --test tools/course-copilot-gate/test/feedback-prefilter.test.mjs`  
Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add tools/course-copilot-gate/feedback/paths.mjs \
  tools/course-copilot-gate/feedback/prefilter.mjs \
  tools/course-copilot-gate/test/feedback-prefilter.test.mjs
git commit -m "feat(course-feedback): add paths and passive prefilter"
```

---

### Task 2: Dedupe + notify stores

**Files:**
- Create: `tools/course-copilot-gate/feedback/dedupe.mjs`
- Create: `tools/course-copilot-gate/feedback/notify.mjs`
- Create: `tools/course-copilot-gate/test/feedback-dedupe-notify.test.mjs`

- [ ] **Step 1: Write failing tests**

```js
// tools/course-copilot-gate/test/feedback-dedupe-notify.test.mjs
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
```

- [ ] **Step 2: Run — expect FAIL**

Run: `node --test tools/course-copilot-gate/test/feedback-dedupe-notify.test.mjs`  
Expected: FAIL missing modules

- [ ] **Step 3: Implement dedupe + notify**

```js
// tools/course-copilot-gate/feedback/dedupe.mjs
import fs from "node:fs";
import crypto from "node:crypto";
import { dedupePath, feedbackDir } from "./paths.mjs";

function normalizeClaim(claim) {
  return String(claim || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function fingerprint({ lessonId, claim } = {}) {
  const key = `${lessonId || "unknown"}|${normalizeClaim(claim)}`;
  return crypto.createHash("sha256").update(key).digest("hex").slice(0, 32);
}

function load(repoRoot) {
  try {
    return JSON.parse(fs.readFileSync(dedupePath(repoRoot), "utf8"));
  } catch {
    return { fingerprints: {}, max: 200 };
  }
}

function save(repoRoot, data) {
  fs.mkdirSync(feedbackDir(repoRoot), { recursive: true });
  fs.writeFileSync(dedupePath(repoRoot), JSON.stringify(data, null, 2) + "\n");
}

export function isDuplicate(repoRoot, fp) {
  const data = load(repoRoot);
  return !!(data.fingerprints && data.fingerprints[fp]);
}

export function rememberFingerprint(repoRoot, fp) {
  const data = load(repoRoot);
  data.fingerprints = data.fingerprints || {};
  data.fingerprints[fp] = new Date().toISOString();
  const keys = Object.keys(data.fingerprints);
  const max = data.max || 200;
  if (keys.length > max) {
    keys
      .sort((a, b) => String(data.fingerprints[a]).localeCompare(String(data.fingerprints[b])))
      .slice(0, keys.length - max)
      .forEach((k) => delete data.fingerprints[k]);
  }
  save(repoRoot, data);
}
```

```js
// tools/course-copilot-gate/feedback/notify.mjs
import fs from "node:fs";
import crypto from "node:crypto";
import { notificationsPath, feedbackDir } from "./paths.mjs";

function load(repoRoot) {
  try {
    return JSON.parse(fs.readFileSync(notificationsPath(repoRoot), "utf8"));
  } catch {
    return { items: [] };
  }
}

function save(repoRoot, data) {
  fs.mkdirSync(feedbackDir(repoRoot), { recursive: true });
  fs.writeFileSync(
    notificationsPath(repoRoot),
    JSON.stringify(data, null, 2) + "\n",
  );
}

export function appendNotification(repoRoot, { number, url, title } = {}) {
  const data = load(repoRoot);
  const item = {
    id: crypto.randomUUID(),
    number: number != null ? Number(number) : null,
    url: url != null ? String(url) : null,
    title: title != null ? String(title) : "",
    createdAt: new Date().toISOString(),
    seen: false,
  };
  data.items = Array.isArray(data.items) ? data.items : [];
  data.items.push(item);
  // Keep last 50
  if (data.items.length > 50) data.items = data.items.slice(-50);
  save(repoRoot, data);
  return item;
}

export function listUnseen(repoRoot) {
  const data = load(repoRoot);
  return (data.items || []).filter((i) => i && !i.seen);
}

export function ackNotifications(repoRoot, ids) {
  const set = new Set((ids || []).map(String));
  const data = load(repoRoot);
  for (const item of data.items || []) {
    if (item && set.has(String(item.id))) item.seen = true;
  }
  save(repoRoot, data);
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `node --test tools/course-copilot-gate/test/feedback-dedupe-notify.test.mjs`

- [ ] **Step 5: Commit**

```bash
git add tools/course-copilot-gate/feedback/dedupe.mjs \
  tools/course-copilot-gate/feedback/notify.mjs \
  tools/course-copilot-gate/test/feedback-dedupe-notify.test.mjs
git commit -m "feat(course-feedback): add dedupe and notification stores"
```

---

### Task 3: Queue module

**Files:**
- Create: `tools/course-copilot-gate/feedback/queue.mjs`
- Create: `tools/course-copilot-gate/test/feedback-queue.test.mjs`

- [ ] **Step 1: Write failing queue tests**

```js
// tools/course-copilot-gate/test/feedback-queue.test.mjs
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
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement queue**

```js
// tools/course-copilot-gate/feedback/queue.mjs
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

/**
 * @param {object} jobInput
 * @param {{ maxPending?: number }} [opts]
 */
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
```

- [ ] **Step 4: Run — expect PASS**

Run: `node --test tools/course-copilot-gate/test/feedback-queue.test.mjs`

- [ ] **Step 5: Commit**

```bash
git add tools/course-copilot-gate/feedback/queue.mjs \
  tools/course-copilot-gate/test/feedback-queue.test.mjs
git commit -m "feat(course-feedback): add feedback job queue"
```

---

### Task 4: Validator prompt parse + mock validator Grok

**Files:**
- Create: `tools/course-copilot-gate/feedback/validator-prompt.mjs`
- Create: `tools/course-copilot-gate/mock-validator-grok.mjs`
- Create: `tools/course-copilot-gate/feedback/validate.mjs`
- Create: `tools/course-copilot-gate/test/feedback-validate.test.mjs`

- [ ] **Step 1: Write failing parse + validate tests**

```js
// tools/course-copilot-gate/test/feedback-validate.test.mjs
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
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement prompt, mock, validate**

```js
// tools/course-copilot-gate/feedback/validator-prompt.mjs
export function buildValidatorPrompt({ job } = {}) {
  const context = job?.context || {};
  return [
    "You are a strict course-content issue triage agent for the SFT interactive playbook.",
    "Decide if the candidate is a VALUABLE, actionable course CONTENT defect.",
    "Create issues only for: factual errors, missing/broken lab steps, bad quizzes, contradictions, non-runnable snippets.",
    "Discard: vague confusion, preferences, copilot/product bugs, pure study questions.",
    "Default valuable=false. Be conservative.",
    "Reply with ONLY a JSON object (optional markdown fence) with keys:",
    'valuable (boolean), title (string), body (string), labels (string[]), reason (string for logs).',
    "If valuable=true, title and body must be concrete and include lessonId when known.",
    "",
    "## Candidate",
    `source: ${job?.source || "unknown"}`,
    `text: ${job?.text || ""}`,
    `lessonId: ${context.lessonId ?? "null"}`,
    `module: ${context.module ?? "null"}`,
    `lessonTitle: ${context.lessonTitle ?? "null"}`,
    `view: ${context.view ?? "null"}`,
    `course: ${context.course ?? "sft-interactive-playbook"}`,
  ].join("\n");
}

export function parseVerdict(text) {
  const raw = text != null ? String(text) : "";
  let jsonStr = null;
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) jsonStr = fence[1].trim();
  if (!jsonStr) {
    const brace = raw.match(/\{[\s\S]*\}/);
    if (brace) jsonStr = brace[0];
  }
  if (!jsonStr) {
    return {
      valuable: false,
      title: "",
      body: "",
      labels: [],
      reason: "unparseable_verdict",
    };
  }
  try {
    const obj = JSON.parse(jsonStr);
    const valuable = !!obj.valuable;
    const title = obj.title != null ? String(obj.title).trim() : "";
    const body = obj.body != null ? String(obj.body).trim() : "";
    const labels = Array.isArray(obj.labels)
      ? obj.labels.map(String)
      : ["course-content", "sft-playbook"];
    if (valuable && (!title || !body)) {
      return {
        valuable: false,
        title: "",
        body: "",
        labels: [],
        reason: "valuable_missing_title_or_body",
      };
    }
    return {
      valuable,
      title,
      body,
      labels,
      reason: obj.reason != null ? String(obj.reason) : "",
    };
  } catch {
    return {
      valuable: false,
      title: "",
      body: "",
      labels: [],
      reason: "json_parse_error",
    };
  }
}
```

```js
// tools/course-copilot-gate/mock-validator-grok.mjs
#!/usr/bin/env node
function parseArgv(argv) {
  let prompt = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "-p") {
      prompt = argv[i + 1] ?? "";
      i += 1;
    }
  }
  return { prompt };
}

const { prompt } = parseArgv(process.argv.slice(2));
const p = prompt || "";
const valuable =
  /VALUABLE:/i.test(p) ||
  (/\b(quiz is broken|contradict|factual error)\b/i.test(p) &&
    !/\bDISCARD\b/i.test(p));

const lessonMatch = p.match(/lessonId:\s*(\S+)/);
const lessonId = lessonMatch ? lessonMatch[1] : "unknown";

const verdict = valuable
  ? {
      valuable: true,
      title: `${lessonId}: content issue from feedback`,
      body: `## Summary\nAuto-validated course content issue.\n\n## Context\nlessonId: ${lessonId}\n\n## Evidence\n${p.slice(0, 500)}`,
      labels: ["course-content", "sft-playbook"],
      reason: "mock_valuable",
    }
  : {
      valuable: false,
      title: "",
      body: "",
      labels: [],
      reason: "mock_not_valuable",
    };

const result = {
  text: "```json\n" + JSON.stringify(verdict) + "\n```",
  sessionId: process.env.MOCK_SESSION_ID || "feedback-validator-mock",
  stopReason: "EndTurn",
  args: process.argv.slice(2),
};
process.stdout.write(JSON.stringify(result) + "\n");
```

```js
// tools/course-copilot-gate/feedback/validate.mjs
import { runGrokTurn } from "../grok.mjs";
import { buildValidatorPrompt, parseVerdict } from "./validator-prompt.mjs";

/**
 * One-shot validator — never uses tutor sessionId.
 */
export async function runValidator({
  grokBin,
  extraArgs = [],
  cwd,
  job,
  timeoutMs = 120000,
  maxTurns = 4,
  env,
} = {}) {
  const prompt = buildValidatorPrompt({ job });
  const result = await runGrokTurn({
    grokBin,
    cwd,
    prompt,
    sessionId: null,
    maxTurns,
    timeoutMs,
    extraArgs,
    env,
  });
  if (!result.ok) {
    return {
      ok: false,
      verdict: {
        valuable: false,
        title: "",
        body: "",
        labels: [],
        reason: result.error || "validator_failed",
      },
      error: result.error,
      durationMs: result.durationMs,
    };
  }
  return {
    ok: true,
    verdict: parseVerdict(result.text),
    error: null,
    durationMs: result.durationMs,
  };
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `node --test tools/course-copilot-gate/test/feedback-validate.test.mjs`

- [ ] **Step 5: Commit**

```bash
git add tools/course-copilot-gate/feedback/validator-prompt.mjs \
  tools/course-copilot-gate/feedback/validate.mjs \
  tools/course-copilot-gate/mock-validator-grok.mjs \
  tools/course-copilot-gate/test/feedback-validate.test.mjs
git commit -m "feat(course-feedback): add validator prompt, mock, and runner"
```

---

### Task 5: `gh` create-issue + mock-gh

**Files:**
- Create: `tools/course-copilot-gate/feedback/create-issue.mjs`
- Create: `tools/course-copilot-gate/mock-gh.mjs`
- Create: `tools/course-copilot-gate/test/feedback-create-issue.test.mjs`

- [ ] **Step 1: Write failing tests**

```js
// tools/course-copilot-gate/test/feedback-create-issue.test.mjs
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
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement create-issue + mock-gh**

```js
// tools/course-copilot-gate/mock-gh.mjs
#!/usr/bin/env node
// Mock: node mock-gh.mjs issue create --repo X --title T --body B
const args = process.argv.slice(2);
if (args[0] === "issue" && args[1] === "create") {
  const repoIdx = args.indexOf("--repo");
  const repo = repoIdx >= 0 ? args[repoIdx + 1] : "owner/repo";
  const url = `https://github.com/${repo}/issues/99`;
  process.stdout.write(url + "\n");
  process.exit(0);
}
process.stderr.write("mock-gh: unsupported args " + args.join(" ") + "\n");
process.exit(1);
```

```js
// tools/course-copilot-gate/feedback/create-issue.mjs
import { spawn } from "node:child_process";

/**
 * Create a GitHub issue via gh CLI.
 * Spawn: spawn(ghBin, [...ghExtraArgs, "issue", "create", ...])
 */
export function createGithubIssue({
  ghBin = "gh",
  ghExtraArgs = [],
  repo = "xliberty2008x/training-agents",
  title,
  body,
  labels = [],
  timeoutMs = 30000,
  env,
} = {}) {
  const prefix = Array.isArray(ghExtraArgs) ? ghExtraArgs : [];
  const args = [
    ...prefix,
    "issue",
    "create",
    "--repo",
    String(repo),
    "--title",
    String(title || ""),
    "--body",
    String(body || ""),
  ];
  // Best-effort labels (mock ignores; real gh may fail if label missing — caller can retry without)
  for (const lab of labels || []) {
    if (lab) args.push("--label", String(lab));
  }

  return new Promise((resolve) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    const start = Date.now();
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ...result, durationMs: Date.now() - start });
    };

    const child = spawn(ghBin, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: env || process.env,
    });

    const timer = setTimeout(() => {
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
      finish({
        ok: false,
        url: null,
        number: null,
        error: "gh_timeout",
      });
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    child.on("error", (err) => {
      finish({
        ok: false,
        url: null,
        number: null,
        error: err.message || String(err),
      });
    });
    child.on("close", (code) => {
      if (code !== 0) {
        finish({
          ok: false,
          url: null,
          number: null,
          error: stderr.trim() || `gh_exit_${code}`,
        });
        return;
      }
      const url = stdout.trim().split(/\s+/).find((t) => /^https?:\/\//.test(t)) || stdout.trim();
      const m = String(url).match(/\/issues\/(\d+)/);
      finish({
        ok: true,
        url: url || null,
        number: m ? Number(m[1]) : null,
        error: null,
      });
    });
  });
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `node --test tools/course-copilot-gate/test/feedback-create-issue.test.mjs`

- [ ] **Step 5: Commit**

```bash
git add tools/course-copilot-gate/feedback/create-issue.mjs \
  tools/course-copilot-gate/mock-gh.mjs \
  tools/course-copilot-gate/test/feedback-create-issue.test.mjs
git commit -m "feat(course-feedback): add gh issue create wrapper and mock"
```

---

### Task 6: Background runner (orchestrate validate → dedupe → gh → notify)

**Files:**
- Create: `tools/course-copilot-gate/feedback/runner.mjs`
- Create: `tools/course-copilot-gate/test/feedback-runner.test.mjs`

- [ ] **Step 1: Write failing integration test for one job**

```js
// tools/course-copilot-gate/test/feedback-runner.test.mjs
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
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement runner**

```js
// tools/course-copilot-gate/feedback/runner.mjs
import { claimNextPending, markJob } from "./queue.mjs";
import { runValidator } from "./validate.mjs";
import { createGithubIssue } from "./create-issue.mjs";
import { fingerprint, isDuplicate, rememberFingerprint } from "./dedupe.mjs";
import { appendNotification } from "./notify.mjs";

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
```

- [ ] **Step 4: Run — expect PASS**

Run: `node --test tools/course-copilot-gate/test/feedback-runner.test.mjs`

- [ ] **Step 5: Commit**

```bash
git add tools/course-copilot-gate/feedback/runner.mjs \
  tools/course-copilot-gate/test/feedback-runner.test.mjs
git commit -m "feat(course-feedback): add background job runner"
```

---

### Task 7: Wire gate HTTP routes + post-chat enqueue + start runner

**Files:**
- Modify: `tools/course-copilot-gate/server.mjs`
- Create: `tools/course-copilot-gate/test/feedback-server.test.mjs`

- [ ] **Step 1: Write failing HTTP tests**

```js
// tools/course-copilot-gate/test/feedback-server.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "../server.mjs";
import { listUnseen } from "../feedback/notify.mjs";

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
    // Poll until notification or timeout
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
```

- [ ] **Step 2: Run — expect FAIL** (routes missing)

- [ ] **Step 3: Wire server.mjs**

In `createServer(options)`:

1. Read feedback options from `options` / env:
   - `feedbackEnabled` ← `FEEDBACK_ENABLED` default true
   - `feedbackPassive` ← `FEEDBACK_PASSIVE` default true
   - `feedbackGithubRepo` ← `FEEDBACK_GITHUB_REPO` default `xliberty2008x/training-agents`
   - `feedbackGrokBin` / `feedbackGrokExtraArgs` (default same as tutor grok mocks in tests; prod = same `grokBin`)
   - `ghBin` ← `GH_BIN` default `gh`
   - `ghExtraArgs` for tests
   - `feedbackIntervalMs` default 1500

2. Import:
   - `enqueueJob` from `./feedback/queue.mjs`
   - `shouldEnqueuePassive` from `./feedback/prefilter.mjs`
   - `listUnseen`, `ackNotifications` from `./feedback/notify.mjs`
   - `createFeedbackRunner` from `./feedback/runner.mjs`

3. Add handlers:

```js
async function handleFeedback(req, res) {
  if (!feedbackEnabled) {
    sendJson(res, 503, { ok: false, error: "feedback_disabled" });
    return;
  }
  // parse body like handleChat; require non-empty comment
  // enqueueJob(repoRoot, { source: "explicit", text: comment, context })
  // sendJson 200 { ok: true, queued: true, id: job.id }
}

async function handleFeedbackNotifications(_req, res) {
  sendJson(res, 200, {
    ok: true,
    notifications: listUnseen(repoRoot),
  });
}

async function handleFeedbackAck(req, res) {
  // parse { ids: string[] }
  // ackNotifications(repoRoot, ids)
  // sendJson 200 { ok: true }
}
```

4. Route table:

```js
if (method === "POST" && pathname === "/feedback") {
  await handleFeedback(req, res);
  return;
}
if (method === "GET" && pathname === "/feedback/notifications") {
  await handleFeedbackNotifications(req, res);
  return;
}
if (method === "POST" && pathname === "/feedback/notifications/ack") {
  await handleFeedbackAck(req, res);
  return;
}
```

5. After successful chat reply is sent (still inside `handleChat`, **after** `sendJson` for success, still before `finally` clears busy is OK for enqueue — enqueue must be cheap sync file write only):

```js
if (result.ok && feedbackEnabled && feedbackPassive) {
  try {
    if (shouldEnqueuePassive({ source: "passive", text: message })) {
      enqueueJob(repoRoot, {
        source: "passive",
        text: message,
        context,
      });
    }
  } catch (err) {
    console.error("[feedback] passive enqueue failed", err);
  }
}
```

Important: enqueue must **not** await validator/gh. Only `enqueueJob`.

6. Start runner after server created:

```js
const feedbackRunner = feedbackEnabled
  ? createFeedbackRunner({
      repoRoot,
      cwd: repoRoot,
      grokBin: feedbackGrokBin || grokBin,
      grokExtraArgs: feedbackGrokExtraArgs.length ? feedbackGrokExtraArgs : extraArgs,
      ghBin,
      ghExtraArgs,
      githubRepo: feedbackGithubRepo,
      enabled: feedbackEnabled,
      intervalMs: feedbackIntervalMs,
    })
  : null;
```

Return `{ server, listen, close, state, feedbackRunner, options }`.

In `close()`, stop the runner first.

- [ ] **Step 4: Run tests**

```bash
node --test tools/course-copilot-gate/test/feedback-server.test.mjs
node --test tools/course-copilot-gate/test/*.test.mjs
```

Expected: all pass (existing chat tests still green).

- [ ] **Step 5: Commit**

```bash
git add tools/course-copilot-gate/server.mjs \
  tools/course-copilot-gate/test/feedback-server.test.mjs
git commit -m "feat(course-feedback): wire gate feedback routes and runner"
```

---

### Task 8: Dock Feedback UI + toast + pure helpers

**Files:**
- Modify: `docs/sft-course-copilot.js`
- Modify: `docs/sft-interactive-playbook.html` (CSS)
- Modify: `docs/sft-course-check.mjs` (assert pure helpers if exported)

- [ ] **Step 1: Add pure helpers + check assertions**

In `sft-course-copilot.js` factory return (and use internally):

```js
function buildFeedbackPanelHtml() {
  return (
    '<div class="copilot-feedback" id="copilotFeedback" hidden>' +
    '  <div class="copilot-feedback-title">Feedback on course content</div>' +
    '  <textarea id="copilotFeedbackInput" class="copilot-feedback-input" rows="3" ' +
    '    placeholder="What is wrong or missing in this lesson?" ' +
    '    aria-label="Course content feedback"></textarea>' +
    '  <div class="copilot-feedback-actions">' +
    '    <button type="button" class="btn ghost small" id="copilotFeedbackCancel">Cancel</button>' +
    '    <button type="button" class="btn small" id="copilotFeedbackSubmit">Submit</button>' +
    "  </div>" +
    "</div>"
  );
}

function buildToastHtml(item) {
  var title = item && item.title ? String(item.title) : "Issue created";
  var url = item && item.url ? String(item.url) : "";
  var num = item && item.number != null ? "#" + item.number : "";
  return (
    '<div class="copilot-toast" role="status">' +
    '<div class="copilot-toast-title">Issue created' +
    (num ? " " + esc(num) : "") +
    "</div>" +
    '<div class="copilot-toast-body">' +
    esc(title) +
    "</div>" +
    (url
      ? '<a class="copilot-toast-link" href="' +
        esc(url) +
        '" target="_blank" rel="noopener noreferrer">Open on GitHub</a>'
      : "") +
    "</div>"
  );
}
```

Export `buildFeedbackPanelHtml` and `buildToastHtml` on the public API object (same pattern as scroll helpers).

In `docs/sft-course-check.mjs` require and assert:

```js
assert(typeof Copilot.buildFeedbackPanelHtml === "function", "buildFeedbackPanelHtml");
assert(typeof Copilot.buildToastHtml === "function", "buildToastHtml");
const panel = Copilot.buildFeedbackPanelHtml();
assert(panel.indexOf("copilotFeedback") !== -1, "feedback panel id");
const toast = Copilot.buildToastHtml({
  title: "m2l3 quiz",
  url: "https://github.com/xliberty2008x/training-agents/issues/1",
  number: 1,
});
assert(toast.indexOf("Issue created") !== -1, "toast label");
assert(toast.indexOf("issues/1") !== -1, "toast url");
```

- [ ] **Step 2: Run check — expect FAIL until dock updated**

Run: `node docs/sft-course-check.mjs`  
Expected: FAIL missing exports (then implement).

- [ ] **Step 3: Wire dock markup + behavior**

1. In `ensureDock` actions row, before Clear:

```html
<button type="button" class="btn ghost small" id="copilotFeedbackToggle">Feedback</button>
```

2. After `copilot-compose` footer (or before offline help), inject `buildFeedbackPanelHtml()`.

3. Add toast host:

```html
<div class="copilot-toast-host" id="copilotToastHost" aria-live="polite"></div>
```

4. `cacheEls`: feedback panel, input, submit, cancel, toggle, toastHost.

5. Behavior:

```js
var NOTIFY_MS = 4000;
var notifyTimer = null;

function setFeedbackOpen(open) {
  if (!els.feedback) return;
  els.feedback.hidden = !open;
}

async function submitFeedback() {
  if (!isSupportedOrigin() || status === "offline") return;
  var comment = els.feedbackInput ? String(els.feedbackInput.value || "").trim() : "";
  if (!comment) return;
  var ctx = null;
  try {
    ctx = player && player.getContext ? player.getContext() : null;
  } catch (_) {}
  try {
    await fetch("/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ comment: comment, context: ctx || {} }),
    });
  } catch (_) {
    /* silent — no toast on failure */
  }
  if (els.feedbackInput) els.feedbackInput.value = "";
  setFeedbackOpen(false);
}

async function pollNotifications() {
  if (!isSupportedOrigin()) return;
  try {
    var res = await fetch("/feedback/notifications", { cache: "no-store" });
    if (!res.ok) return;
    var data = await res.json();
    var items = (data && data.notifications) || [];
    if (!items.length) return;
    var ids = [];
    for (var i = 0; i < items.length; i++) {
      showToast(items[i]);
      ids.push(items[i].id);
    }
    await fetch("/feedback/notifications/ack", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: ids }),
    });
  } catch (_) {}
}

function showToast(item) {
  if (!els.toastHost) return;
  els.toastHost.innerHTML = buildToastHtml(item);
  // auto-clear after 8s
  setTimeout(function () {
    if (els.toastHost) els.toastHost.innerHTML = "";
  }, 8000);
}
```

6. Start `notifyTimer = setInterval(pollNotifications, NOTIFY_MS)` when online (alongside health poll); clear on destroy if any.

7. Wire click handlers for toggle / cancel / submit. Feedback does **not** push chat messages.

- [ ] **Step 4: CSS in playbook**

Add to `docs/sft-interactive-playbook.html` style block:

```css
.copilot-feedback{margin:.5rem .75rem .65rem;padding:.7rem .75rem;border-radius:14px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.05)}
.copilot-feedback-title{font-size:.82rem;font-weight:850;margin-bottom:.4rem;color:#eaf0ff}
.copilot-feedback-input{width:100%;min-height:4.5rem;border-radius:12px;border:1px solid rgba(255,255,255,.14);background:rgba(0,0,0,.22);color:#eef3ff;padding:.55rem .65rem;box-sizing:border-box}
.copilot-feedback-actions{display:flex;justify-content:flex-end;gap:.4rem;margin-top:.45rem}
.copilot-toast-host{position:absolute;right:.75rem;bottom:.75rem;z-index:20;max-width:min(280px,92%);pointer-events:none}
.copilot-dock .copilot-panel{position:relative}
.copilot-toast{pointer-events:auto;padding:.65rem .75rem;border-radius:12px;border:1px solid rgba(117,225,173,.35);background:rgba(15,138,85,.92);color:#ecfdf5;box-shadow:0 10px 28px rgba(0,0,0,.35);font-size:.8rem;line-height:1.35}
.copilot-toast-title{font-weight:850;margin-bottom:.2rem}
.copilot-toast-link{color:#ecfdf5;text-decoration:underline;font-weight:750}
```

Ensure `.copilot-panel` is `position:relative` so toast anchors correctly.

- [ ] **Step 5: Run checks**

```bash
node docs/sft-course-check.mjs
node --test tools/course-copilot-gate/test/*.test.mjs
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add docs/sft-course-copilot.js \
  docs/sft-interactive-playbook.html \
  docs/sft-course-check.mjs
git commit -m "feat(course-feedback): dock Feedback panel and issue toast"
```

---

### Task 9: README + env docs + final verification

**Files:**
- Modify: `tools/course-copilot-gate/README.md`
- Optionally mention in root `AGENTS.md` copilot table if a one-line pointer fits existing style

- [ ] **Step 1: Document feedback in gate README**

Add section **Course feedback → GitHub issues**:

- Dock **Feedback** submits `POST /feedback` (background).
- After successful chat, passive candidates may enqueue if message looks like a content defect.
- Validator is a separate one-shot Grok (not tutor session).
- Issues created with `gh issue create --repo xliberty2008x/training-agents`.
- Requires `gh auth login` and permission on that fork.
- Toast only when an issue is created.
- Env:

| Env | Default |
|---|---|
| `FEEDBACK_ENABLED` | `true` |
| `FEEDBACK_PASSIVE` | `true` |
| `FEEDBACK_GITHUB_REPO` | `xliberty2008x/training-agents` |
| `GH_BIN` | `gh` |

- Mock testing note: `feedbackGrokExtraArgs` / `GH_BIN=node` + `mock-gh.mjs` as in tests.

- [ ] **Step 2: Full verification**

```bash
node docs/sft-course-check.mjs
node --test tools/course-copilot-gate/test/*.test.mjs
```

Expected: all green.

- [ ] **Step 3: Manual smoke (optional, live)**

```bash
# terminal 1
export GROK_BIN="$(which node)"
export GROK_EXTRA_ARGS='["tools/course-copilot-gate/mock-grok.mjs"]'
# For live issue create use real grok + real gh; for dry pipeline use mocks via createServer options in a small script.
node tools/course-copilot-gate/server.mjs
```

Open playbook → Feedback → submit a clear content bug → with live `gh` + real validator, confirm issue + toast.

- [ ] **Step 4: Commit**

```bash
git add tools/course-copilot-gate/README.md
git commit -m "docs(course-feedback): document feedback pipeline and gh requirement"
```

---

## Self-review (plan vs spec)

| Spec requirement | Task |
|---|---|
| Explicit dock Feedback | Task 8 |
| Validate before create | Tasks 4, 6 |
| Conservative passive post-chat | Tasks 1, 7 |
| Issues on fork via `gh` | Tasks 5, 6, 7 |
| Background, not tutor session | Tasks 6, 7 |
| Toast only on create | Tasks 2, 6, 8 |
| Fail closed / silent discard | Tasks 6, 8 |
| Queue / notify / dedupe storage | Tasks 2, 3 |
| Tests + mocks | Tasks 1–7, 9 |
| README | Task 9 |

No TBD placeholders. Types consistent: job `{ id, source, text, context, status }`, notification `{ id, number, url, title, seen }`, verdict `{ valuable, title, body, labels, reason }`.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-22-course-feedback-issues.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — execute tasks in this session with checkpoints  

Which approach?
