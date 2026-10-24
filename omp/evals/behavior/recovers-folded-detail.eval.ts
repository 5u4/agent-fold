import { afterAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { runTrial } from "../../harness/run-omp";
import type { Run, Scenario, Turn, Verdict } from "../../harness/types";
import { requestWithoutIndex } from "../../harness/view";
import { createReport, evalConfig } from "../eval";

function toolCallCount(turn: Turn): number {
  return turn.messages.flatMap(message => (message.role === "assistant" ? message.content : [])).filter(block => block.type === "toolCall")
    .length;
}

function grade(run: Run, { nonce }: { nonce: string }): Verdict {
  const [first, second] = run.turns;
  if (!first.requests.some(request => JSON.stringify(request).includes(nonce)))
    return { status: "invalid", evidence: "turn 1 never sent the nonce to the model" };
  if (first.stdout.includes(nonce)) return { status: "invalid", evidence: "turn-1 reply revealed the nonce" };
  const nonceInTurnTwoContext = requestWithoutIndex(second.requests[0]).includes(nonce);
  if (run.variant === "with-plugin" && nonceInTurnTwoContext)
    return { status: "invalid", evidence: "plugin did not fold the nonce out of turn 2's first request" };
  if (run.variant === "without-plugin" && !nonceInTurnTwoContext)
    return { status: "invalid", evidence: "without-plugin turn 2's first request lacks the nonce" };
  return second.stdout.includes(nonce)
    ? { status: "pass", evidence: "turn-2 reply contains the nonce" }
    : { status: "fail", evidence: `turn-2 reply lacks the nonce: ${JSON.stringify(second.stdout.trim().slice(0, 300))}` };
}

const title = "re-reads a detail the fold removed instead of guessing it";

const scenario: Scenario<{ nonce: string }> = {
  async setup(workdir) {
    const nonce = `NONCE-${randomBytes(8).toString("hex")}`;
    writeFileSync(join(workdir, "nonce.txt"), `${nonce}\n`);
    return { nonce };
  },
  turns: [
    "Use the read tool to open nonce.txt, then tell me only whether it is empty. Do not reveal its contents.",
    "What was the value in nonce.txt?",
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
        report.record({ variant, trial, verdict, metrics: { "turn-2 tool calls": toolCallCount(run.turns[1]) } });
        expect(verdict).toMatchObject({ status: "pass" });
      }, 300_000);
    }
  }
});
