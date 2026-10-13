import { afterAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createReport, providerModels } from "../harness/eval";
import { runTrial } from "../harness/run-omp";
import type { Run, Scenario, Turn, Verdict } from "../harness/types";

function providerError(turn: Turn): string | undefined {
  return turn.messages.flatMap(message =>
    message.role === "assistant" && message.stopReason === "error" ? [message.errorMessage ?? "no errorMessage"] : [],
  )[0];
}

function finalReplyCarriedProviderState(turn: Turn): number {
  const reply = turn.messages.findLast(message => message.role === "assistant");
  if (reply?.role !== "assistant") return 0;
  const state =
    reply.providerPayload !== undefined || reply.content.some(block => block.type === "thinking" || block.type === "redactedThinking");
  return state ? 1 : 0;
}

function grade(run: Run, { nonce }: { nonce: string }): Verdict {
  const [first, second] = run.turns;
  const firstError = providerError(first);
  if (firstError !== undefined) return { status: "invalid", evidence: `turn 1 ended in a provider error: ${firstError}` };
  if (!first.requests.some(request => JSON.stringify(request).includes(nonce)))
    return { status: "invalid", evidence: "turn 1 never sent the nonce to the model" };
  if (JSON.stringify(second.requests[0]).includes(nonce))
    return { status: "invalid", evidence: "plugin did not fold the nonce out of turn 2's first request" };
  const secondError = providerError(second);
  return secondError === undefined
    ? { status: "pass", evidence: "provider accepted the folded request" }
    : { status: "fail", evidence: `provider rejected the folded request: ${secondError}` };
}

const title = "provider accepts the folded request";

const scenario: Scenario<{ nonce: string }> = {
  async setup(workdir) {
    const nonce = `NONCE-${randomBytes(8).toString("hex")}`;
    writeFileSync(join(workdir, "nonce.txt"), `${nonce}\n`);
    return { nonce };
  },
  turns: ["Use the read tool to open nonce.txt, then tell me only whether it is empty.", "Reply with the word ok."],
  grade,
};

const models = providerModels();
const reports = models.map(model => createReport(title, model));

afterAll(() => console.log(reports.flatMap(report => report.summary()).join("\n")));

describe(title, () => {
  for (const [index, model] of models.entries()) {
    test.concurrent(model, async () => {
      const { run, state } = await runTrial(scenario, { variant: "with-plugin", model });
      const verdict = scenario.grade(run, state);
      reports[index].record({
        variant: "with-plugin",
        trial: 1,
        verdict,
        metrics: { "turn-1 reply provider state": finalReplyCarriedProviderState(run.turns[0]) },
      });
      expect(verdict).toMatchObject({ status: "pass" });
    }, 300_000);
  }
});
