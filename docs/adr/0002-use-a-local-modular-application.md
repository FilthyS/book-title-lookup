---
status: accepted
---

# Use a local modular application instead of a backend service

The MVP is one local executable organized as a Deno workspace with TUI, Core,
and Providers boundaries. The TUI calls application use cases in-process; it
does not communicate with a local or hosted HTTP backend. This retains
testable domain and integration seams without paying for process management,
protocol versioning, deployment, authentication, or remote storage before
another client exists.

## Consequences

The TUI is the composition root, Core remains independent of I/O, and Providers
owns external systems. If a web or mobile client becomes real, an API
application can be added around the same Core boundary rather than extracted
from UI code.

