# SFT Course Copilot Gate — Design Spec

**Date:** 2026-07-21  
**Status:** Approved for implementation planning  
**Scope:** Local-only course tutor: chat dock in the SFT interactive HTML course, backed by one durable Grok harness session via a small localhost gate.

## 1. Problem

The SFT interactive course (`docs/sft-interactive-playbook.html` + `sft-course-lib.js` + `sft-course-data.js`) is a standalone browser player. Learners often need answers about the current lesson, SFT concepts, TRL mechanics, and mentor-lab scripts without leaving the page.

We want a **course-side copilot plugin** that:

- Lives **inside the course HTML UI**
- Uses the **real Grok harness** (not a bare xAI chat API)
- Knows **where the learner is** (module, lesson, progress)
- Stays **basic**: one session, no multi-session product surface

## 2. Goals

1. Answer course questions from a right-docked chat panel while the learner is on a lesson.
2. Preserve Grok agent capability for **read/search** of the course repo (file-aware).
3. Inject **live position + progress** so answers are grounded in the current module/lesson.
4. Keep the course fully usable when the gate is offline.
5. One durable Grok session per machine/course workspace (create once, resume forever until reset).

## 3. Non-goals (v1)

- Multi-session UI or session switcher
- Multi-user / hosted / cloud deployment
- Full `--yolo` write autonomy for the tutor
- Token streaming / live tool-event theater (optional later)
- Iframe-hosted separate chat product
- Changing course pedagogy content except minimal UI shell for the dock
- Replacing Module 7 “task a copilot” teaching with this tutor

## 4. Decisions (locked)

| Topic | Decision |
|---|---|
| Runtime | **A** Local-only tutor: localhost gate + one Grok session |
| Knowledge | **A** File-aware Grok with `cwd` = training-agents repo |
| Position awareness | Inject current lesson/module + progress every chat turn |
| Tool power | **A** Read-heavy tutor (not full yolo) |
| Session lifecycle | **A** One durable session per machine/course; resume across reloads |
| Offline behavior | **A** Course works; chat optional with offline UI |
| Layout | **B** Right-docked panel |
| Architecture approach | **1** Local HTTP gate + course JS plugin |

## 5. Architecture

```text
Course page (HTML player)
  ├── Sidebar (lessons / progress)     [existing]
  ├── Main lesson content              [existing]
  └── Copilot dock plugin (right)      [new]
            │
            │  HTTP 127.0.0.1 only
            ▼
Local gate (single process)
  ├── GET  /health
  ├── GET  /status
  ├── POST /chat
  ├── POST /session/reset
  └── optional static serve of docs/
            │
            │  headless grok -p / -r
            ▼
Grok harness
  cwd = repo root
  read-heavy tools
  durable session id on disk
```

**Rules**

- The course never calls xAI directly; only the gate invokes Grok.
- The gate binds to `127.0.0.1` (not `0.0.0.0`) in v1.
- Exactly one durable session for this course workspace.
- If the gate is down, the dock shows offline help; quizzes/progress/labs keep working.

## 6. Components

### 6.1 Course plugin

**Files (planned)**

- `docs/sft-course-copilot.js` — UI + gate client + context builder
- Minimal CSS for the right dock lives in `docs/sft-interactive-playbook.html` (same pattern as existing styles; no extra CSS file unless the style block becomes unwieldy)
- Script include from the playbook HTML after `sft-course-lib.js` and `sft-course-data.js`

**Responsibilities**

- Expand the app layout to include a right-hand copilot column (stack under content on narrow screens).
- Maintain a live **context snapshot** from the player state:
  - Current view: `home` | `lesson` | `capstone`
  - `lessonId`, module name, lesson title
  - Progress: completed count, total (including capstone), percent, completed ids
- Render a simple chat transcript (user/assistant bubbles) in browser `localStorage` (UI-only).
- Poll or check `GET /health` for online/offline chip.
- `POST /chat` with message + context; disable send while a turn is in flight.
- Offline UI: short “start the local gate” instructions + retry.

**Context source of truth**

- Player state key: `sft-course-player-v3` (existing).
- Helpers already in `SFTCourse` (`completedCount`, `lessonCount`, `progressPercent`, `ensureState`, etc.).
- Active lesson: player’s current navigation (`last` and/or active lesson DOM); plugin must use the same notion of “current lesson” the UI shows.

