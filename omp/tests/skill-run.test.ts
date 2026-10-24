import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runTrial } from "../harness/run-omp";
import type { Scenario, ScriptedRequest, Variant } from "../harness/types";
import { compactMessage } from "../harness/view";

const scenario: Pick<Scenario<void>, "setup" | "turns"> = {
  async setup(workdir) {
    writeFileSync(join(workdir, "nonce.txt"), "NONCE-skill\n");
    mkdirSync(join(workdir, ".omp", "skills", "probe"), { recursive: true });
    writeFileSync(
      join(workdir, ".omp", "skills", "probe", "SKILL.md"),
      "---\nname: probe\ndescription: Probe skill.\n---\n\nPROBE-SKILL-BODY\n",
    );
  },
  turns: [
    {
      prompt: "/skill:probe q1 read nonce.txt",
      rpc: true,
      script: [{ toolCall: { name: "read", arguments: { path: "nonce.txt" } } }, { text: "done 1" }],
    },
    { prompt: "q2 anything", script: [{ text: "done 2" }] },
  ],
};

async function turnTwoView(variant: Variant): Promise<string[]> {
  const { run } = await runTrial(scenario, { variant, model: "scripted/scripted" });
  const request = run.turns[1].requests[0] as ScriptedRequest;
  return request.messages.flatMap(message => {
    const [line] = compactMessage(message);
    return line?.startsWith("user:") && line.includes("PROBE-SKILL-BODY") ? ["user:skill probe"] : compactMessage(message);
  });
}

test("the plugin sends a run opened by a skill prompt as the prompt and its final reply", async () => {
  expect(await turnTwoView("with-plugin")).toEqual(["user:skill probe", "assistant:text:done 1", "user:q2 anything", "developer"]);
}, 120_000);

test("without the plugin, a run opened by a skill prompt reaches the provider unfolded", async () => {
  expect(await turnTwoView("without-plugin")).toEqual([
    "user:skill probe",
    "assistant:toolCall:read",
    "toolResult:read",
    "assistant:text:done 1",
    "user:q2 anything",
  ]);
}, 120_000);
