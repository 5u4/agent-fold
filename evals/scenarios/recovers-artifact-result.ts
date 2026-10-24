import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Scenario, Turn } from "../contract";
import { mentions, resultText } from "../transcript";

const MEASURE_SCRIPT = `#!/bin/bash
set -euo pipefail
counter="$(dirname "$0")/.measure-count"
k=$(( $(cat "$counter" 2>/dev/null || echo 0) + 1 ))
echo "$k" > "$counter"
echo "run $k: M-$(od -An -N4 -tx1 /dev/urandom | tr -d ' \\n')"
`;

function measuredRuns(turn: Turn): Map<number, string> {
  return new Map([...resultText(turn).matchAll(/run (\d+): (M-[0-9a-f]{8})/g)].map(([, k, value]) => [Number(k), value]));
}

export const recoversArtifactResult: Scenario<void> = {
  title: "recovers an unreproducible result the fold removed",
  async setup(workdir) {
    const script = join(workdir, "measure.sh");
    writeFileSync(script, MEASURE_SCRIPT);
    chmodSync(script, 0o755);
  },
  turns: [
    "Run ./measure.sh three times, as three separate commands. Each run is expensive and prints a value that can never be reproduced: running it again gives a different value. Reply with only how many runs succeeded.",
    "What value did the second run of ./measure.sh print?",
  ],
  grade(run) {
    const [first, second] = run.turns;
    const value = measuredRuns(first).get(2);
    if (!value) return { status: "invalid", evidence: "turn-1 tool results lack a run 2 line" };
    if (first.reply.includes(value)) return { status: "invalid", evidence: "turn-1 reply revealed the run-2 value" };
    const valueInTurnTwoContext = second.modelInputs[0].includes(value);
    if (run.variant === "with-plugin" && valueInTurnTwoContext)
      return { status: "invalid", evidence: "plugin did not fold the run-2 value out of turn 2's first request" };
    if (run.variant === "without-plugin" && !valueInTurnTwoContext)
      return { status: "invalid", evidence: "without-plugin turn 2's first request lacks the run-2 value" };
    if (!second.reply.includes(value))
      return { status: "fail", evidence: `turn-2 reply lacks ${value}: ${JSON.stringify(second.reply.trim().slice(0, 300))}` };
    return second.actions.some(action => action.touchesSessionLog)
      ? { status: "fail", evidence: "turn 2 recovered the value from the raw session transcript" }
      : { status: "pass", evidence: "turn-2 reply contains the run-2 value" };
  },
  metrics(run) {
    const [first, second] = run.turns;
    return {
      "turn-2 re-runs": [...measuredRuns(second).keys()].filter(k => k > 3).length,
      "turn-1 fold-dir tool calls": first.actions.filter(action => mentions(action, run.foldHome)).length,
      "turn-2 session transcript reads": second.actions.filter(action => action.touchesSessionLog).length,
    };
  },
};
