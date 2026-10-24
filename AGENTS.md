# AGENTS.md

## Purpose
agent-fold keeps one session's main context a clean thread of decisions. It buys focus, not token savings. Its scope ends at the session. What the agent needs later, it finds again with search.

## Layout
Each top-level agent directory, such as `omp/`, is a self-contained plugin for one coding agent with its own code, prompts, tests, and evals. Before changing one, read its `AGENTS.md` for that agent's rules and verification. Agent directories never import from each other.

Inside an agent directory, `tests/` never spends tokens and `evals/` does. A suite that needs a real model is an eval, and its file ends in `.eval.ts` so `bun test` skips it. Unit tests of the plugin source stay next to that source.

## Invariants
- The view of folded runs is a pure function of the loop messages and the switch entries on the session branch. The same messages and switch entries always give the same view, so a replayed session shows the model what it saw live. The current run also carries the `INDEX.md` snapshot read when the run started; it is never written to the session. Only the user's `/agent-fold` command appends a switch entry. The hooks never write the session or mutate the loop.
- Fail open. If folding throws, send the unfolded messages.
- Never write user settings.

## Documentation & Comments
- Default to no comments. Names, types, and tests carry the meaning.
- Before writing a comment, try to encode the fact instead: a type, an assertion, a test, or a lint rule. If one of those can hold it, write no comment.
- A comment survives only for a fact about something we cannot change, such as a third-party type that lies or a runtime quirk. State it concretely in one line.
- Change `README.md` only when the user asks, and only the part they ask about.

## Commits and pull requests
- Open a pull request only when asked.
- Write conventional commit titles in plain language, such as `fix(enforcer): allow calls when the checkpoint tool is missing`.
- Use squash merge and delete the source branch.
