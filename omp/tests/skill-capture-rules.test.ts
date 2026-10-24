import { expect, test } from "bun:test";
import { runTrial } from "../harness/run-omp";
import type { ScriptedRequest } from "../harness/types";

const cases = [
  { autolearn: true, skillCaptureRules: undefined, foldRules: true, managedSkillRules: false },
  { autolearn: true, skillCaptureRules: false, foldRules: true, managedSkillRules: false },
  { autolearn: true, skillCaptureRules: true, foldRules: true, managedSkillRules: true },
  { autolearn: false, skillCaptureRules: true, foldRules: true, managedSkillRules: false },
];

async function observe({ autolearn, skillCaptureRules }: (typeof cases)[number]) {
  const { run } = await runTrial(
    { async setup() {}, turns: [{ prompt: "q1", script: [{ text: "done" }] }] },
    {
      variant: "with-plugin",
      model: "scripted/scripted",
      settings: { autolearn: { enabled: autolearn } },
      pluginSettings: skillCaptureRules === undefined ? undefined : { skillCaptureRules },
    },
  );
  const { systemPrompt } = run.turns[0].requests[0] as ScriptedRequest;
  return {
    autolearn,
    skillCaptureRules,
    foldRules: systemPrompt.some(part => part.includes("# Folded runs")),
    managedSkillRules: systemPrompt.some(part => part.includes("## Managed skills")),
  };
}

test("managed-skill rules need skillCaptureRules true and autolearn on", async () => {
  expect(await Promise.all(cases.map(observe))).toEqual(cases);
}, 240_000);
