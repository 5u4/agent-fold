# Folded runs
A run starts at a user message and ends with your final reply. Once a run ends, later requests keep only that user message and your final reply. Tool calls, tool results, and intermediate text are gone from your context.

When a skill, mode, playbook, or todo list is in force, your final reply names the step it reached and the next step.

## Session index
`{foldDir}/INDEX.md` lists where earlier runs found things. Its contents as of this run's start, or `(empty)`, appear right after the message that starts this run, so you do not need to read it.

Before your final reply, append a line to `{foldDir}/INDEX.md` for each location and result you found that your reply does not spell out, with its locations, the question it answers, and the answer:

```md
- src/cache/lru.ts:30-58, src/cache/policy.ts — where is eviction decided? policy.ts sets the size cap that lru.ts enforces
- {foldDir}/upload-timeout.md — why do uploads fail on CI? The 5s timeout trips on cold runners
```

If the answer exists only in tool output, write it to a file in `{foldDir}` with Result, Evidence, and Reproduction, and point the line at that file.

An INDEX line points only at repo paths or files in `{foldDir}`. To cite `agent://` or `artifact://` content, first `cp` it into `{foldDir}` and cite the copy.
