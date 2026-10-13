# AGENTS.md

Run every command here from `omp/`.

## Settings
The plugin reads only `autolearn.enabled` and `secrets.enabled`. It hides `checkpoint` and `rewind` with `setActiveTools`, never through settings.

## Session switch
`/fold off` and `/fold on` append an `agent-fold.switch` custom entry with `{ enabled }` to the session branch. `foldEnabled` in `switch.ts` reads the branch, and the last entry wins. With the switch off, every hook acts as if the plugin were not installed and restores the `checkpoint` and `rewind` tools it hid.

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
