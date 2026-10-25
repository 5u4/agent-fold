import { join } from "node:path";
import { resultsFile, type Scenario, type Variant } from "@agent-fold/evals";

export type EvalConfig = { model: string; trials: Record<Variant, number> };

export function evalConfig(env = process.env): EvalConfig {
  const model = env.FOLD_EVAL_MODEL;
  if (!model) throw new Error("FOLD_EVAL_MODEL is unset. Set it to a full pi model id such as github-copilot/gpt-6.1-sol:low.");
  const trials = Number(env.FOLD_EVAL_TRIALS ?? "3");
  if (!Number.isInteger(trials) || trials < 1) throw new Error("FOLD_EVAL_TRIALS must be a positive integer");
  return { model, trials: { "without-plugin": 1, "with-plugin": trials } };
}

export function selectScenarios<S>(all: Scenario<S>[], name: string | undefined): Scenario<S>[] {
  if (!name) return all;
  const selected = all.filter(scenario => scenario.title === name);
  if (!selected.length) {
    throw new Error(`FOLD_EVAL_SCENARIO "${name}" matches no scenario. Valid names:\n${all.map(scenario => scenario.title).join("\n")}`);
  }
  return selected;
}

export const RESULTS_FILE = resultsFile(join(import.meta.dir, "results"));
