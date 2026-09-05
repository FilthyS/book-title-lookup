# Chart an implementation-ready MVP

## Destination

Produce an evidence-backed implementation specification for the Book Title
Lookup MVP, with every technical choice needed to decompose the build into
executable tickets made explicit.

## Notes

- This effort plans; it does not implement the application.
- Treat `CONTEXT.md`, `docs/product-spec.md`, `docs/architecture.md`,
  `docs/data-sources.md`, and the accepted ADRs as the baseline.
- Use domain language from `CONTEXT.md`; update it only when a domain concept
  actually changes.
- Use the `research` skill for external API and runtime facts.
- Use the `prototype` skill for the terminal rendering decision.
- Use `grilling` and `domain-modeling` for human decisions.
- Use `codebase-design` when deciding module interfaces and seams.
- Refer to tickets by their linked title, not by a bare number.
- Artifacts and ticket answers are written in English.
- Registry publication and external service writes remain prohibited without
  separate explicit approval.

## Decisions so far

<!-- Closed ticket decisions are appended here as linked one-line gists. -->

## Not yet specified

- The exact application message/effect vocabulary cannot be fixed until the
  catalog interface, evidence outcomes, and terminal rendering strategy are
  known.
- The final vertical-slice order and acceptance gate for each slice depend on
  the chosen interfaces, adapters, and release topology.
- Any necessary revision to the initial OS/architecture support matrix depends
  on terminal and npm packaging evidence.

## Out of scope

- Implementing production code while charting this map.
- Machine-generated title translation.
- Google Books integration in the MVP.
- Accounts, cloud synchronization, history, covers, or a hosted backend.
- Public provider plugin compatibility.
- Chinese and Japanese UI catalogs.
- Publishing packages or creating external release infrastructure.

