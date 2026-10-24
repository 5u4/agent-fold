# Harness adapter contract

`@agent-fold/evals` holds the behavior scenarios, their grades, the trial runner, and reporting. It knows nothing about any coding agent. Each agent directory supplies a `Harness`. The harness runs a scenario against its agent and returns a normalized transcript. Grades read only that transcript and the scenario's own state from `setup` and `inspect`.

This document is all a new adapter needs. The omp adapter in `omp/harness/adapter.ts` is the worked example, and the tables below describe what it does.

## Types

The types live in `evals/contract.ts` and are exported from `@agent-fold/evals`.

```ts
type Variant = "without-plugin" | "with-plugin";
const FOLD_DIR = "<fold-dir>";
type Call =
  | { kind: "read"; path: string }
  | { kind: "write"; path: string; content: string }
  | { kind: "shell"; command: string }
  | { kind: "search" }
  | { kind: "other" };
type Action = Call & { name: string; args: Record<string, unknown>; result: string | null; isError: boolean; touchesSessionLog: boolean };
type ScriptStep = Extract<Call, { kind: "read" | "write" | "shell" }> | { kind: "reply"; text: string };
type ScriptedTurn = { prompt: string; script: ScriptStep[] };
type Turn = { prompt: string; reply: string; actions: Action[]; modelInputs: string[] };
type Run = { variant: Variant; foldHome: string; turns: Turn[] };
type Verdict = { status: "pass" | "fail" | "invalid"; evidence: string };
type Scenario<S> = {
  title: string;
  turns: (string | ScriptedTurn)[];
  setup(workdir: string): Promise<S>;
  inspect?(workdir: string, state: S): Promise<S>;
  grade(run: Run, state: S): Verdict;
  metrics(run: Run, state: S): Record<string, number>;
};
type TrialOutcome<S> = { run: Run; state: S } | { unsupported: string };
type Harness = { name: string; runTrial<S>(scenario: Scenario<S>, opts: { variant: Variant; model: string }): Promise<TrialOutcome<S>> };
```

## What `runTrial` does

1. Create a fresh work directory and a fresh `AGENT_FOLD_HOME` root for the trial. Resolve both to real paths, with symlinks resolved, before the agent starts. On macOS the temp directory `/var/...` is a symlink to `/private/var/...`, and an agent that reports `/private/var/...` paths would not match an unresolved `Run.foldHome`. omp resolves the trial's temp root with `realpathSync` and creates both directories under it.
2. Call `scenario.setup(workdir)` with that real path and keep the returned state.
3. Start one agent session in the work directory. Load the plugin for `with-plugin`. Leave it out for `without-plugin`.
4. Run each entry of `scenario.turns` in order, in the same session. A string is a prompt that `opts.model` answers. A `ScriptedTurn` is replayed, as described below, and needs no real model. omp runs one process per turn and continues the session with `-c`.
5. After the last turn, call `scenario.inspect(workdir, state)` when it exists, and use its result as the final state.
6. Return `{ run, state }`.

Throw when the agent itself fails, such as a crash or a provider error. The runner then fails that trial and writes no row. Return `{ unsupported: reason }` only for a scenario the harness cannot run by design.

## Field meanings

