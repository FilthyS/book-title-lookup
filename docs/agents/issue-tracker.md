# Issue Tracker: Local Markdown

Issues and implementation specs for this repository live as Markdown files
under `.scratch/`.

## Conventions

- One effort per directory: `.scratch/<effort>/`.
- A Wayfinder map is `.scratch/<effort>/map.md`.
- A future implementation spec is `.scratch/<effort>/spec.md`.
- Tickets are individual files at
  `.scratch/<effort>/issues/<NN>-<slug>.md`.
- `Type:` is one of `research`, `prototype`, `grilling`, or `task`.
- `Status:` is one of `open`, `claimed`, or `resolved`.
- Conversation history, when needed, is appended under `## Comments`.

## Wayfinding Operations

- **Blocking**: `Blocked by: NN, NN` names prerequisite ticket numbers.
- **Frontier**: open tickets with no unresolved blockers, ordered by number.
- **Claim**: change `Status: open` to `Status: claimed` before doing any work.
- **Resolve**: append the resolution under `## Answer`, change the status to
  `resolved`, and append a one-line linked gist to the map's
  `Decisions so far`.
- **Fog graduation**: when a resolution makes a fog item precise, create its
  ticket, wire blockers, and remove the item from `Not yet specified`.

Open tickets are discovered by scanning the effort's `issues/` directory. They
are not duplicated in the map body.

