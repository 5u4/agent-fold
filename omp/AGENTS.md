# AGENTS.md

Run every command here from `omp/`.

## Settings
The plugin reads OMP's `autolearn.enabled` and `secrets.enabled` settings and its own boolean plugin setting `skillCaptureRules`, which is off by default. It injects the managed-skill rules only when `skillCaptureRules` is true, autolearn is on, and the `manage_skill` tool exists. Turn it on with `omp plugin config set @agent-fold/omp skillCaptureRules true`. It hides `checkpoint` and `rewind` with `setActiveTools`, never through settings.

## Session switch
`/agent-fold off` and `/agent-fold on` append an `agent-fold.switch` custom entry with `{ enabled }` to the session branch. `foldEnabled` in `switch.ts` reads the branch, and the last entry wins. With the switch off, every hook acts as if the plugin were not installed and restores the `checkpoint` and `rewind` tools it hid.

## Runs
`runStarts` in `fold.ts` decides where runs start. A plain user message that is not steering always starts a run, including a new prompt after a run that stopped on a tool call. Any other message the user wrote, as OMP's `isUserAuthoredMessage` defines it, starts a run unless the closest assistant message before it stopped for a tool call. That covers `/skill:` prompts and steering that arrives after the final reply. Steering and skill prompts delivered between tool calls stay inside the current run. Compaction and branch summaries also start a run.

A folded run keeps its first message, the messages the user wrote, file mentions, the output of commands the user ran in bash or Python, OMP's tool and device change notices, and its last final reply, in their original order. It drops tool calls, tool results, earlier text replies, developer reminders, and other custom messages. OMP announces a tool or device change once, right before the next user message, and does not announce it again in that session, so the notices stay. A run whose last assistant message is not a final reply stays whole.

## Fold dir
The session index and evidence files live in `~/.agent-fold/<project-slug>/omp/<conversation-key>/`, outside the session dir, so they survive rewind, branch, and fork. The `omp` segment names the agent whose session store holds the key. `AGENT_FOLD_HOME` overrides the `~/.agent-fold` root. `fold-dir.ts` derives the path. The slug is OMP's session dir name for the main checkout of the git repo holding cwd, for the checkout's top level when its git dir is not a `.git` dir (submodules, `--separate-git-dir`), or for cwd outside git. The key is the UTC start time and id of the first entry on the session branch. `before_agent_start` creates the dir and puts its path into the rules from `context/*.md` in place of `{foldDir}`. Eval trials set `AGENT_FOLD_HOME` inside the trial dir, and scripted replies write `<fold-dir>/` for the dir the system prompt names.

`before_agent_start` also reads `INDEX.md` once per run. The snapshot keeps at most the first 300 lines and 153600 bytes, which are OMP's default `read` line limit and the 512 bytes per line that `read` budgets for them. When `INDEX.md` is longer, the snapshot ends with a note naming the line to continue reading from. The `context` hook's first call in the run records the timestamp of the folded view's last run boundary as the anchor. Each request of the run gets the snapshot right after the boundary with that timestamp, so a later user message such as OMP's handoff prompt does not move it. When compaction has summarized the anchor away, the snapshot follows the last run boundary if that is a compaction or branch summary, and is left out if it is a message the user wrote. With a resolved fold dir and an anchor, the snapshot goes in even when the file is empty, as `(empty)`, and ends with a reminder to append before the final reply. When it went in only for a non-empty file and had no reminder, the model mostly stopped writing the index, and eval `reuses-located-files` fell from 6/6 to 3/6. The block is a custom message hidden from the TUI, which OMP converts for the provider like its own hook messages, as a developer message. It is not persisted, so folded runs never carry it.

## Verify
- Run `bun run typecheck` and `bun test`.
- `bun test` includes the mechanism tests in `tests/` that check the request reaching the provider. They run the `omp` on your PATH through the driver in `harness/`, which `omp/evals/` shares.
- The behavior scenarios live in the shared `evals/` package at the repo root and grade a normalized transcript. `harness/adapter.ts` is omp's adapter: it turns an omp run into that transcript and replays scripted turns through the scripted provider.
- For changes to `context/*.md` or fold behavior, run `bun run eval` and put its summary lines in the pull request. It runs `evals/behavior.eval.ts`, which passes omp's harness to the shared runner, against the model in `FOLD_EVAL_MODEL`; copy `.env.test.example` to `.env.test.local` to set it. Each run also executes one without-plugin control trial per scenario. A red control means the scenario or model no longer separates, not that the plugin broke. Results land in `evals/results/`.
- For changes to fold behavior and omp upgrades, also run `bun run eval:providers` with `FOLD_EVAL_PROVIDER_MODELS` set to one model per provider API. These provider evals stay omp-only. They fail when a provider rejects the folded request.
- Smoke every behavior change in an isolated profile:
  1. Set `OMP_PROFILE=<name>` and copy `~/.omp/agent/agent.db` to `~/.omp/profiles/<name>/agent/agent.db`.
  2. Load this checkout with `--no-extensions -e ./index.ts`. Installed plugins are shared across profiles, so installing would not isolate the run.
  3. Run `omp -p` with stdin from `/dev/null` and a full model id, with a prompt that calls a tool. Then run `omp -p -c` in the same session and confirm the first run reached the provider as the user message and the final reply.
  4. Delete the profile.
