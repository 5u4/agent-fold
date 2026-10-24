import { join } from "node:path";
import { resultsFile, type Variant } from "@agent-fold/evals";

export type EvalConfig = { model: string; trials: Record<Variant, number> };

export function evalConfig(env = process.env): EvalConfig {
  const model = env.FOLD_EVAL_MODEL;
  if (!model) throw new Error("FOLD_EVAL_MODEL is unset. Copy .env.test.example to .env.test.local and set a full model id.");
  const trials = Number(env.FOLD_EVAL_TRIALS ?? "3");
  if (!Number.isInteger(trials) || trials < 1) throw new Error("FOLD_EVAL_TRIALS must be a positive integer");
  return { model, trials: { "without-plugin": 1, "with-plugin": trials } };
}

export function providerModels(env = process.env): string[] {
  const models = (env.FOLD_EVAL_PROVIDER_MODELS ?? "")
    .split(",")
    .map(model => model.trim())
    .filter(model => model !== "");
  if (!models.length)
    throw new Error("FOLD_EVAL_PROVIDER_MODELS is unset. Set it to comma-separated full model ids, one per provider API.");
  return models;
}

export const RESULTS_FILE = resultsFile(join(import.meta.dir, "results"));
