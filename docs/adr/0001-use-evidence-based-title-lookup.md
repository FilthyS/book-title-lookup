---
status: accepted
---

# Use evidence-based title lookup instead of title translation

The product returns titles supported by Work- or Edition-level bibliographic
evidence and keeps machine-generated translations outside the MVP. Search
aliases, transliterations, entity labels, and article names may help discover a
Work but cannot become published titles without accepted evidence. This favors
traceable accuracy over recall and avoids presenting plausible prose as a title
that readers can actually find.

## Considered Options

- Generate a translation whenever catalog evidence is absent.
- Mix generated and published titles in a single ranked list.
- Return only attested titles and represent absence explicitly.

The third option was selected because generated language and bibliographic fact
have different truth conditions.

## Consequences

Some valid translations will be missed because public catalogs are incomplete.
Every result remains attributable, and a future suggested-translation feature
must use a visibly different domain type and presentation.

