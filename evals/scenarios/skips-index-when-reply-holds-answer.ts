import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Action, Scenario, Turn } from "../contract";
import { mentions, resultText } from "../transcript";

function indexWrites(turn: Turn): Action[] {
  return turn.actions.filter(
    action => action.kind !== "read" && mentions(action, "INDEX.md") && (action.kind !== "shell" || /[>]|\btee\b/.test(action.command)),
  );
}

export const skipsIndexWhenReplyHoldsAnswer: Scenario<void> = {
  title: "leaves the index alone when the reply already holds the answer",
  async setup(workdir) {
    writeFileSync(join(workdir, "server.yaml"), "host: 0.0.0.0\nport: 8080\nworkers: 4\nlog_level: info\n");
  },
  turns: ["How many workers does server.yaml configure?"],
  grade(run) {
    const [turn] = run.turns;
    if (!resultText(turn).includes("workers: 4")) return { status: "invalid", evidence: "the run never read server.yaml" };
    if (!/\b4\b/.test(turn.reply)) return { status: "fail", evidence: `reply lacks 4: ${JSON.stringify(turn.reply.trim().slice(0, 300))}` };
    const writes = indexWrites(turn);
    if (writes.length)
      return {
        status: "fail",
        evidence: `indexed a direct lookup: ${JSON.stringify(writes.map(action => ({ name: action.name, arguments: action.args }))).slice(0, 400)}`,
      };
    return /next step|workflow/i.test(turn.reply)
      ? { status: "fail", evidence: `reply reports workflow steps: ${JSON.stringify(turn.reply.trim().slice(0, 300))}` }
      : { status: "pass", evidence: "answered without indexing or workflow boilerplate" };
  },
  metrics(run) {
    const [turn] = run.turns;
    return { "INDEX.md writes": indexWrites(turn).length, "tool calls": turn.actions.length };
  },
};
