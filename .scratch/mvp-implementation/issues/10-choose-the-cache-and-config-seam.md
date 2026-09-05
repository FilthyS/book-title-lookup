# Choose the cache and configuration seam

Type: grilling
Status: open
Blocked by: 01, 02, 05

## Question

What interface and on-disk contract should hide raw HTTP caching,
fresh/stale/negative entries, atomic writes, schema evolution, offline reads,
cache inspection, cache clearing, configuration precedence, and concurrent
process behavior from callers?