### 6.2 Local gate

**Location**

- `tools/course-copilot-gate/` (keeps `docs/` focused on course content; gate is tooling)

**Stack:** Node.js HTTP server (matches existing `docs/sft-course-check.mjs` / e2e Node toolchain; no new language runtime required for course verification).

**Endpoints**

| Method | Path | Role |
|---|---|---|
| `GET` | `/health` | Process up; whether `grok` binary is resolvable; session present yes/no |
| `GET` | `/status` | Session metadata (id may be truncated), last error, tool policy label, cwd |
| `POST` | `/chat` | Run one turn: message + `CourseContext` → assistant text |
| `POST` | `/session/reset` | Delete durable session store; next chat creates a new session |
| `GET` | static `docs/*` | Optional: serve course over HTTP to avoid `file://` CORS friction |

**Config (env / flags, v1 defaults)**

- `HOST=127.0.0.1`
- `PORT=8787` (or next free; document default)
- `COURSE_REPO` = absolute path to training-agents root
- `GROK_BIN` = `grok` on PATH
- Session store path (see §7)

### 6.3 Session store

Single file, not a session list:

```json
{
  "sessionId": "<uuid>",
  "createdAt": "<iso>",
  "cwd": "<absolute repo path>",
  "course": "sft-interactive-playbook"
}
```

**Path:** `workspaces/course-copilot/session.json` (repo already ignores `workspaces/`).  
Durable across browser reloads and gate restarts until explicit reset. Create parent dirs on first run.

### 6.4 Grok invocation wrapper

Each `/chat` turn:

1. Load session store; if missing, create a new UUID session (headless create / first `-p` that returns `sessionId` with `--output-format json`).
2. Build prompt from tutor rules + structured `CourseContext` + user message.
3. Invoke headless Grok roughly as:
   - resume: `grok -p <prompt> -r <sessionId> --cwd <repo> --output-format json`
   - plus read-heavy tool policy (allowlist and/or denylist; see §8)
4. Parse assistant text from JSON result; return to client.
5. On “session not found / invalid” errors: allocate a new session, rewrite store, return answer with a short “session was reset” notice in metadata.

**v1 response shape (non-streaming):**

```json
{
  "ok": true,
  "text": "…",
  "sessionId": "…",
  "reset": false,
  "error": null
}
```

### 6.5 Tutor rules

Fixed rules string (gate-owned file, e.g. `tools/course-copilot-gate/tutor-rules.md`):

- You are the in-page tutor for the SFT Interactive Course in this repository.
- Prefer reading course files (`docs/sft-course-data.js`, playbook, mentor-lab README/scripts) when unsure.
- The injected **CourseContext** is ground truth for where the learner is. Do not claim they completed lessons not listed in `completedIds`.
- Reinforce course integrity: no quality claims without eval artifacts; distinguish loss vs behavior evidence.
- Stay read-heavy: explain and point to lessons/scripts; do not rewrite course content or run training jobs unless the learner explicitly asks and tools allow (v1 should not allow write/train).
- Keep answers concise and lesson-aware; offer “next lesson” guidance only when asked or clearly helpful.

## 7. Data flow

### 7.1 Send path

```text
1. Plugin builds CourseContext from player state + active view
2. POST /chat { message, context, clientMeta }
3. Gate ensures durable sessionId
4. Gate builds prompt: [rules][context block][user message]
5. Gate runs headless Grok (resume, read-heavy, cwd=repo)
6. Gate returns { ok, text, sessionId, reset? }
7. Plugin appends assistant message to dock transcript
```

### 7.2 `CourseContext` (v1)

```json
{
  "course": "sft-interactive-playbook",
  "view": "lesson",
  "lessonId": "m2l3",
  "module": "Module 2 — …",
  "lessonTitle": "…",
  "progress": {
    "completedCount": 4,
    "totalLessons": 21,
    "percent": 19,
    "completedIds": ["o1", "m1l1", "m1l2", "m1l3"]
  },
  "capstoneComplete": false
}
```

**Position contract in the prompt (every turn):**

> Learner is on module X, lesson Y (id Z). Progress: N/M lessons complete (P%).  
> Treat CourseContext as ground truth for location and completion.

