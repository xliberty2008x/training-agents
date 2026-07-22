# Course Feedback → GitHub Issues — Design Spec

**Date:** 2026-07-22  
**Status:** Approved in brainstorming — ready for implementation planning  
**Scope:** Background course-content feedback pipeline for the SFT interactive playbook + course-copilot gate: validate comments (and conservative post-chat signals), create GitHub issues on the maintainer’s fork via `gh`, notify the dock only when an issue is created.

**Related:** [[docs/superpowers/specs/2026-07-21-course-copilot-gate-design.md]], [[tools/course-copilot-gate/]], [[docs/sft-course-copilot.js]]

---

## 1. Problem

Learners and authors notice course content problems (wrong facts, broken quizzes, missing steps) while using the interactive playbook and the right-dock copilot. Today there is no structured path from “this lesson is wrong” to a tracked GitHub issue without leaving the course and filing by hand.

We want:

1. An explicit **Feedback** path in the copilot dock for course comments.
2. **Conservative** passive detection from user chat turns that clearly assert a content defect.
3. **Validation** before any issue is created (discard low-value or non-content noise).
4. Issue creation on **`xliberty2008x/training-agents`** via **`gh`**.
5. Work done by a **background pipeline** (validator agent + gate `gh`), **never** as part of the main tutor session or chat latency.
6. **Minimal UI:** toast only when an issue is actually created.

## 2. Goals

1. Capture explicit course-content feedback without blocking tutoring.
2. Optionally surface clear content bugs implied by user questions, with a strong bias toward **not** filing.
3. Create well-formed GitHub issues (title, body with lesson context, labels when available).
4. Keep the tutor harness read-only and Agent-disallowed; no issue tools on the durable tutor session.
5. Fail closed and silently for the learner (no toast on discard or infrastructure failure).
6. Stay local-only: same gate origin model as the existing copilot.

## 3. Non-goals (v1)

- Multi-repo routing, auto-PRs to upstream, or configurable default repo UI
- Product / copilot UX bug triage (content quality only)
- In-app issue browser or full feedback history UI
- Streaming validator progress into the chat transcript
- Tutor session using Agent tools or `gh`
- Confirming discarded feedback in the UI (“thanks / not valuable”)
- Multi-user hosted deployment or shared issue quotas
- Guaranteeing zero duplicate issues across remote history (local + light `gh` dedupe only)

## 4. Decisions (locked)

| Topic | Decision |
|---|---|
| Purpose | Course **content** quality only |
| Architecture | Async jobs **inside** the existing gate (Approach A) |
| Passive detection | **Conservative** — only clear content defects |
| Explicit UI | **Feedback** control in the copilot dock |
| User visibility | Toast **only** when an issue is created |
| Issue target | `xliberty2008x/training-agents` (fixed in v1) |
| Auth | `gh` CLI (machine’s existing `gh auth`) |
| Validation | One-shot Grok **validator** (not tutor session) |
| Issue create | Gate runs `gh issue create` from validated draft (deterministic) |
| Tutor path | Unchanged critical path; never waits on feedback |
| Concurrency | Feedback runner **off** the chat mutex |

## 5. Architecture

```text
Browser (dock, same origin)
  │
  ├─ POST /chat ──► tutor Grok (durable session, read-only tools)
  │                    │
  │                    ├─► AG-UI reply to dock (unchanged)
  │                    └─► fire-and-forget: prefilter may enqueue passive candidate
  │
  ├─ POST /feedback ──► enqueue explicit candidate → { ok, queued: true }
  │
  └─ GET /feedback/notifications ──► unseen created issues → toast + ack

Gate background runner (same Node process, not chat mutex)
  │
  ▼
  dequeue job
  │
  ▼
  Validator subagent (one-shot Grok)
    structured: { valuable, title, body, labels? }
  │
  ├─ valuable=false ──► mark done / skipped (silent)
  └─ valuable=true
         │
         ▼
       gh issue create --repo xliberty2008x/training-agents
         │
         ▼
       append notification (title, url, number)
```

**Hard rules**

1. The durable tutor session never creates issues and never awaits validation.
2. Issue work is separate one-shot validation + `gh`, not mid-chat Agent.
3. Toast only after a successful create.
4. Feedback failures never alter `/chat` success/error semantics.

## 6. Components

### 6.1 Dock (`docs/sft-course-copilot.js`)

- **Feedback** control in dock chrome (alongside Clear session).
- Panel: textarea + Submit (not part of the chat transcript).
- Submit → `POST /feedback` with `{ comment, context }` using the same `CourseContext` as chat (`SFTCoursePlayer.getContext()`).
- No UI for “queued,” “discarded,” or “thanks.”
- While online, poll `GET /feedback/notifications` on a modest interval (e.g. 3–5s).
- On new notifications: small toast with **title** + **link** to the issue; mark seen (ack).
- Offline / `file://`: Feedback disabled or shows same gate-required help as chat (no false “submitted” state).

