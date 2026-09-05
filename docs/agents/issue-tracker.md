# Issue Tracker: GitHub Issues

GitHub Issues at <https://github.com/FilthyS/book-title-lookup/issues> is the
sole source of truth for this repository's tickets:

- **status** — the issue's open or closed state;
- **dependency links** — `Blocked by: #n` lines in the issue body;
- **assignment** — the issue assignee;
- **discussion** — the issue comments and linked pull requests.

There is no other active tracker: nothing under `.scratch/` reflects live
state, and no local Markdown file duplicates a ticket.

Humans and local `pi` workers manage tickets through GitHub alone, using the
web UI or the `gh` CLI.

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
   label (and `phase:` / `worker:` labels when they apply), assign an owner,
   and post an implementation-guide comment describing what a correct
   resolution looks like.
3. **Isolated worker branch** — the worker checks out an isolated branch from
   the default branch, implements the change, runs the checks, and opens a
   pull request that references the issue.
4. **Review** — the pull request is reviewed against the guide comment and the
   ticket's goal; discussion happens in the issue and pull request.
5. **Close** — when the change is merged and the goal is met, the issue is
   closed. The GitHub state is the record; nothing is updated in the
   repository to mark closure.

## Local pi workers

Local `pi` workers pick up tickets that carry the `worker: pi` label. A
delegated ticket states its goal and acceptance criteria in the issue and its
guide comment. The worker works on an isolated branch, never on the default
branch, and reports back the commit hash, changed files, checks run, and any
blockers or risks. pi workers do not push to the default branch, change issue
state, or act on the repository outside the work they were delegated.

## Historical planning snapshots

`.scratch/mvp-implementation/` contains the planning map and ticket files that
predate GitHub Issues. The MVP planning tickets there were migrated to GitHub
Issues #1–#14, and GitHub Issues is now authoritative. Treat those files as
historical migration provenance and planning snapshots only: never as live
status. Do not read current ticket state from them or record resolutions in
them.
