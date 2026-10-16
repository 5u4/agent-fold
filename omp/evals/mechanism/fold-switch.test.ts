import { expect, test } from "bun:test";
import { runTrial } from "../harness/run-omp";
import type { Run, Scenario, ScriptedRequest, ScriptedTurn } from "../harness/types";
import { compactMessage } from "../harness/view";

const settings = { checkpoint: { enabled: true } };

function probeTurn(run: number, commands: string[] = []): ScriptedTurn {
  return {
    commands,
    prompt: `q${run}`,
    script: [
      { toolCall: { name: "write", arguments: { path: "xd://rewind", content: "{}" } } },
      { toolCall: { name: "write", arguments: { path: "xd://checkpoint", content: "{}" } } },
      { text: `done ${run}` },
    ],
  };
}

const unfolded = (run: number) => [
  `user:q${run}`,
  "assistant:toolCall:write",
  "toolResult:write",
  "assistant:toolCall:write",
  "toolResult:write",
  `assistant:text:done ${run}`,
];
const folded = (run: number) => [`user:q${run}`, `assistant:text:done ${run}`];

const scenario: Pick<Scenario<void>, "setup" | "turns"> = {
  async setup() {},
  turns: [probeTurn(1), probeTurn(2, ["/agent-fold off"]), probeTurn(3), probeTurn(4, ["/agent-fold on"])],
};

function observed(run: Run) {
  return run.turns.map(turn => {
    const request = turn.requests[0] as ScriptedRequest;
    return {
      view: request.messages.flatMap(compactMessage),
      foldRules: request.systemPrompt.some(part => part.includes("# Folded runs")),
      checkpointDispatch: turn.messages.flatMap(message => {
        if (message.role !== "toolResult") return [];
        const text = message.content.flatMap(block => (block.type === "text" ? [block.text] : [])).join("");
        return [text.match(/^(No such tool|Invalid args)/)?.[1]];
      }),
      switchEntries: turn.entries.flatMap(entry =>
        entry.type === "custom" && entry.customType === "agent-fold.switch" ? [entry.data] : [],
      ),
    };
  });
}

test("without the plugin, checkpoint and rewind dispatch", async () => {
  const { run } = await runTrial(
    { ...scenario, turns: [probeTurn(1)] },
    { variant: "without-plugin", model: "scripted/scripted", settings },
  );
  expect(observed(run)[0].checkpointDispatch).toEqual(["Invalid args", "Invalid args"]);
}, 120_000);

test("/agent-fold off sends the session as without the plugin until /agent-fold on", async () => {
  const { run } = await runTrial(scenario, { variant: "with-plugin", model: "scripted/scripted", settings });
  expect(observed(run)).toEqual([
    {
      view: ["user:q1", "developer"],
      foldRules: true,
      checkpointDispatch: ["No such tool", "No such tool"],
      switchEntries: [],
    },
    {
      view: [...unfolded(1), "user:q2"],
      foldRules: false,
      checkpointDispatch: ["Invalid args", "Invalid args"],
      switchEntries: [{ enabled: false }],
    },
    {
      view: [...unfolded(1), ...unfolded(2), "user:q3"],
      foldRules: false,
      checkpointDispatch: ["Invalid args", "Invalid args"],
      switchEntries: [],
    },
    {
      view: [...folded(1), ...folded(2), ...folded(3), "user:q4", "developer"],
      foldRules: true,
      checkpointDispatch: ["No such tool", "No such tool"],
      switchEntries: [{ enabled: true }],
    },
  ]);
}, 240_000);
