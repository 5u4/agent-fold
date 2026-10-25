# AGENTS.md

Run every command here from `pi/`.

## Runtime
pi loads `index.ts` with jiti under Node, not Bun. The plugin source uses Node APIs only and finds its files through `import.meta.url`. pi aliases `@earendil-works/*` imports to the running host, so those packages are dev dependencies for types and tests only, and the plugin has no runtime dependencies. The root `package.json` points pi's `extensions` at `./pi/index.ts`, so `pi install` of the repo loads this directory. A git install with npm runs `npm install --omit=dev --legacy-peer-deps` at the repo root, which fails with `EUNSUPPORTEDPROTOCOL` on `workspace:*` specs, so workspace packages depend on each other with `*`.

pi's extension context carries no agent kind, so every hook runs in every pi session.

## Session switch
`/agent-fold off` and `/agent-fold on` append an `agent-fold.switch` custom entry with `{ enabled }` through `pi.appendEntry`, only when the value changes. `foldEnabled` in `switch.ts` reads the branch, and the last entry wins. With the switch off, every hook acts as if the plugin were not installed.

## Runs
`runStarts` in `fold.ts` decides where runs start. pi delivers steering and follow-up messages as plain user messages. A user message stays inside the current run only when it follows a tool batch whose calls all have results and none reads `Operation aborted`; that is where pi injects steering between tool calls. Every other user message starts a run: one after a final reply, including steering that lands after the final reply, one after an error or aborted reply, and one after a tool batch with an unanswered call (pi was killed mid tool call) or an aborted result. The first user message after a compaction or branch summary also starts a run. Summaries sit outside runs and are kept verbatim.

A folded run keeps its first message, the user's steering messages, the output of commands the user ran in bash, custom messages with `display: true`, system prompt updates, and its final reply without thinking blocks, in their original order, including those kept messages that come after the final reply. It drops tool calls, tool results, earlier replies, and hidden custom messages. A run whose last assistant message is not a final reply stays whole.

`fixtures/aborted-sessions.json` holds sessions recorded from real pi against the fake provider: one aborted through RPC while a `tool_call` handler held the call, and one killed with SIGTERM mid tool call. Regenerate it with `bun scripts/record-abort-fixture.ts` after a pi upgrade.

## Fold dir
The session index and notes live in `~/.agent-fold/<project-slug>/pi/<session-start>-<session-id>/`. `AGENT_FOLD_HOME` overrides the `~/.agent-fold` root. `fold-dir.ts` derives the path with the same project slug as omp, and the key from the session header's UTC start time and the session id. `before_agent_start` creates the dir, reads `INDEX.md`, and sets the `agent-fold` system prompt section to `context/fold.md` with `{foldDir}` filled in. The snapshot keeps at most pi's `read` limits, `DEFAULT_MAX_LINES` and `DEFAULT_MAX_BYTES`. The `context` hook's first call in a run records the timestamp of the folded view's last run start as the anchor and inserts the snapshot right after it on every request of the run. When compaction summarized the anchor away, the snapshot follows the last summary, or is left out when a user message comes later.

## Compaction
`session_before_compact` cancels threshold compaction while the session with every finished run folded, the last one included, estimated with pi's `estimateTokens`, is under the threshold. Otherwise it calls pi's `compact` on the folded messages. pi's `estimateContextTokens` is not exported, and its last-usage anchor counts the unfolded context.

## Verify
- Run `bun run typecheck` and `bun test`. Neither spends tokens.
- The mechanism tests in `tests/` run the `pi` on your PATH against a local fake `openai-completions` server from `harness/fake-provider.ts`. `harness/sandbox.ts` gives each test a temporary `PI_CODING_AGENT_DIR` with a `models.json` for that server, so tests never read or write `~/.pi`.
- Smoke every behavior change the same way by hand: set `PI_CODING_AGENT_DIR` to a temp dir, load this checkout with `--no-extensions -e ./index.ts`, run `pi -p` with a prompt that calls a tool, then `pi -p -c` in the same session, and confirm the first run reached the provider as the user message and the final reply.
