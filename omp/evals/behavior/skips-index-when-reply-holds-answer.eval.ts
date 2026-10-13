import { afterAll, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createReport, evalConfig } from "../harness/eval";
import { runTrial } from "../harness/run-omp";
import type { Run, Scenario, Turn, Verdict } from "../harness/types";

type ToolCall = { name: string; arguments: Record<string, unknown> };

function toolCalls(turn: Turn): ToolCall[] {
  return turn.messages
    .flatMap(message => (message.role === "assistant" ? message.content : []))
    .flatMap(block => (block.type === "toolCall" ? [{ name: block.name, arguments: block.arguments }] : []));
}

function indexWrites(turn: Turn): ToolCall[] {
  return toolCalls(turn).filter(call => {
    if (call.name === "read" || !JSON.stringify(call.arguments).includes("INDEX.md")) return false;
    return call.name !== "bash" || /[>]|\btee\b/.test(String(call.arguments.command));
  });
}

function grade(run: Run): Verdict {
  const [turn] = run.turns;
  const results = turn.messages
    .flatMap(message => (message.role === "toolResult" ? message.content : []))
    .map(block => (block.type === "text" ? block.text : ""))
    .join("\n");
  if (!results.includes("workers: 4")) return { status: "invalid", evidence: "the run never read server.yaml" };
  if (!/\b4\b/.test(turn.stdout)) return { status: "fail", evidence: `reply lacks 4: ${JSON.stringify(turn.stdout.trim().slice(0, 300))}` };
  const writes = indexWrites(turn);
  if (writes.length) return { status: "fail", evidence: `indexed a direct lookup: ${JSON.stringify(writes).slice(0, 400)}` };
  return /next step|workflow/i.test(turn.stdout)
    ? { status: "fail", evidence: `reply reports workflow steps: ${JSON.stringify(turn.stdout.trim().slice(0, 300))}` }
    : { status: "pass", evidence: "answered without indexing or workflow boilerplate" };
}

const title = "leaves the index alone when the reply already holds the answer";

const scenario: Scenario<void> = {
  async setup(workdir) {
    writeFileSync(join(workdir, "server.yaml"), "host: 0.0.0.0\nport: 8080\nworkers: 4\nlog_level: info\n");
  },
  turns: ["How many workers does server.yaml configure?"],
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
        report.record({
          variant,
          trial,
          verdict,
          metrics: { "INDEX.md writes": indexWrites(run.turns[0]).length, "tool calls": toolCalls(run.turns[0]).length },
        });
        expect(verdict).toMatchObject({ status: "pass" });
      }, 300_000);
    }
  }
});
