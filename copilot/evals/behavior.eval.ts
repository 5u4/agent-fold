import { join } from "node:path";
import { describeEvals, resultsFile, scenarios } from "@agent-fold/evals";
import { copilotHarness } from "../harness/driver";

const model = process.env.FOLD_EVAL_MODEL ?? "claude-haiku-4.5";
const trials = Number(process.env.FOLD_EVAL_TRIALS ?? "3");
if (!Number.isInteger(trials) || trials < 1) throw new Error("FOLD_EVAL_TRIALS must be a positive integer");

describeEvals({
  harness: copilotHarness(),
  model,
  trials: { "without-plugin": 1, "with-plugin": trials },
  resultsFile: resultsFile(join(import.meta.dir, "results")),
  scenarios,
});
