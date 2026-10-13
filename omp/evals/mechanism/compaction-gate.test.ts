import { expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Message } from "@oh-my-pi/pi-ai";
import { runTrial } from "../harness/run-omp";
import type { Reply, Run, Scenario, ScriptedRequest, Variant } from "../harness/types";

const compactionSettings = { thresholdTokens: 20_000, keepRecentTokens: 50, asyncEnabled: false };
const spareReplies: Reply[] = Array.from({ length: 10 }, (_, index) => ({ text: `spare ${index}` }));

function compactionOriginsPerTurn(run: Run): (boolean | undefined)[][] {
  return run.turns.map(turn => turn.entries.flatMap(entry => (entry.type === "compaction" ? [entry.fromExtension] : [])));
}

const nonce = "NONCE-fold-summary";

function carriesNonce(request: unknown): boolean {
  return JSON.stringify(request).includes(nonce);
}

const largeFiles = ["a", "b"];

const cancelScenario: Pick<Scenario<void>, "setup" | "turns"> = {
  async setup(workdir) {
    for (const name of largeFiles) {
      const lines = Array.from({ length: 300 }, (_, line) => `${line} NONCE-cancel-${name} ${"x".repeat(90)}`);
      writeFileSync(join(workdir, `${name}.txt`), lines.join("\n"));
    }
  },
  turns: largeFiles.map((name, index) => ({
    prompt: `q${index + 1} read ${name}.txt`,
    script: [
      { toolCall: { name: "read", arguments: { path: `${name}.txt` } } },
      { text: `done ${index + 1}` },
      ...(index === largeFiles.length - 1 ? spareReplies : []),
    ],
  })),
};

const summaryScenario: Pick<Scenario<void>, "setup" | "turns"> = {
  async setup(workdir) {
    writeFileSync(join(workdir, "nonce.txt"), `${nonce}\n`);
  },
  turns: [
    { prompt: "q1 read nonce.txt", script: [{ toolCall: { name: "read", arguments: { path: "nonce.txt" } } }, { text: "done 1" }] },
    { prompt: "q2 anything", script: [{ text: "done 2", inputTokens: 30_000 }, ...spareReplies] },
  ],
};

async function summaryRun(variant: Variant, secrets: boolean) {
  const { run } = await runTrial(summaryScenario, {
    variant,
    model: "scripted/scripted",
    settings: { compaction: compactionSettings, secrets: { enabled: secrets } },
  });
  return {
    origins: compactionOriginsPerTurn(run),
    toolResultRequest: (run.turns[0].requests[1] as ScriptedRequest).messages,
    compactionRequests: (run.turns[1].requests.slice(1) as ScriptedRequest[]).map(request => request.messages),
  };
}

function userText(message: Message | undefined): string {
  if (message?.role !== "user") return "";
  if (typeof message.content === "string") return message.content;
  return message.content.flatMap(block => (block.type === "text" ? [block.text] : [])).join("");
}

function viewOf(request: Message[]): string[] {
  return request.slice(0, -1).flatMap(message => {
    if (message.role === "toolResult") return [`toolResult:${message.toolName}`];
    if (message.role === "user") return [`user:${userText(message).split("</system-reminder>").at(-1)}`];
    if (message.role !== "assistant") return [message.role];
    return message.content.flatMap(block => {
      if (block.type === "text") return [`assistant:text:${block.text}`];
      if (block.type === "toolCall") return [`assistant:toolCall:${block.name}`];
      return [];
    });
  });
}

test.each<[Variant, (boolean | undefined)[][]]>([
  ["with-plugin", [[], []]],
  ["without-plugin", [[], [false]]],
])(
  "%p: compactions per turn when the unfolded history crosses the threshold but the folded context does not",
  async (variant, expected) => {
    const { run } = await runTrial(cancelScenario, {
      variant,
      model: "scripted/scripted",
      settings: { compaction: compactionSettings },
    });
    expect(compactionOriginsPerTurn(run)).toEqual(expected);
  },
  120_000,
);

test("the plugin summarizes the folded view when the folded context crosses the threshold", async () => {
  const { origins, compactionRequests } = await summaryRun("with-plugin", false);
  expect(origins).toEqual([[], [true]]);
  expect(userText(compactionRequests[0].at(-1))).toStartWith(
    "<conversation>\n\n\nHuman: q1 read nonce.txt\n\nAssistant: done 1\n</conversation>",
  );
  expect(compactionRequests.map(carriesNonce)).toEqual(compactionRequests.map(() => false));
}, 120_000);

test("without the plugin, native handoff compaction sends the unfolded tool result", async () => {
  const { origins, compactionRequests } = await summaryRun("without-plugin", false);
  expect(origins).toEqual([[], [false]]);
  expect(compactionRequests.map(viewOf)).toEqual([
    [
      "user:q1 read nonce.txt",
      "assistant:toolCall:read",
      "toolResult:read",
      "assistant:text:done 1",
      "user:q2 anything",
      "assistant:text:done 2",
    ],
  ]);
  expect(compactionRequests.map(carriesNonce)).toEqual([true]);
}, 120_000);

test("with secrets enabled, the plugin leaves compaction to native handoff, which still sees the folded view", async () => {
  const { origins, toolResultRequest, compactionRequests } = await summaryRun("with-plugin", true);
  expect(origins).toEqual([[], [false]]);
  expect(carriesNonce(toolResultRequest)).toBe(true);
  expect(compactionRequests.map(viewOf)).toEqual([
    ["user:q1 read nonce.txt", "assistant:text:done 1", "user:q2 anything", "assistant:text:done 2"],
  ]);
  expect(compactionRequests.map(carriesNonce)).toEqual([false]);
}, 120_000);
