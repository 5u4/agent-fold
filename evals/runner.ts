import { afterAll, describe, expect, test } from "bun:test";
import type { Harness, Scenario, Variant } from "./contract";
import { createReport, type Row } from "./report";

export async function runTrialRow<S>(
  harness: Harness,
  scenario: Scenario<S>,
  opts: { variant: Variant; model: string },
): Promise<Pick<Row, "verdict" | "metrics">> {
  const outcome = await harness.runTrial(scenario, opts);
  if ("unsupported" in outcome) return { verdict: { status: "unsupported", evidence: outcome.unsupported }, metrics: {} };
  return { verdict: scenario.grade(outcome.run, outcome.state), metrics: scenario.metrics(outcome.run, outcome.state) };
}

export function describeEvals(opts: {
  harness: Harness;
  model: string;
  trials: Record<Variant, number>;
  resultsFile: string;
  scenarios: readonly Scenario<unknown>[];
}): void {
  const { harness, model, trials } = opts;
  for (const scenario of opts.scenarios) {
    describe(scenario.title, () => {
      const report = createReport({ harness: harness.name, scenario: scenario.title, model, file: opts.resultsFile });
      afterAll(() => console.log(report.summary().join("\n")));
      for (const variant of ["without-plugin", "with-plugin"] as const) {
        for (let trial = 1; trial <= trials[variant]; trial++) {
          test.concurrent(`${variant} / trial ${trial}`, async () => {
            const row = await runTrialRow(harness, scenario, { variant, model });
            report.record({ variant, trial, ...row });
            if (row.verdict.status !== "unsupported") expect(row.verdict).toMatchObject({ status: "pass" });
          }, 300_000);
        }
      }
    });
  }
}