- `Run.variant` is `opts.variant`.
- `Run.foldHome` is the real path of the `AGENT_FOLD_HOME` root the trial used, in both variants. Fold dirs live under it. Without the plugin nothing writes under it.
- `Run.turns` has one `Turn` per entry of `scenario.turns`, in order.
- `Turn.prompt` is the prompt sent for that turn.
- `Turn.reply` is the turn's final reply text.
- `Turn.actions` has one `Action` per tool call the model made in the turn, in call order. Scripted calls count too.
- `Turn.modelInputs[i]` serializes the i-th model request of the turn. It contains every text the model received: system prompt, user messages, assistant messages, tool calls, and tool results. Strip the plugin's injected `INDEX.md` snapshot from it. Stripping is the adapter's job, because only the adapter knows how its plugin injects the snapshot.
- `Action.name` is the tool name exactly as the model sent it.
- `Action.args` is the raw tool arguments exactly as the model sent them. Do not rename keys or normalize paths. A harness whose tool takes one free-text argument instead of an object stores that text as `{ input: <text> }`. Grades and metrics search raw `args` only for path substrings, so they still work on it. Fail evidence that quotes `args.path`, `args.pattern`, or `args.command` shows nothing for such a call.
- `Action.result` is the tool result text. Join text blocks with `"\n"` and map non-text blocks to `""`. Use `null` when the harness recorded no result for the call. A tool result whose call is not in the same turn cannot be represented, so throw instead of dropping it.
- `Action.isError` is true when the result was an error. It is false when there is no result.
- `Action.touchesSessionLog` is true when the call touches the agent's own raw session transcript files. omp sets it when any argument mentions `.jsonl`, because omp stores sessions as `.jsonl` files. Use whatever marks your agent's transcript files.

## Classifying tool calls

Each `Action` also carries a `Call` kind. The first matching rule wins. This is omp's table:

| omp tool call | kind |
| --- | --- |
| `args.path` is a string matching `/^xd:\/\/(grep\|glob\|find\|ast_grep)\b/` | `search` |
| name is `grep`, `glob`, `find`, or `ast_grep` | `search` |
| `read` | `read` with `path: String(args.path)` |
| `write` | `write` with `path: String(args.path)` and `content: String(args.content)` |
| `bash` | `shell` with `command: String(args.command)` |
| anything else | `other` |

Map your agent's tools by what they do:

- A tool that only searches file names or contents is `search`.
- A tool that runs a shell command is `shell`, with the command string verbatim.
- A shell command that searches, such as `rg` or `find`, stays `shell`. Grades match the command text themselves.
- A tool that reads one file is `read`. A tool that writes a whole file is `write`.
- A patch or edit tool, such as `apply_patch`, is `write` when it carries one path and the new content. Otherwise it is `other`.

## What grades and metrics read

Grades and metrics read `Run.variant`, `Run.foldHome`, and these `Action` and `Turn` fields: `name`, `kind`, `command`, `result`, `isError`, `touchesSessionLog`, `reply`, and `modelInputs`. Some also search the raw `args` with `mentions(action, text)`, which is `JSON.stringify(action.args).includes(text)`. Fail evidence quotes raw `args`, such as `args.path`, `args.pattern`, or `args.command`. So `args` must hold paths and commands verbatim.

| scenario | grade searches raw `args` for | metrics search raw `args` for | grade regexes `shell.command` with |
| --- | --- | --- | --- |
| reaches files an earlier run located without searching again | `services/gateway/src/settings/limits.ts` | `services/gateway/src/settings/limits.ts` and `run.foldHome` | `\b(rg\|grep\|find\|fd\|ls\|tree)\b` |
| leaves the index alone when the reply already holds the answer | `INDEX.md` on actions whose kind is not `read` | the same | `[>]\|\btee\b`, for shell actions that mention `INDEX.md` |
| acts on recorded evidence when the earlier reply contradicts it | none | `run.foldHome` | none |
| recovers an unreproducible result the fold removed | none | `run.foldHome` | none |
| re-reads a detail the fold removed instead of guessing it | none | none | none |

Metrics that search for `run.foldHome` read 0 for `without-plugin` unless the model goes looking for that directory on its own. Without the plugin, `<fold-dir>` resolves to a scratch location the harness picks outside `run.foldHome`, and no prompt names `run.foldHome`. These metrics show the plugin's effect by comparing variants.

Other inputs:

- `reaches files an earlier run located without searching again` reads the `result` text and `reply` of turn 1, and the final contents of `limits.ts` and `token.ts` that `inspect` returns.
- `leaves the index alone when the reply already holds the answer` reads the `result` text and `reply` of its one turn.
- `acts on recorded evidence when the earlier reply contradicts it` requires that the turn-1 actions with a non-null `result` equal the script's tool steps in number, and that none has `isError`. Its verdict comes from the `bin/config production` output that `inspect` returns.
- `recovers an unreproducible result the fold removed` reads the `result` text of turn 1, the `reply` of both turns, `modelInputs[0]` of turn 2, and `touchesSessionLog` of turn 2. Its metrics read the turn-2 `result` text.
- `re-reads a detail the fold removed instead of guessing it` reads the `reply` of both turns, all `modelInputs` of turn 1, and `modelInputs[0]` of turn 2, and compares them with the nonce that `setup` returns.

