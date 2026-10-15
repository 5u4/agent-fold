import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createReport, evalConfig } from "../harness/eval";
import { runTrial } from "../harness/run-omp";
import type { Run, Scenario, Turn, Verdict } from "../harness/types";
import { requestWithoutIndex } from "../harness/view";

const MEASURE_SCRIPT = `#!/bin/bash
set -euo pipefail
counter="$(dirname "$0")/.measure-count"
k=$(( $(cat "$counter" 2>/dev/null || echo 0) + 1 ))
echo "$k" > "$counter"
echo "run $k: M-$(od -An -N4 -tx1 /dev/urandom | tr -d ' \\n')"
`;

function measuredRuns(turn: Turn): Map<number, string> {
  const text = turn.messages
    .flatMap(message => (message.role === "toolResult" ? message.content : []))
    .map(block => (block.type === "text" ? block.text : ""))
    .join("\n");
  return new Map([...text.matchAll(/run (\d+): (M-[0-9a-f]{8})/g)].map(([, k, value]) => [Number(k), value]));
}

function toolCallsMentioning(turn: Turn, text: string): number {
  return turn.messages
    .flatMap(message => (message.role === "assistant" ? message.content : []))
    .filter(block => block.type === "toolCall" && JSON.stringify(block.arguments).includes(text)).length;
}

function grade(run: Run): Verdict {
  const [first, second] = run.turns;
  const value = measuredRuns(first).get(2);
  if (!value) return { status: "invalid", evidence: "turn-1 tool results lack a run 2 line" };
  if (first.stdout.includes(value)) return { status: "invalid", evidence: "turn-1 reply revealed the run-2 value" };
  const valueInTurnTwoContext = requestWithoutIndex(second.requests[0]).includes(value);
  if (run.variant === "with-plugin" && valueInTurnTwoContext)
    return { status: "invalid", evidence: "plugin did not fold the run-2 value out of turn 2's first request" };
  if (run.variant === "without-plugin" && !valueInTurnTwoContext)
    return { status: "invalid", evidence: "without-plugin turn 2's first request lacks the run-2 value" };
  if (!second.stdout.includes(value))
    return { status: "fail", evidence: `turn-2 reply lacks ${value}: ${JSON.stringify(second.stdout.trim().slice(0, 300))}` };
  return toolCallsMentioning(second, ".jsonl")
    ? { status: "fail", evidence: "turn 2 recovered the value from the raw session transcript" }
    : { status: "pass", evidence: "turn-2 reply contains the run-2 value" };
}

const title = "recovers an unreproducible result the fold removed";

const scenario: Scenario<void> = {
  async setup(workdir) {
    const script = join(workdir, "measure.sh");
    writeFileSync(script, MEASURE_SCRIPT);
    chmodSync(script, 0o755);
  },
  turns: [
    "Run ./measure.sh three times, as three separate commands. Each run is expensive and prints a value that can never be reproduced: running it again gives a different value. Reply with only how many runs succeeded.",
    "What value did the second run of ./measure.sh print?",
  ],
  grade,
};

const { model, trials } = evalConfig();
const report = createReport(title, model);

afterAll(() => console.log(report.summary().join("\n")));

describe(title, () => {
  for (const variant of ["without-plugin", "with-plugin"] as const) {
    for (let trial = 1; trial <= trials[variant]; trial++) {
      test.concurrent(`${variant} / trial ${trial}`, async () => {
        const { run, state } = await runTrial(scenario, { variant, model });
        const verdict = scenario.grade(run, state);
        const reruns = [...measuredRuns(run.turns[1]).keys()].filter(k => k > 3).length;
        report.record({
          variant,
          trial,
          verdict,
          metrics: {
            "turn-2 re-runs": reruns,
            "turn-1 fold-dir tool calls": toolCallsMentioning(run.turns[0], run.foldHome),
            "turn-2 session transcript reads": toolCallsMentioning(run.turns[1], ".jsonl"),
          },
        });
        expect(verdict).toMatchObject({ status: "pass" });
      }, 300_000);
    }
  }
});
