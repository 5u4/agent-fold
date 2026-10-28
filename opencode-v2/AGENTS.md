# AGENTS.md

Run every command here from `opencode-v2/`.

## Runtime
OpenCode v2 loads `index.ts` (`./server`) in the OpenCode server process, which runs Bun, and `tui.ts` (`./tui`) in the TUI process. The two entries share no module state. The host resolves `@opencode/plugin` to its own instance, so it is a dev dependency for types only.

`opencode plugin add github:5u4/agent-fold#path:opencode-v2` installs this subdirectory from git. To install a branch, put the ref before the path as `#<branch>::path:opencode-v2`; the `#<branch>&path:` form fails with `git dep preparation failed`. That install constrains `package.json`:
- No lifecycle scripts, no `workspaces`, and no runtime dependencies on sibling packages.
- `files` must ship `context/`. `index.ts` reads `context/fold.md` at load, so without it the plugin fails to load while `plugin add` still exits 0.
- `exports` must name `./server` and `./tui`. Without `./tui`, `tui.ts` is skipped with no error.

## Session switch
The switch lives in the session metadata as `metadata.agentFold = { enabled, at }`, with `switch.ts` as the contract. `/agent-fold on|off|status` reads the metadata and writes it back with only `agentFold` replaced, because `session.update` replaces the whole object. Every invocation, `status` included, writes a fresh `at`. There is no history. A fork inherits the current value. With the switch off, the context hook does nothing.

Every `/agent-fold` bumps `session.time.updated`, so the session moves to the top of the TUI `/sessions` list (observed on opencode 2.1.4). `tui.ts` toasts `agent-fold: on|off` only in a TUI viewing that session, and only when `at` changed. Any other argument throws the usage text, which the TUI shows as an error toast while the command stays in the prompt. Headless clients (`opencode run`, `opencode api`) get no toast and read the state from `session.get().metadata`. `opencode run` cannot invoke `/agent-fold`; it sends the text to the model as a user message.

## Runs
Runs come from `ctx.session.context({ sessionID })`, split at `idle` entries. A manual compaction leaves a `[compaction, idle]` span. It counts as an ended run, but its only message is the checkpoint, a user message, so folding leaves it unchanged. The last span with no `idle` is the in-flight run and stays unchanged.

A folded run keeps every user message. Between consecutive user messages it keeps only the last assistant message's text parts, and none when the run had no reply (interrupt, provider failure). Tool messages are dropped. The hook walks `e.messages` in array order, never id order, and always keeps the compaction checkpoint.

## Fold dir
The index and notes live in `~/.agent-fold/<project-slug>/opencode-v2/<session-start>-<session-id>/`, with the session start as UTC `yyyyMMddHHmmss`. `AGENT_FOLD_HOME` overrides the `~/.agent-fold` root. `fold-dir.ts` copies pi's project slug and applies it to `ctx.location.project.canonical`. The hook appends `context/fold.md` with `{foldDir}` filled in to the system prompt.

The hook reads `INDEX.md` when the in-flight run's first transcript entry changes, which is once per run, and again after auto compaction restarts the transcript mid-run. It keeps at most 2000 lines and 50 KiB, as pi does. Past either limit it keeps the last lines that fit and leads with a note that lines 1 to N were omitted. It inserts the snapshot as a user message right after the in-flight run's first user message. After auto compaction that message is the compaction checkpoint.

The hook fails open. Creating the fold dir may throw, and reading `INDEX.md` swallows only `ENOENT`. Any throw leaves the request untouched. The hook never writes the session.

## Compaction
This plugin does not take over compaction. Native compaction runs untouched, and the fold keeps its checkpoint message.

## Verify
- Run `bun run typecheck` and `bun test`. Neither spends tokens.
- The mechanism tests run the `opencode` on your PATH against a fake provider, with temporary `XDG_*`, `OPENCODE_DB`, and `HOME` so they never touch your OpenCode config or data.
- Smoke by hand the same way: point those variables at a temp dir, load this checkout through a project `opencode.json` `plugins` entry, run `opencode run` with a prompt that calls a tool, then `opencode run --session <id>`, and confirm the first run reached the provider as the user message and the final reply.
- Smoke `tui.ts` in plain `opencode` with the same variables and a private service port in `$XDG_CONFIG_HOME/opencode/service.json`, so the TUI starts its own background service instead of attaching to yours. Run `/agent-fold off`, `/agent-fold on`, and `/agent-fold status` in a session and confirm one toast each.
