import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Verdict, Variant } from "./types";

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

type TrialResult = { variant: Variant; trial: number; verdict: Verdict; metrics: Record<string, number> };

const resultsFile = join(import.meta.dir, "..", "results", `${new Date().toISOString().replaceAll(":", "-")}.jsonl`);

export function createReport(title: string, model: string) {
  const results: TrialResult[] = [];
  return {
    record(result: TrialResult) {
      results.push(result);
      mkdirSync(join(resultsFile, ".."), { recursive: true });
      appendFileSync(resultsFile, `${JSON.stringify({ scenario: title, model, ...result })}\n`);
    },
    summary(): string[] {
      const variants = [...new Set(results.map(result => result.variant))];
      const lines = variants.map(variant => {
        const all = results.filter(result => result.variant === variant);
        const valid = all.filter(result => result.verdict.status !== "invalid");
        const passed = valid.filter(result => result.verdict.status === "pass").length;
        const metrics = Object.keys(all[0]?.metrics ?? {}).map(name => {
          const mean = valid.length ? (valid.reduce((sum, result) => sum + result.metrics[name], 0) / valid.length).toFixed(2) : "n/a";
          return `mean ${name} ${mean}`;
        });
        return [`${title} / ${variant}: pass ${passed}/${valid.length}`, `invalid ${all.length - valid.length}`, ...metrics].join(", ");
      });
      return [`model ${model}, means over valid trials`, ...lines, `results: ${resultsFile}`];
    },
  };
}
