# LOOP — autonomous build protocol

You are one turn of an autonomous build loop for **gitwrapped**. A scheduled task
starts a fresh session every hour. You have no memory of earlier turns: everything you
know lives in this folder and in git history. Follow this protocol exactly.

## 0. Preflight
1. Clone/fetch `furkycl/gitwrapped`, check out `main`, pull.
2. If `.loop/STOP` exists → write one line to `STATE.md` ("stopped by STOP file"), commit, push, end the turn.
3. If `.loop/DONE` exists → end the turn and tell the owner the project is done so they can delete the scheduled task.
4. If an open PR from a previous turn exists (`loop/*` branch not merged), finish it first (fix CI / review comments / merge) instead of starting new work.

## 1. Pick work
- Open `.loop/ROADMAP.md`. Take the **first unchecked task** whose milestone has no blocked dependencies.
- Skip tasks marked `[!]` (blocked). Never pick more than **2 tasks per turn**.
- If the task is too big for one turn, split it in ROADMAP.md into smaller sub-tasks and do the first one.

## 2. Branch
`git checkout -b loop/<NNN>-<short-slug>` where NNN is the next turn number from STATE.md.

## 3. Build with subagents
Spawn subagents in this order (one message, roles below):
- **builder** — implements the task, keeps the change small and focused.
- **tester** — writes/updates tests with `node:test`, runs `npm test`, reports failures.
- **reviewer** — reads the diff cold (has not seen the work), checks it against the task text and the Rules section, lists concrete problems.
Fix what the tester and reviewer report. Up to 3 fix attempts.

## 4. Ship
- All tests pass → commit (conventional commits: `feat:`, `fix:`, `test:`, `docs:`, `chore:`), push branch, open PR titled `[loop NNN] <task>`, then squash-merge into `main` and delete the branch.
- Still failing after 3 attempts → mark the task `[!]` in ROADMAP.md with a one-line reason, commit that on main, and send the owner a notification.

## 5. Record
- Tick the task `[x]` in ROADMAP.md.
- Append to STATE.md: turn number, date (UTC), task, PR link, result, one-line note for the next turn.
- Commit `chore(loop): turn NNN` to main and push.
- If every task in ROADMAP.md is `[x]` → create `.loop/DONE`, commit, push, notify the owner.

## Rules
- Never force-push. Never rewrite main's history. Never commit secrets.
- Node >= 20, plain ESM JavaScript, as few dependencies as possible.
- Everything runs locally. No network calls, no telemetry, no API keys.
- Every feature ships with tests. `npm test` must stay green on main.
- Keep README.md in sync with what actually works.
- Do not edit LOOP.md itself. Owner edits it.
