# Shared fixtures

Fixture-backed test data shared by workspace members lives here. Raw HTTP
response envelopes and module-level payloads belong under the per-area
directories below, and live catalog values are never test assertions.

```text
fixtures/
├── acceptance-corpus/        # issue #7 corpus inputs + expected results (later slice)
├── cli-json/                 # cli-json.v1 schema + document snapshots (later slice)
├── providers/                # openlibrary + wikidata response envelopes (later slice)
└── npm/                      # launcher stub binaries for distribution tests (later slice)
```

This ticket adds only the directory scaffolding; every child directory arrives
with the slice that consumes it.