## Scripted replay

A `ScriptedTurn` makes the model's side of a turn fixed, so later turns start from a known history. Its whole `script` is fixed before the trial starts, because scenarios declare `turns` as data and nothing in a run changes them. The adapter receives the whole `script` before the turn starts, so it can serve it from a fake upstream. It serves one model response per step, in order:

- A `read`, `write`, or `shell` step is one response holding that single tool call, translated to the agent's own tool names and argument keys. omp sends `read` as `read` with `{ path }`, `shell` as `bash` with `{ command }`, and `write` as `write` with `{ path, content }`.
- A `write` step creates a new file. It never overwrites, because some agents' file-creating tools cannot overwrite. Before serving a `write` step, fail the trial by throwing when the target already exists. omp checks the filesystem for a path, and for a `local://` path it checks whether an earlier `write` call in the session used the same path.
- A `reply` step is the final text response.

The agent executes the tool calls for real, so the turn records real results. Replace `<fold-dir>/` (the `FOLD_DIR` constant) in every step string with the plugin's fold dir for the session, followed by `/`. With the plugin off there is no fold dir, so replace it with a scratch location of the harness's choice. omp replaces `<fold-dir>/` with `local://` whenever the request carries no fold dir, so `<fold-dir>/retries.md` becomes `local://retries.md`.

A harness that cannot replay scripted turns returns `{ unsupported: reason }` for any scenario that has one. The runner records an `unsupported` row and the test passes. It is not a failure.

## Wiring an agent's eval entry

The agent directory owns its entry, such as `<agent>/evals/behavior.eval.ts`, and the `bun run eval` script that runs it. The entry reads its own configuration, such as the `FOLD_EVAL_MODEL` and `FOLD_EVAL_TRIALS` environment variables, and calls `describeEvals`:

```ts
import { join } from "node:path";
import { describeEvals, type Harness, resultsFile, scenarios } from "@agent-fold/evals";

declare const harness: Harness;
const model = process.env.FOLD_EVAL_MODEL ?? "";
const trials = Number(process.env.FOLD_EVAL_TRIALS ?? "3");

describeEvals({
  harness,
  model,
  trials: { "without-plugin": 1, "with-plugin": trials },
  resultsFile: resultsFile(join(import.meta.dir, "results")),
  scenarios,
});
```

omp keeps the configuration and results path in `omp/evals/eval.ts` and the `describeEvals` call in `omp/evals/behavior.eval.ts`.

`describeEvals` registers one `bun:test` `describe` per scenario and one concurrent test per trial, with a 300 second timeout. A trial passes when its verdict is `pass` or `unsupported`. After each scenario it prints a header line `harness <name>, model <model>, means over valid trials`, one summary line per variant in the format below, and a `results: <file>` line. Results go under `<agent>/evals/results/`, which git ignores.

## Results

Each trial appends one JSON line to the results file:

```ts
type Row = {
  harness: string;
  scenario: string;
  model: string;
  variant: Variant;
  trial: number;
  verdict: { status: "pass" | "fail" | "invalid" | "unsupported"; evidence: string };
  metrics: Record<string, number>;
};
```

To compare harnesses or runs, pass any number of results files to the summarizer from the repo root:

```sh
bun evals/summarize.ts omp/evals/results/<run>.jsonl copilot/evals/results/<run>.jsonl
```

It prints one block per harness and model. Each line reads `<scenario> / <variant>: pass <passed>/<valid>, invalid <n>`, then `, unsupported <n>` when any trial was unsupported, then `, mean <metric> <value>` for each metric. Means cover valid trials, which are those that passed or failed, and read `n/a` when there are none.
