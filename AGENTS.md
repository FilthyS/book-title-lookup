# Agent Workflow

## DeltaDB handoff

- When a task changes repository files, finish by committing the complete
  change on its task branch and pushing that branch to `origin`. The developer
  receives agent changes through the remote and cannot test work left only in
  the agent's local worktree.
- In the completion message, list the exact pull command, automated validation
  commands, and manual actions the developer should run to verify the change.