### 6.2 Gate HTTP API (extend `tools/course-copilot-gate/`)

| Method | Path | Role |
|---|---|---|
| `POST` | `/feedback` | Enqueue explicit feedback; body `{ comment, context }`; returns immediately |
| `GET` | `/feedback/notifications` | List unseen (or since cursor) created issues |
| `POST` | `/feedback/notifications/ack` | Mark notification ids seen (or equivalent query ack) |
| existing | `/chat` | After **successful** tutor turn, may enqueue passive candidate |

Health/status may optionally report `feedbackBusy`, `ghAvailable` (non-blocking hints only).

### 6.3 Feedback modules (new under gate)

Suggested layout (implementer may collapse files if tiny):

| Module | Responsibility |
|---|---|
| `feedback/queue.mjs` | Enqueue, persist, single-worker process loop |
| `feedback/prefilter.mjs` | Cheap passive prefilter (explicit always queued) |
| `feedback/validate.mjs` | Spawn one-shot validator Grok; parse structured verdict |
| `feedback/create-issue.mjs` | Run `gh issue create`; parse URL/number |
| `feedback/notify.mjs` | Notification ring buffer + ack |
| `feedback/dedupe.mjs` | Fingerprints and skip duplicates |

### 6.4 Validator subagent

- **One-shot** headless Grok process (no durable feedback session required in v1).
- **Not** resumed with the tutor session id.
- Tools: read-only (`read_file`, `grep`, `list_dir`) so it can check lesson sources if needed; **Agent disallowed**; no `--yolo`.
- Prompt: course-content triage only; conservative default **not valuable**.
- Output: machine-parseable JSON (stdout or fenced block), schema:

```json
{
  "valuable": false,
  "title": "",
  "body": "",
  "labels": ["course-content", "sft-playbook"],
  "reason": "short explanation for logs only"
}
```

When `valuable` is true, `title` and `body` must be non-empty and actionable.

### 6.5 Issue creation (`gh`)

```bash
gh issue create \
  --repo xliberty2008x/training-agents \
  --title "<title>" \
  --body "<body>"
```

- Optional `--label` only for labels that exist on the repo (or create labels out of band; v1 may omit labels if create fails on missing labels — prefer title/body always, labels best-effort).
- Body must include:
  - Source: `explicit` | `passive`
  - Lesson / module ids and titles from context when present
  - Sanitized user comment or user message excerpt
  - Note that issue was auto-proposed by course feedback pipeline
- Never put secrets, tokens, or full local absolute paths that leak home directories unnecessarily (repo-relative paths OK).

### 6.6 Local storage (`workspaces/course-copilot/`, gitignored)

| File | Purpose |
|---|---|
| `feedback-queue.jsonl` | Pending/done/skipped jobs |
| `feedback-notifications.json` | Created issues for toast poll |
| `feedback-dedupe.json` | Recent fingerprints |

Session store for the tutor (`session.json`) remains unchanged and separate.

## 7. Candidate pipeline

### 7.1 Explicit feedback

1. User submits Feedback panel.
2. Gate validates body (non-empty comment, size limit).
3. Enqueue job `{ id, source: "explicit", comment, context, createdAt }`.
4. Return `{ ok: true, queued: true }` immediately (202/200).

### 7.2 Passive (post-chat)

1. After tutor turn completes successfully, run **prefilter** on the **user message** (not assistant text).
2. Prefilter should pass only messages that look like defect claims (e.g. “wrong,” “bug,” “contradicts,” “quiz is broken,” “step fails,” explicit “error in lesson”) — tunable allowlist/heuristics; default strict.
3. If prefilter fails → no enqueue.
4. If pass → enqueue `{ source: "passive", userMessage, context, chatTurnId? }`.
5. Never delay the `/chat` HTTP response for validation or `gh`.

### 7.3 “Valuable” criteria (validator)

**Create issue when** the candidate describes a concrete course content problem, e.g.:

- Factual error in lesson text
- Missing prerequisite or broken lab step
- Quiz option wrong or unanswerable as written
- Contradictory instructions across modules
- Code/snippet that cannot run as written

**Discard (silent) when:**

- Vague confusion with no concrete defect
- Preference, tone, or difficulty-only feedback
- User misunderstanding already addressed by lesson material
- Copilot / gate / product requests
- Duplicate of a recent fingerprint or clearly open same-title issue

**Default: not valuable.**

### 7.4 Dedupe

Fingerprint: `lessonId` (or `view`) + normalized hash of core claim text.

