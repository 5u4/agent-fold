import { expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { runTrial } from "../harness/run-omp";
import type { Scenario, ScriptedRequest, Variant } from "../harness/types";
import { compactMessage } from "../harness/view";

const scenario: Pick<Scenario<void>, "setup" | "turns"> = {
  async setup(workdir) {
    writeFileSync(join(workdir, "nonce.txt"), "NONCE-folded\n");
  },
  turns: [
    { prompt: "q1 read nonce.txt", script: [{ toolCall: { name: "read", arguments: { path: "nonce.txt" } } }, { text: "done 1" }] },
    { prompt: "q2 anything", script: [{ text: "done 2" }] },
  ],
};

async function turnTwoView(variant: Variant): Promise<string[]> {
  const { run } = await runTrial(scenario, { variant, model: "scripted/scripted" });
  const request = run.turns[1].requests[0] as ScriptedRequest;
  return request.messages.flatMap(compactMessage);
}

test("the plugin sends run 1 to the provider as its user message and final reply", async () => {
  expect(await turnTwoView("with-plugin")).toEqual(["user:q1 read nonce.txt", "assistant:text:done 1", "user:q2 anything", "developer"]);
}, 120_000);

test("without the plugin, run 1 reaches the provider unfolded", async () => {
  expect(await turnTwoView("without-plugin")).toEqual([
    "user:q1 read nonce.txt",
    "assistant:toolCall:read",
    "toolResult:read",
    "assistant:text:done 1",
    "user:q2 anything",
  ]);
}, 120_000);
