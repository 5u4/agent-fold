import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Scenario } from "../contract";

export const recoversFoldedDetail: Scenario<{ nonce: string }> = {
  title: "re-reads a detail the fold removed instead of guessing it",
  async setup(workdir) {
    const nonce = `NONCE-${randomBytes(8).toString("hex")}`;
    writeFileSync(join(workdir, "nonce.txt"), `${nonce}\n`);
    return { nonce };
  },
  turns: [
    "Use the read tool to open nonce.txt, then tell me only whether it is empty. Do not reveal its contents.",
    "What was the value in nonce.txt?",
  ],
  grade(run, { nonce }) {
    const [first, second] = run.turns;
    if (!first.modelInputs.some(input => input.includes(nonce)))
      return { status: "invalid", evidence: "turn 1 never sent the nonce to the model" };
    if (first.reply.includes(nonce)) return { status: "invalid", evidence: "turn-1 reply revealed the nonce" };
    const nonceInTurnTwoContext = second.modelInputs[0].includes(nonce);
    if (run.variant === "with-plugin" && nonceInTurnTwoContext)
      return { status: "invalid", evidence: "plugin did not fold the nonce out of turn 2's first request" };
    if (run.variant === "without-plugin" && !nonceInTurnTwoContext)
      return { status: "invalid", evidence: "without-plugin turn 2's first request lacks the nonce" };
    return second.reply.includes(nonce)
      ? { status: "pass", evidence: "turn-2 reply contains the nonce" }
      : { status: "fail", evidence: `turn-2 reply lacks the nonce: ${JSON.stringify(second.reply.trim().slice(0, 300))}` };
  },
  metrics(run) {
    return { "turn-2 tool calls": run.turns[1].actions.length };
  },
};