- Check local `feedback-dedupe.json` before create.
- Optional: light `gh issue list --repo … --search …` or title match if cheap; skip if clear duplicate.
- On successful create, record fingerprint.

### 7.5 Queue policy

- Process **one feedback job at a time** in the background runner.
- Cap queue length (e.g. 50). If full: drop oldest **passive** first; refuse or drop oldest explicit only if still full (prefer return error on explicit enqueue when full).
- Validator/Grok/gh timeouts: mark job skipped/failed, log, no tight retry loops (at most one retry for `gh` create).

## 8. Notifications & toast UX

1. Successful `gh issue create` → append `{ id, number, url, title, createdAt, seen: false }`.
2. Dock polls notifications; shows a **small toast** (title + open link).
3. Ack marks `seen: true` (or removes from unseen list).
4. No toast for discard, queue, validator failure, or `gh` missing.

## 9. Error handling

| Failure | Behavior |
|---|---|
| `gh` not installed or not authenticated | Log; skip create; no toast |
| Validator timeout / invalid JSON | Skip job; log; no toast |
| `gh issue create` fails | Log; optional single retry; no toast |
| Chat mutex busy | Unaffected; feedback runner is separate |
| Body too large on `/feedback` | 413/400; no enqueue |
| Gate down / `file://` | Dock offline; no fake success |

Logs stay server-side (stdout / optional local log file under workspaces). Do not stream failure details into the chat transcript.

## 10. Security & trust

- Gate remains **127.0.0.1** only; same-origin static serve of `docs/`.
- Feedback endpoints follow the same local trust model as `/chat` (optional `GATE_TOKEN` remains out of scope if still unimplemented for chat).
- `gh` uses the developer’s existing credentials; issues appear as that GitHub user on the fork.
- Do not enable open CORS for feedback endpoints.
- Sanitize issue bodies (no raw credential-looking strings from env).

## 11. Configuration (env)

| Variable | Default | Role |
|---|---|---|
| `FEEDBACK_GITHUB_REPO` | `xliberty2008x/training-agents` | Issue target (fixed product default; env override for tests) |
| `FEEDBACK_ENABLED` | `true` | Kill switch |
| `FEEDBACK_PASSIVE` | `true` | Allow post-chat enqueue |
| `GH_BIN` | `gh` | CLI binary |
| Validator timeout / max turns | aligned with or lower than chat defaults | Bound cost |

v1 product decision remains “issues on the fork”; env exists for mocks and future flexibility without a settings UI.

## 12. Testing

- **Unit:** queue ops, prefilter, fingerprint/dedupe, notification ack, body builders.
- **HTTP:** `POST /feedback` immediate return; notifications list/ack; chat still mutex-isolated; feedback enqueue does not require chat lock.
- **Mocks:** mock Grok validator (`valuable` true/false fixtures); mock `gh` success/failure.
- **Dock:** Feedback panel present; submit calls API; toast only when notification payload non-empty (follow existing e2e/check patterns under `docs/`).
- **Regression:** existing gate tests and course checks still pass.

## 13. Implementation sketch (for planning)

1. Queue + storage + notifications modules with unit tests (no Grok).
2. `POST /feedback` + `GET/POST` notifications routes.
3. Validator spawn + mock fixtures.
4. `gh` create wrapper + mock.
5. Wire post-chat passive enqueue + prefilter.
6. Dock Feedback UI + toast + poll/ack.
7. README updates for `gh auth` requirement and feedback behavior.
8. End-to-end smoke with mocks.

## 14. Risks

| Risk | Mitigation |
|---|---|
| Cost: validator Grok per job | Prefilter; conservative passive; one-shot bounds; kill switch |
| Noise issues on fork | Strict validator criteria; dedupe; content-only scope |
| `gh` auth missing | Fail closed; document `gh auth login` in gate README |
| Queue competes with chat CPU | Separate mutex; single feedback worker; timeouts |
| Tutor pollution | Never share tutor session; never Agent on tutor |

## 15. Success criteria

1. User can submit Feedback from the dock without waiting on validation.
2. Valuable explicit feedback becomes a GitHub issue on `xliberty2008x/training-agents` with lesson context.
3. Non-valuable feedback creates **no** issue and **no** toast.
4. Passive path rarely files; only clear defect claims after prefilter + validator.
5. Tutor chat behavior, tool policy, and session lifecycle remain unchanged for the main path.
6. Toast appears only after successful create, with a working issue URL.

---

## Appendix A — Brainstorm summary

- Purpose: **A** course content quality  
- Passive: **A** conservative  
- Repo: **A** fork `xliberty2008x/training-agents`  
- UI entry: **A** dock Feedback  
- Visibility: **A** issue-only toast  
- Auth: **A** `gh` CLI  
- Architecture: **A** async jobs inside the gate  
