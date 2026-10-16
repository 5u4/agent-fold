# AGENTS.md

Run every command here from `omp/`.

## Settings
The plugin reads only `autolearn.enabled` and `secrets.enabled`. It hides `checkpoint` and `rewind` with `setActiveTools`, never through settings.

## Session switch
`/agent-fold off` and `/agent-fold on` append an `agent-fold.switch` custom entry with `{ enabled }` to the session branch. `foldEnabled` in `switch.ts` reads the branch, and the last entry wins. With the switch off, every hook acts as if the plugin were not installed and restores the `checkpoint` and `rewind` tools it hid.

## Fold dir
The session index and evidence files live in `~/.agent-fold/<project-slug>/omp/<conversation-key>/`, outside the session dir, so they survive rewind, branch, and fork. The `omp` segment names the agent whose session store holds the key. `AGENT_FOLD_HOME` overrides the `~/.agent-fold` root. `fold-dir.ts` derives the path. The slug is OMP's session dir name for the main checkout of the git repo holding cwd, for the checkout's top level when its git dir is not a `.git` dir (submodules, `--separate-git-dir`), or for cwd outside git. The key is the UTC start time and id of the first entry on the session branch. `before_agent_start` creates the dir and puts its path into the rules from `context/*.md` in place of `{foldDir}`. Eval trials set `AGENT_FOLD_HOME` inside the trial dir, and scripted replies write `<fold-dir>/` for the dir the system prompt names.

`before_agent_start` also reads `INDEX.md` once per run. The snapshot keeps at most the first 300 lines and 153600 bytes, which are OMP's default `read` line limit and the 512 bytes per line that `read` budgets for them. When `INDEX.md` is longer, the snapshot ends with a note naming the line to continue reading from. The `context` hook's first call in the run records the timestamp of the folded view's last run boundary as the anchor. Each request of the run gets the snapshot right after the boundary with that timestamp, so a later user message such as OMP's handoff prompt does not move it. When compaction has summarized the anchor away, the snapshot follows the last run boundary if that is a compaction or branch summary, and is left out if it is a user message. With a resolved fold dir and an anchor, the snapshot goes in even when the file is empty, as `(empty)`, and ends with a reminder to append before the final reply. When it went in only for a non-empty file and had no reminder, the model mostly stopped writing the index, and eval `reuses-located-files` fell from 6/6 to 3/6. The block is a custom message hidden from the TUI, which OMP converts for the provider like its own hook messages, as a developer message. It is not persisted, so folded runs never carry it.

## Verify
- Run `bun run typecheck` and `bun test`.
- `bun test` includes the mechanism tests in `evals/mechanism` that check the request reaching the provider. They run the `omp` on your PATH.
- For changes to `context/*.md` or fold behavior, run `bun run eval` and put its summary lines in the pull request. It runs every `evals/behavior/*.eval.ts` against the model in `FOLD_EVAL_MODEL`; copy `.env.test.example` to `.env.test.local` to set it. Each run also executes one without-plugin control trial per eval. A red control means the eval or model no longer separates, not that the plugin broke.
- For changes to fold behavior and omp upgrades, also run `bun run eval:providers` with `FOLD_EVAL_PROVIDER_MODELS` set to one model per provider API. It fails when a provider rejects the folded request.
- Smoke every behavior change in an isolated profile:
  1. Set `OMP_PROFILE=<name>` and copy `~/.omp/agent/agent.db` to `~/.omp/profiles/<name>/agent/agent.db`.
  2. Load this checkout with `--no-extensions -e ./index.ts`. Installed plugins are shared across profiles, so installing would not isolate the run.
  3. Run `omp -p` with stdin from `/dev/null` and a full model id, with a prompt that calls a tool. Then run `omp -p -c` in the same session and confirm the first run reached the provider as the user message and the final reply.
  4. Delete the profile.
