# Issue Tracker: GitHub Issues

GitHub Issues at <https://github.com/FilthyS/book-title-lookup/issues> is the
sole source of truth for this repository's tickets:

- **status** — the issue's open or closed state;
- **dependency links** — `Blocked by: #n` lines in the issue body;
- **assignment** — the issue assignee;
- **discussion** — the issue comments and linked pull requests.

No local Markdown is maintained as a live duplicate or source of status.
Planning files under `.scratch/` are historical migration snapshots and may
repeat the original ticket content; treat them as provenance, never as live
status.

## Labels

Tickets are classified with these labels:

- `type: research` — external or technical research that grounds a decision.
- `type: prototype` — a throwaway prototype that answers a design question.
- `type: grilling` — a decision ticket requiring tradeoff analysis.
- `type: task` — an implementation task.
- `phase: planning` — part of the MVP planning effort.
- `worker: pi` — delegated to a local pi worker.

## Dependencies

Express prerequisites in the issue body as:

```text
Blocked by: #42
```

`#n` is a GitHub issue number and renders as a link to that ticket. An issue
with open blockers is not actionable; pick it up only once every blocker it
names is closed.

## Lifecycle

1. **Open** — a ticket is created as a GitHub issue. The issue state (open or
   closed) is authoritative from here on.
2. **Label and guide** — when a ticket is ready to work, apply its `type:`
   label (and `phase:` / `worker:` labels when they apply) and post an
   implementation-guide comment describing what a correct resolution looks
   like.
3. **Claim** — a human contributor self-assigns before starting work with
   `gh issue edit <number> --add-assignee @me`. If permissions prevent
   self-assignment, request it in an issue comment and start only once
   assigned.
4. **Work** — `type: task` tickets are implemented on an isolated branch and
   opened as a pull request. `type: research`, `type: grilling`, and
   `type: prototype` tickets produce findings, a decision, or a throwaway
   prototype; record the outcome in the issue, plus any doc changes the
   ticket calls for.
5. **Resolve** — close only once the outcome is accepted: merge the pull
   request that carries `Closes #n` after review (implementation), or close
   after the accepted research or decision evidence is recorded in the issue
   (research, grilling, prototype). Nothing in the repository marks closure;
   GitHub state is the record.

## Local pi workers

A human coordinator is accountable for each ticket and manages its GitHub
state. To hand execution to a local pi worker, the coordinator keeps the
assignment, applies the `worker: pi` label, and posts a named
implementation-guide comment that records the delegation and states the
expected deliverable. The pi worker consumes the issue read-only, works in
isolation on a branch, and reports the resulting commit (or research answer),
changed files, checks run, and any blockers or risks back to the coordinator.
Pi workers do not self-assign, change issue state, or manage the ticket on
GitHub; the coordinator reviews the reported result and handles the GitHub
resolution (see Resolve above).

## Historical planning snapshots

`.scratch/mvp-implementation/` holds the planning map and ticket files that
predate GitHub Issues; they were migrated to GitHub Issues #1–#14. Treat them
as migration provenance and planning snapshots only — never as live status and
never as a source of truth. Do not read current ticket state from them or
record resolutions in them.