**Navigation:** v1 does **not** auto-call Grok on every lesson change. The next user message carries the new context.

### 7.3 Transcript storage

| Layer | Storage | Role |
|---|---|---|
| UI transcript | browser `localStorage` (key namespaced, e.g. `sft-course-copilot-ui-v1`) | Display only |
| Model memory | Grok durable session via `-r` | Conversation continuity |
| Course progress | existing `sft-course-player-v3` | Unchanged |

**Course Reset:** when the player resets progress, also call `POST /session/reset` and clear UI transcript (default yes) so location claims stay coherent.

## 8. Tool policy (read-heavy)

Intent: real harness for explaining course materials; not a free editor.

**Allow (examples):** `read_file`, `grep`, `list_dir` (and equivalents Grok exposes for search/read).

**Deny / disallow (examples):** `search_replace`, write tools, destructive shell, broad `run_terminal_cmd` unless a tight allowlist proves necessary later.

Use headless `--tools` / `--disallowed-tools` (and/or permission `--deny` rules) so the policy is enforced by the harness, not only by the prompt.

Exact flag list is fixed in the implementation plan against the installed Grok CLI version.

## 9. UI

- **Desktop:** three-column feel — existing sidebar | lesson | copilot dock.
- **Narrow:** dock stacks below lesson content; remain usable.
- Dock chrome:
  - Title: “Course copilot”
  - Status chip: `online` | `offline` | `error`
  - Message list + input + Send
  - Optional “Clear session” control → `POST /session/reset` + clear UI transcript
- Visual language: match existing course tokens (`--accent`, dark sidebar, white shell) without a separate design system.

## 10. Error handling

| Situation | Behavior |
|---|---|
| Gate not running | Offline chip + start instructions; course unchanged |
| Grok missing / unauthenticated | `/health` reports unavailable; chat disabled with clear message |
| Timeout / process crash | Error JSON; plugin “try again”; keep session id unless create failed |
| Invalid session on resume | New session; replace store; `reset: true` metadata |
| Empty message | Client-side reject |
| `file://` CORS issues | Document preferred open path via gate static server |
| Concurrent sends | Disable send while in-flight (single turn) |

No silent failures: status chip always reflects last known gate health.

## 11. Security & privacy

- Bind localhost only.
- No multi-tenant auth in v1 (trust = local machine user).
- Prompts may include course progress and lesson titles; model traffic still follows the user’s Grok/xAI account terms.
- Do not log full chat bodies to tracked repo paths; gate logs go under ignored `workspaces/` or user config dirs.
- Read-heavy policy reduces accidental course mutation.

## 12. Testing & validation

| Layer | Check |
|---|---|
| Unit | Context builder from fake player state → correct `CourseContext` |
| Unit | Prompt assembly includes lesson + progress block |
| Integration (Grok available) | health → chat “what lesson am I on?” with injected context → answer references that lesson |
| Integration (no Grok / no gate) | Course HTML + quizzes still work; dock offline |
| Regression | Existing `docs/sft-course-check.mjs` and e2e still pass |
| Manual smoke | Start gate → open course → online → ask about current module → navigate → next ask uses new context |

## 13. Repo boundaries (Agents.md)

- No large checkpoints, datasets, or experiment logs in the tracked repo.
- Gate session files and runtime logs stay ignored (`workspaces/`, user `~/.grok/…`).
- Prefer a minimal template + short README for how to start the gate; not a full training stack.
- Do not claim the copilot “improves learning outcomes” without an eval protocol (out of scope).

## 14. Implementation sketch (for planning, not binding)

1. Scaffold gate with `/health` and stub `/chat`.
2. Session store create/resume + headless Grok wrapper with read-heavy policy.
3. Course plugin UI dock + health polling.
4. Wire `CourseContext` from player state; include script in playbook HTML.
5. Reset coupling + static serve of `docs/`.
6. Tests + smoke notes in README.
7. Optional: light streaming later (Approach 2) without changing context contract.

## 15. Success criteria

v1 is done when:

1. With gate + authenticated local Grok, a learner can open the course, see an online right dock, and get an answer that reflects **their current lesson** and **progress**.
2. Grok can read course files to ground answers beyond the injected snippet.
3. Without the gate, the course player behaves as today.
4. Only one session is used; reset is explicit.
5. Existing course verification scripts still pass.
