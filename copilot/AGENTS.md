# AGENTS.md

Run every command here from `copilot/` unless a step says otherwise.

## Extension
`extension.ts` is a GitHub Copilot CLI extension. `bun run build` bundles it with `@github/copilot-sdk` left external into `com.github.copilot/extensions/agent-fold/extension.mjs`, which is committed because the CLI loads it from the plugin directory without a build step. `build.test.ts` fails when the committed file differs from a fresh build, so run `bun run build` after every source change. Extensions are an experimental Copilot CLI feature; every smoke run here used `--experimental`.

The extension registers through the SDK's private parent-process client with a `requestHandler`, because `joinSession` cannot take one. It joins with `additionalDirectories: [foldHome]` so the model can read and write the fold dir without a path prompt, and rewrites the outgoing `session.resume` to `requestPermission: false`. It supplies no permission handler. With `requestPermission: true` the CLI shows an elevation dialog at load, and `-p` without `--allow-all-tools` hangs when that is denied.

## Folding
The handler rewrites a request only when its URL path is in the `formats` registry (`/responses` and `/v1/messages`), `ctx.interactionType` is `conversation-agent`, the body has no content encoding, and the body holds at least one run boundary. Everything else, including title requests on `/chat/completions`, the frustration classifier, subagents and compaction, is forwarded as the original request object. Any error in the rewrite forwards the original request.

Each format classifies its native items as `boundary`, `steering`, `reply`, `drop`, or `keep`. A boundary is a user item with a text part that starts with `<current_datetime>` or with the compaction summary's "Some of the conversation history has been summarized". `fold.ts` folds every run except the last when the run's last `reply` or `drop` item is a `reply`. A folded run keeps its boundary, its steering and `keep` items, and its replies. On `/v1/messages`, kept items lose `thinking`, `redacted_thinking`, and `tool_result` blocks, and an item left with no blocks is dropped. Kept items are never converted into another format, so their ids, phases, and unknown fields pass through, and items outside folded runs pass through unchanged.

The handler appends `context/fold.md` to the system position (`instructions` or a leading system input item on `/responses`, `system` on `/v1/messages`) and inserts the `INDEX.md` snapshot right after the last boundary. The snapshot is read again only when the text of the last boundary changes, so it stays fixed for the whole run. It keeps at most 300 lines and 153600 bytes, like omp.

## Fold dir
The fold dir is `${AGENT_FOLD_HOME || ~/.agent-fold}/<project-slug>/copilot/<UTC start yyyymmddHHMMSS>-<session id>/`. `fold-dir.ts` reproduces omp's slug: the main checkout of the git repo holding the working directory, the checkout's top level when its git common dir is not a `.git` dir, or the working directory outside git. The start time and working directory come from `session.rpc.metadata.snapshot()` and the id from `SESSION_ID`. The extension creates the dir after it joins. A request waits at most 5 s for that setup and is forwarded unfolded if it is not done.

## Session switches
Only the session a CLI process starts with is folded. `/clear`, `/new`, `/resume`, and `/fork` restart the extension, and the runtime refuses the new process the LLM provider slot. So does TUI `--resume` and `--continue`, which start a throwaway session first. The refused extension exits without joining, and later turns go to the model unfolded. To fold a saved session, start it with `copilot --session-id <id>`. The extension shows no warning in this case: a refused extension that joins the session, even only to call `session.log`, makes the next turn hang.

## Verify
- Run `bun run typecheck` and `bun test`; `bun test` includes the rebuild check. From the repo root, run `biome check copilot`.
- Smoke every behavior change in a scratch git repo with a copy of the build at `.github/extensions/agent-fold/extension.mjs`, `AGENT_FOLD_HOME` set to a temp dir, and the TUI in tmux. Answer folder trust with the one-time "1. Yes". To see what reaches the model, patch a copy of the build to write each request's body before and after the rewrite; never commit that patch.
  1. On one Claude model (`/v1/messages`) and one GPT model (`/responses`), such as `claude-haiku-4.5` and `gpt-5.4-mini`, run "Use a shell command to cat data.txt, then reply with only the word done", then "Without using any tools, what exact token was in data.txt?". With the extension the second answer is `UNKNOWN` and the token is absent from the second request. In a scratch repo without the extension the model quotes it. `claude-sonnet-5` answered `UNKNOWN` even without the extension, so it cannot be the Claude model for this check.
  2. Ask the model to append a line to the session index under `--allow-all-tools`. No dialog appears, and the next run's request carries the line right after its boundary.
  3. `/clear`, then send a turn: it answers without hanging. Quit, run TUI `copilot --resume <id>` and send a turn: same. Quit, run `copilot --session-id <id>`: the turn's request is folded.
  4. Run `copilot -p` with `GITHUB_COPILOT_PROMPT_MODE_EXTENSIONS=true` and without `--allow-all-tools`: it answers and exits.
- Test the plugin path with `COPILOT_HOME` set to a temp dir: `copilot plugin marketplace add <repo>`, `copilot plugin install agent-fold@agent-fold`, then a `copilot -p` run creates the fold dir under `AGENT_FOLD_HOME`.
- Hash `~/.copilot/settings.json`, `config.json`, and `permissions-config.json` before and after the smoke. They must not change.
